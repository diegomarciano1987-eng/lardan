/**
 * 0286 — Asaas automático, etapa B (banco ISOLADO, dados sintéticos).
 * Regras do Diego: consultora com maleta aberta (em vendas ou em acerto) vai para a exceção; título
 * "Não identificado" já baixado pela planilha passa para a pessoa da cobrança sem dinheiro novo; tarifa
 * do Pix/boleto em 5.1.3; notificações e negativação em um título por mês (5.1.1); transferência
 * Asaas -> banco já lançada só é conferida; tudo reversível com motivo.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

let master: Conta, consultora: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const oficial = async <T>(sql: string, p: unknown[] = []) =>
  (await adm.begin(async (tx) => {
    await tx.unsafe(`select set_config('lardann.asaas_link','on',true)`);
    return (await tx.unsafe(sql, p)) as T[];
  }))[0]!;
const DIA = "2026-10-20";

async function servico<T = unknown>(sql: string, p: unknown[] = []): Promise<{ dados: T; erro: string | null }> {
  const c = await adm.reserve();
  try {
    await c.unsafe(`set role service_role`);
    await c.unsafe(`select set_config('lardan.test_role','service_role',false), set_config('lardan.test_uid','',false), set_config('request.jwt.claims','',false)`);
    const r = (await c.unsafe(`select (${sql}) as r`, p)) as { r: T }[];
    return { dados: r[0]!.r, erro: null };
  } catch (e) {
    return { dados: null as T, erro: (e as Error).message };
  } finally {
    try { await c.unsafe(`reset role`); await c.unsafe(`select set_config('lardan.test_role','',false)`); } catch { /* */ }
    c.release();
  }
}
type Rodada = { identificados: number; identificados_linha_conciliada: number; tarifas: number; notificacoes_meses: number; transferencias: number; erros: number; ultimo_erro: string | null };
const rodar = (aplicar: boolean) => servico<Rodada>(`public.asaas_auto_extrato_rodar($1::boolean, 2000)`, [aplicar]);

let fin: string, banco: string, emp: string, acc: string, naoIdent: string, file: string, imp: string;
let linhaNo = 0;
async function pessoa(nome = `ISO B ${marca()}`) {
  return (await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [nome])).id;
}
async function linha(kind: "entrada" | "saida", valor: number, raw: Record<string, unknown>, dia = DIA) {
  return (await um<{ id: string }>(
    `insert into public.financial_statement_lines (financial_account_id, file_id, import_id, line_no, data, valor_cents, kind, historico, documento, bank_id, raw, status)
     values ($1,$2,$3,$4,$5,$6,$7,'ISO',$8,$9,$10::text::jsonb,'pendente') returning id`,
    [fin, file, imp, ++linhaNo, dia, valor, kind, String(raw["paymentId"] ?? ""), `bk_${marca()}`, JSON.stringify(raw)])).id;
}
const statusLinha = async (id: string) => (await um<{ s: string }>(`select status::text s from public.financial_statement_lines where id=$1`, [id])).s;
const saldoRazao = async () =>
  Number((await um<{ s: string }>(`select coalesce(sum(valor_cents),0) s from public.financial_account_movements where financial_account_id=$1`, [fin])).s);

/** Título "Não identificado" baixado pela planilha + cobrança recebida confirmada pelo nº da fatura. */
async function planilha(valor: number, comTarifa = true) {
  const p = await pessoa();
  const t = await rpc<string>(master, "fin_title_create", { _payload: {
    direction: "receivable", party_id: naoIdent, descricao: `ISO planilha ${marca()}`, valor_cents: valor, emissao: DIA, competencia: DIA,
    business_entity_id: emp, origem: "importacao", sistema_origem: "planilha_contas_a_receber", parcelas: [{ vencimento: DIA, valor_cents: valor }] } });
  if (!t.ok) throw new Error(t.erro!);
  const inst = (await um<{ id: string }>(`select id from public.financial_installments where title_id=$1`, [t.dados])).id;
  const s = await rpc<{ id: string }>(master, "fin_settlement_create", { _payload: {
    direction: "receivable", valor_cents: valor, financial_account_id: fin, data: DIA,
    alocacoes: [{ installment_id: inst, valor_cents: valor }], idempotency_key: `iso-planilha-${marca()}` } });
  if (!s.ok) throw new Error(s.erro!);
  const ext = `pay_${marca()}`;
  const ch = (await oficial<{ id: string }>(
    `insert into public.asaas_charges (account_id, external_id, value_cents, received_cents, fee_cents, net_value_cents, due_date, payment_date, billing_type, external_status, party_id)
     values ($1,$2,$3,$3,199,$3-199,$4,$4,'PIX','RECEIVED',$5) returning id`, [acc, ext, valor, DIA, p])).id;
  await adm.unsafe(`insert into public.asaas_charge_matches (charge_id, installment_id, title_id, regra, status, decidido_em) values ($1,$2,$3,'fatura','confirmado',now())`, [ch, inst, t.dados]);
  const rec = await linha("entrada", valor, { type: "PAYMENT_RECEIVED", paymentId: ext });
  const fee = comTarifa ? await linha("saida", 199, { type: "PAYMENT_FEE", paymentId: ext }) : null;
  return { p, title: t.dados, inst, ch, ext, rec, fee };
}

beforeAll(async () => {
  master = await criarConta({ nome: "master-ext-0286", papeis: ["master"], comParty: true });
  consultora = await criarConta({ nome: "cons-ext-0286", papeis: ["consultora"], comParty: true });
  fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`ISO Asaas B ${marca()}`])).id;
  banco = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'conta_corrente') returning id`, [`ISO Banco B ${marca()}`])).id;
  emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`ISO Emp B ${marca()}`])).id;
  acc = (await um<{ id: string }>(
    `insert into public.asaas_accounts (label, environment, financial_account_id, owner_entity_id, is_active) values ($1,'sandbox',$2,$3,true) returning id`, [`ISO B ${marca()}`, fin, emp])).id;
  naoIdent = await pessoa("Não identificado");
  const favorecido = await pessoa(`ISO Asaas Sistema ${marca()}`);
  for (const [c, nome, nat] of [["3.1.1", "Revenda", "receita"], ["5.1.1", "Tarifas Bancárias", "despesa"], ["5.1.3", "Tarifas TED/PIX", "despesa"]] as const)
    if (!(await um<{ id: string } | undefined>(`select id from public.chart_of_accounts where codigo=$1`, [c])))
      await adm.unsafe(`insert into public.chart_of_accounts(codigo,nome,natureza) values ($1,$2,$3::fin_account_nature)`, [c, nome, nat]);
  file = (await um<{ id: string }>(`insert into public.financial_statement_files (financial_account_id, storage_path, original_name, format, sha256) values ($1,$2,'ISO','csv',$2) returning id`, [fin, `iso-b-${marca()}`])).id;
  imp = (await um<{ id: string }>(`insert into public.financial_statement_imports (file_id, financial_account_id) values ($1,$2) returning id`, [file, fin])).id;
  await adm.unsafe(`delete from public.consultora_cobranca_config`);
  await adm.unsafe(`insert into public.consultora_cobranca_config (id, ator_user_id, business_entity_id, financial_account_id) values (true,$1,$2,$3)`, [master.uid, emp, fin]);
  await adm.unsafe(
    `update public.asaas_auto_config set ligado = true, extrato_ligado = true, corte = '2026-10-01', favorecido_party_id = $1,
       tarifa_chart_id = (select id from public.chart_of_accounts where codigo='5.1.3' limit 1),
       notificacao_chart_id = (select id from public.chart_of_accounts where codigo='5.1.1' limit 1),
       tarifa_cost_center_id = null, notificacao_cost_center_id = null`, [favorecido]);
});
afterAll(async () => {
  await adm.unsafe(`update public.asaas_auto_config set ligado = false, extrato_ligado = false`);
});

describe("0286 — Asaas automático, etapa B", () => {
  test("consultora com maleta em vendas: Pix sem conta em aberto entra como adiantamento (0293)", async () => {
    const p = await pessoa();
    const kit = (await um<{ id: string }>(`insert into public.kits(code) values($1) returning id`, [`ISO-B-${marca()}`])).id;
    await adm.unsafe(`insert into public.kit_cycles (kit_id, cycle_no, consultora_party_id, status) values ($1, 1, $2, 'operacao')`, [kit, p]);
    const ext = `pay_${marca()}`;
    const ch = (await oficial<{ id: string }>(
      `insert into public.asaas_charges (account_id, external_id, value_cents, received_cents, fee_cents, net_value_cents, due_date, payment_date, billing_type, external_status, party_id)
       values ($1,$2,15000,15000,199,14801,'2026-11-05','2026-11-05','PIX','RECEIVED',$3) returning id`, [acc, ext, p])).id;
    const r = await servico<{ acao: string; motivo: string }>(`public.asaas_auto_receber($1::uuid, false)`, [ch]);
    expect(r.erro).toBeNull();
    // 0293: maleta aberta = adiantamento em 3.1.1 no nome dela (antes ia para a exceção)
    expect(r.dados.acao).toBe("adiantamento_maleta");
    const c = await um<{ party: string; codigo: string }>(
      `select t.party_id::text party, ca.codigo from public.asaas_charges c join public.financial_titles t on t.id=c.title_id
         join public.chart_of_accounts ca on ca.id=t.chart_account_id where c.id=$1`, [ch]);
    expect(c).toEqual({ party: p, codigo: "3.1.1" });
  });

  test("prévia não grava; aplicar passa o título para a pessoa, liga a linha à baixa da planilha (sem dinheiro novo) e lança a tarifa em 5.1.3", async () => {
    const x = await planilha(23456);
    const antes = await saldoRazao();
    const pv = await rodar(false);
    expect(pv.erro).toBeNull();
    expect(pv.dados.identificados).toBeGreaterThanOrEqual(1);
    expect((await um<{ party_id: string }>(`select party_id from public.financial_titles where id=$1`, [x.title])).party_id).toBe(naoIdent);
    expect(await statusLinha(x.rec)).toBe("pendente");

    const r = await rodar(true);
    expect(r.erro).toBeNull();
    expect(r.dados.erros).toBe(0);
    expect((await um<{ party_id: string }>(`select party_id from public.financial_titles where id=$1`, [x.title])).party_id).toBe(x.p);
    const c = await um<{ title_id: string; installment_id: string }>(`select title_id, installment_id from public.asaas_charges where id=$1`, [x.ch]);
    expect(c).toEqual({ title_id: x.title, installment_id: x.inst });
    expect(await statusLinha(x.rec)).toBe("conciliada");
    expect(await statusLinha(x.fee!)).toBe("conciliada");
    const tar = await um<{ codigo: string; valor: number }>(
      `select ca.codigo, t.valor_cents::int valor from public.asaas_auto_extrato e join public.financial_titles t on t.id=e.title_id
         join public.chart_of_accounts ca on ca.id=t.chart_account_id where e.tipo='tarifa' and e.chave=$1`, [x.fee]);
    expect(tar).toEqual({ codigo: "5.1.3", valor: 199 });
    // só a tarifa mexe no saldo: o recebimento já estava no razão pela planilha
    expect((await saldoRazao()) - antes).toBe(-199);
    // rodar de novo não repete nada
    const n1 = await um<{ c: number }>(`select count(*)::int c from public.asaas_auto_extrato where chave in ($1,$2)`, [x.ext, x.fee]);
    await rodar(true);
    const n2 = await um<{ c: number }>(`select count(*)::int c from public.asaas_auto_extrato where chave in ($1,$2)`, [x.ext, x.fee]);
    expect(n2.c).toBe(n1.c);
    expect((await saldoRazao()) - antes).toBe(-199);
  });

  test("tarifa de cobrança baixada pelo próprio Asaas não é lançada de novo", async () => {
    const p = await pessoa();
    const ext = `pay_${marca()}`;
    const ch = (await oficial<{ id: string }>(
      `insert into public.asaas_charges (account_id, external_id, value_cents, received_cents, fee_cents, net_value_cents, due_date, payment_date, billing_type, external_status, party_id)
       values ($1,$2,9000,9000,199,8801,'2026-11-06','2026-11-06','PIX','RECEIVED',$3) returning id`, [acc, ext, p])).id;
    const rec = await linha("entrada", 9000, { type: "PAYMENT_RECEIVED", paymentId: ext }, "2026-11-06");
    const fee = await linha("saida", 199, { type: "PAYMENT_FEE", paymentId: ext }, "2026-11-06");
    const r = await servico<{ acao: string }>(`public.asaas_auto_receber($1::uuid, false)`, [ch]);
    expect(r.dados.acao).toBe("titulo_3_1_1");
    expect(await statusLinha(rec)).toBe("conciliada");
    expect(await statusLinha(fee)).toBe("conciliada");
    const antes = await saldoRazao();
    await rodar(true);
    expect(await saldoRazao()).toBe(antes);
    const t = await um<{ c: number }>(`select count(*)::int c from public.asaas_auto_extrato where tipo='tarifa' and chave=$1`, [fee]);
    expect(t.c).toBe(0);
  });

  test("desfazer a identificação devolve o título para \"Não identificado\", solta a linha e mantém a baixa da planilha; a rotina não refaz", async () => {
    const x = await planilha(31000, false);
    await rodar(true);
    const e = await um<{ id: string }>(`select id from public.asaas_auto_extrato where tipo='identificacao' and chave=$1 and desfeito_em is null`, [x.ext]);
    const antes = await saldoRazao();
    expect((await rpc(consultora, "asaas_auto_extrato_desfazer", { _id: e.id, _motivo: "tentativa indevida" })).ok).toBe(false);
    expect((await rpc(master, "asaas_auto_extrato_desfazer", { _id: e.id, _motivo: "" })).ok).toBe(false);
    const u = await rpc(master, "asaas_auto_extrato_desfazer", { _id: e.id, _motivo: "Pagador era outra pessoa" });
    expect(u.erro).toBeNull();
    expect((await um<{ party_id: string }>(`select party_id from public.financial_titles where id=$1`, [x.title])).party_id).toBe(naoIdent);
    expect((await um<{ title_id: string | null }>(`select title_id from public.asaas_charges where id=$1`, [x.ch])).title_id).toBeNull();
    expect(await statusLinha(x.rec)).toBe("pendente");
    expect(await saldoRazao()).toBe(antes);
    expect((await um<{ s: string }>(`select settlement_status::text s from public.financial_installments where id=$1`, [x.inst])).s).toBe("liquidado");
    await rodar(true);
    expect((await um<{ party_id: string }>(`select party_id from public.financial_titles where id=$1`, [x.title])).party_id).toBe(naoIdent);
  });

  test("notificações e negativação: um título 5.1.1 por mês fechado; mês corrente espera; desfazer devolve o saldo", async () => {
    const antes = await saldoRazao();
    const a = await linha("saida", 99, { type: "PHONE_CALL_NOTIFICATION_FEE" }, "2026-08-10");
    const b = await linha("saida", 990, { type: "PAYMENT_DUNNING_REQUEST_FEE" }, "2026-08-20");
    const hoje = (await um<{ d: string }>(`select to_char((now() at time zone 'America/Sao_Paulo')::date,'YYYY-MM-DD') d`)).d;
    const atual = await linha("saida", 55, { type: "INSTANT_TEXT_MESSAGE_FEE" }, hoje);
    const r = await rodar(true);
    expect(r.erro).toBeNull();
    expect(await statusLinha(a)).toBe("conciliada");
    expect(await statusLinha(b)).toBe("conciliada");
    expect(await statusLinha(atual)).toBe("pendente");
    // 0293: notificações ficam em 5.1.1; negativação (Serasa/SPC) tem o próprio título do mês (4.1.5 quando configurada)
    const e = await um<{ id: string; valor: number; codigo: string; n: number }>(
      `select e.id, e.valor_cents::int valor, ca.codigo, cardinality(e.line_ids) n from public.asaas_auto_extrato e
         join public.financial_titles t on t.id=e.title_id join public.chart_of_accounts ca on ca.id=t.chart_account_id
        where e.tipo='notificacoes' and $1 = any(e.line_ids)`, [a]);
    expect(e).toMatchObject({ valor: 99, codigo: "5.1.1", n: 1 });
    const neg = await um<{ id: string; valor: number }>(`select id, valor_cents::int valor from public.asaas_auto_extrato where tipo='negativacao' and $1 = any(line_ids)`, [b]);
    expect(neg.valor).toBe(990);
    expect((await saldoRazao()) - antes).toBe(-1089);
    const u = await rpc(master, "asaas_auto_extrato_desfazer", { _id: e.id, _motivo: "Conferir mês à mão" });
    expect(u.erro).toBeNull();
    expect((await rpc(master, "asaas_auto_extrato_desfazer", { _id: neg.id, _motivo: "Conferir mês à mão" })).erro).toBeNull();
    expect(await saldoRazao()).toBe(antes);
    expect(await statusLinha(a)).toBe("pendente");
    await rodar(true);
    expect(await statusLinha(a)).toBe("pendente");
  });

  test("transferência Asaas -> banco já lançada: linha conferida sem mexer no saldo; sem lançamento fica pendente", async () => {
    const t = await rpc<string>(master, "fin_transfer_create", { _payload: {
      from_account_id: fin, to_account_id: banco, valor_cents: 123456, data: "2026-09-10", idempotency_key: `iso-tr-${marca()}` } });
    expect(t.erro).toBeNull();
    const ok = await linha("saida", 123456, { type: "TRANSFER" }, "2026-09-11");
    const sem = await linha("saida", 77777, { type: "TRANSFER" }, "2026-09-11");
    const antes = await saldoRazao();
    const r = await rodar(true);
    expect(r.erro).toBeNull();
    expect(await statusLinha(ok)).toBe("ignorada");
    expect(await statusLinha(sem)).toBe("pendente");
    expect(await saldoRazao()).toBe(antes);
    const e = await um<{ id: string; transfer_id: string }>(`select id, transfer_id from public.asaas_auto_extrato where tipo='transferencia' and chave=$1`, [ok]);
    expect(e.transfer_id).toBe(t.dados);
    expect((await rpc(master, "asaas_auto_extrato_desfazer", { _id: e.id, _motivo: "Era outra transferência" })).erro).toBeNull();
    expect(await statusLinha(ok)).toBe("pendente");
  });

  test("permissões: só o serviço roda; relatório exige financeiro", async () => {
    expect((await rpc(master, "asaas_auto_extrato_rodar", { _aplicar: true, _limite: 1 })).ok).toBe(false);
    expect((await rpc(consultora, "asaas_auto_extrato_relatorio", { _de: DIA, _ate: DIA })).ok).toBe(false);
    const rel = await rpc<{ itens: unknown[] }>(master, "asaas_auto_extrato_relatorio", { _de: "2020-01-01", _ate: "2030-01-01" });
    expect(rel.erro).toBeNull();
    expect(rel.dados.itens.length).toBeGreaterThan(0);
  });
});
