/**
 * 0285 — Asaas automático (banco ISOLADO, dados sintéticos).
 * Regras do Diego: Pix sem nada em aberto vira 3.1.1 já baixado; consultora com maleta em
 * acerto vai para exceção; pagou a mais até o menor entre R$ 50 e 10% do saldo vira juros;
 * "Não, é novo" em linha com pay_ nunca cria segundo lançamento; um pay_ = um lançamento;
 * tudo automático é reversível com motivo.
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
const DIA = "2026-11-05";

/** Chamada como a rotina agendada/servidor (service_role, sem usuário). */
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

let fin: string, emp: string, acc: string;
async function pessoa() {
  return (await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO AUTO ${marca()}`])).id;
}
async function titulo(party: string, valor: number) {
  const r = await rpc<string>(master, "fin_title_create", { _payload: {
    direction: "receivable", party_id: party, descricao: `ISO aberto ${marca()}`, valor_cents: valor, emissao: DIA, competencia: DIA,
    business_entity_id: emp, parcelas: [{ vencimento: DIA, valor_cents: valor }] } });
  if (!r.ok) throw new Error(r.erro!);
  return (await um<{ id: string }>(`select id from public.financial_installments where title_id=$1`, [r.dados])).id;
}
async function recebida(party: string | null, valor: number, tarifa = 199) {
  const ext = `pay_${marca()}`;
  const ch = (await oficial<{ id: string }>(
    `insert into public.asaas_charges (account_id, external_id, value_cents, received_cents, fee_cents, net_value_cents, due_date, payment_date, billing_type, external_status, party_id)
     values ($1,$2,$3,$3,$4,$3-$4,$5,$5,'PIX','RECEIVED',$6) returning id`, [acc, ext, valor, tarifa, DIA, party])).id;
  return { ch, ext };
}
const baixas = async (ext: string) =>
  (await um<{ c: number }>(`select count(*)::int c from public.financial_settlements where idempotency_key=$1 and not is_reversal`, [`asaas:baixa:${acc}:${ext}`])).c;
const saldoRazao = async () =>
  Number((await um<{ s: string }>(`select coalesce(sum(valor_cents),0) s from public.financial_account_movements where financial_account_id=$1`, [fin])).s);
const receber = (ch: string) => servico<{ acao: string; motivo?: string; decisao?: string }>(`public.asaas_auto_receber($1::uuid, false)`, [ch]);

beforeAll(async () => {
  master = await criarConta({ nome: "master-auto-0285", papeis: ["master"], comParty: true });
  consultora = await criarConta({ nome: "cons-auto-0285", papeis: ["consultora"], comParty: true });
  fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`ISO Asaas auto ${marca()}`])).id;
  emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`ISO Emp auto ${marca()}`])).id;
  acc = (await um<{ id: string }>(
    `insert into public.asaas_accounts (label, environment, financial_account_id, owner_entity_id, is_active) values ($1,'sandbox',$2,$3,true) returning id`, [`ISO auto ${marca()}`, fin, emp])).id;
  if (!(await um<{ id: string } | undefined>(`select id from public.chart_of_accounts where codigo='3.1.1'`)))
    await adm.unsafe(`insert into public.chart_of_accounts(codigo,nome,natureza) values ('3.1.1','Revenda de Mercadorias Produção Própria',(enum_range(null::fin_account_nature))[1])`);
  await adm.unsafe(`delete from public.consultora_cobranca_config`);
  await adm.unsafe(`insert into public.consultora_cobranca_config (id, ator_user_id, business_entity_id, financial_account_id) values (true,$1,$2,$3)`, [master.uid, emp, fin]);
  await adm.unsafe(`update public.asaas_auto_config set ligado = true, corte = '2026-10-01', juros_max_cents = 5000, juros_max_pct = 10`);
});
afterAll(async () => {
  await adm.unsafe(`update public.asaas_auto_config set ligado = false`);
});

describe("0285 — Asaas automático", () => {
  test("Pix sem nada em aberto: título 3.1.1 já baixado, saldo do Asaas sobe; repetir não lança de novo", async () => {
    const p = await pessoa();
    const antes = await saldoRazao();
    const { ch, ext } = await recebida(p, 31544);
    const r = await receber(ch);
    expect(r.erro).toBeNull();
    expect(r.dados.acao).toBe("titulo_3_1_1");
    const t = await um<{ codigo: string; status: string; valor: number }>(
      `select ca.codigo, t.status::text status, t.valor_cents::int valor from public.asaas_charges c join public.financial_titles t on t.id=c.title_id
         join public.chart_of_accounts ca on ca.id=t.chart_account_id where c.id=$1`, [ch]);
    expect(t).toEqual({ codigo: "3.1.1", status: "ativo", valor: 31544 });
    expect(await baixas(ext)).toBe(1);
    expect((await saldoRazao()) - antes).toBe(31544 - 199);
    const r2 = await receber(ch);
    expect(r2.dados.acao).toBe("ignorado");
    expect(await baixas(ext)).toBe(1);
    const d = await um<{ c: number }>(`select count(*)::int c from public.asaas_auto_decisoes where charge_id=$1`, [ch]);
    expect(d.c).toBe(1);
  });

  test("consultora com maleta em acerto: vai para a exceção e nada é lançado", async () => {
    const p = await pessoa();
    const kit = (await um<{ id: string }>(`insert into public.kits(code) values($1) returning id`, [`ISO-AUTO-${marca()}`])).id;
    await adm.unsafe(`insert into public.kit_cycles (kit_id, cycle_no, consultora_party_id, status) values ($1, 1, $2, 'acerto')`, [kit, p]);
    const { ch, ext } = await recebida(p, 20000);
    const r = await receber(ch);
    expect(r.dados.acao).toBe("excecao");
    expect(r.dados.motivo).toBe("maleta_em_acerto");
    expect(await baixas(ext)).toBe(0);
    const c = await um<{ title_id: string | null }>(`select title_id from public.asaas_charges where id=$1`, [ch]);
    expect(c.title_id).toBeNull();
  });

  test("pagou R$ 3,00 a mais numa conta de R$ 100,00: diferença vira juros na própria baixa", async () => {
    const p = await pessoa();
    const inst = await titulo(p, 10000);
    const { ch, ext } = await recebida(p, 10300);
    const r = await receber(ch);
    expect(r.erro).toBeNull();
    expect(r.dados.acao).toBe("baixa_com_juros");
    expect(Number((await um<{ s: string }>(`select public.fin_installment_saldo($1) s`, [inst])).s)).toBe(0);
    const d = await um<{ juros: number }>(`select juros_cents::int juros from public.asaas_auto_decisoes where charge_id=$1`, [ch]);
    expect(d.juros).toBe(300);
    expect(await baixas(ext)).toBe(1);
  });

  test("pagou R$ 60,00 a mais numa conta de R$ 1.000,00 (acima de R$ 50): exceção, conta continua aberta", async () => {
    const p = await pessoa();
    const inst = await titulo(p, 100000);
    const { ch, ext } = await recebida(p, 106000);
    const r = await receber(ch);
    expect(r.dados.acao).toBe("excecao");
    expect(r.dados.motivo).toBe("valor_nao_casa");
    expect(Number((await um<{ s: string }>(`select public.fin_installment_saldo($1) s`, [inst])).s)).toBe(100000);
    expect(await baixas(ext)).toBe(0);
  });

  test("pagou R$ 15,00 a mais numa conta de R$ 100,00 (acima de 10%): exceção", async () => {
    const p = await pessoa();
    await titulo(p, 10000);
    const { ch } = await recebida(p, 11500);
    const r = await receber(ch);
    expect(r.dados.acao).toBe("excecao");
  });

  test('"Não, é novo" em linha com pay_ é bloqueado; lançar pela cobrança cria um só lançamento e concilia a linha', async () => {
    const p = await pessoa();
    const { ch, ext } = await recebida(p, 5000, 199);
    const file = (await um<{ id: string }>(`insert into public.financial_statement_files (financial_account_id, storage_path, original_name, format, sha256) values ($1,$2,'ISO','csv',$2) returning id`, [fin, `iso-${marca()}`])).id;
    const imp = (await um<{ id: string }>(`insert into public.financial_statement_imports (file_id, financial_account_id) values ($1,$2) returning id`, [file, fin])).id;
    const linha = (await um<{ id: string }>(
      `insert into public.financial_statement_lines (financial_account_id, file_id, import_id, line_no, data, valor_cents, kind, historico, documento, bank_id, raw, status)
       values ($1,$2,$3,1,$4,5000,'entrada','Recebimento',$5,$6,$7::text::jsonb,'pendente') returning id`,
      [fin, file, imp, DIA, ext, `bk_${marca()}`, JSON.stringify({ type: "PAYMENT_RECEIVED", paymentId: ext, value: 50 })])).id;
    await adm.unsafe(
      `insert into public.financial_statement_lines (financial_account_id, file_id, import_id, line_no, data, valor_cents, kind, historico, documento, bank_id, raw, status)
       values ($1,$2,$3,2,$4,199,'saida','Tarifa',$5,$6,$7::text::jsonb,'pendente')`,
      [fin, file, imp, DIA, ext, `bk_${marca()}`, JSON.stringify({ type: "PAYMENT_FEE", paymentId: ext, value: -1.99 })]);
    const novo = await rpc(master, "fin_mesa_novo_conciliar", { _payload: { line_id: linha, party_id: p, descricao: "Teste" } });
    expect(novo.ok).toBe(false);
    expect(novo.erro).toContain("cobrança");
    const r = await rpc<{ acao: string; linha: string }>(master, "asaas_extrato_lancar", { _line: linha, _payload: { party_id: p, descricao: "Venda balcão" } });
    expect(r.erro).toBeNull();
    expect(r.dados.acao).toBe("lancado_pela_mesa");
    expect(r.dados.linha).toBe("conciliada");
    expect(await baixas(ext)).toBe(1);
    const de_novo = await rpc(master, "asaas_extrato_lancar", { _line: linha, _payload: { party_id: p } });
    expect(de_novo.ok).toBe(false);
    expect(await baixas(ext)).toBe(1);
    // a rotina automática também não lança esse pay_ de novo
    const auto = await receber(ch);
    expect(auto.dados.acao).toBe("ignorado");
    expect(await baixas(ext)).toBe(1);
  });

  test("desfazer estorna a baixa, solta a cobrança e cancela o título; a rotina não refaz sozinha", async () => {
    const p = await pessoa();
    const antes = await saldoRazao();
    const { ch, ext } = await recebida(p, 7000);
    const r = await receber(ch);
    expect(r.dados.acao).toBe("titulo_3_1_1");
    const tit = (await um<{ title_id: string }>(`select title_id from public.asaas_charges where id=$1`, [ch])).title_id;
    const semMotivo = await rpc(master, "asaas_auto_desfazer", { _decisao: r.dados.decisao, _motivo: "" });
    expect(semMotivo.ok).toBe(false);
    const u = await rpc(master, "asaas_auto_desfazer", { _decisao: r.dados.decisao, _motivo: "Era pagamento de outra pessoa" });
    expect(u.erro).toBeNull();
    expect(await saldoRazao()).toBe(antes);
    const t = await um<{ status: string }>(`select status::text status from public.financial_titles where id=$1`, [tit]);
    expect(t.status).toBe("cancelado");
    const c = await um<{ title_id: string | null }>(`select title_id from public.asaas_charges where id=$1`, [ch]);
    expect(c.title_id).toBeNull();
    const again = await receber(ch);
    expect(again.dados.motivo).toBe("desfeito_fica_manual");
    expect(await baixas(ext)).toBe(0);
    const log = await um<{ c: number }>(`select count(*)::int c from public.audit_logs where action='asaas.auto.desfazer' and entity_id=$1`, [ch]);
    expect(log.c).toBe(1);
  });

  test("depois de desfazer, a Mesa relança preso ao mesmo pay_ (uma baixa ativa só) e a linha concilia", async () => {
    const p = await pessoa();
    const { ch, ext } = await recebida(p, 8800, 199);
    const r = await receber(ch);
    expect(r.dados.acao).toBe("titulo_3_1_1");
    expect((await rpc(master, "asaas_auto_desfazer", { _decisao: r.dados.decisao, _motivo: "Classificar como outra receita" })).erro).toBeNull();
    const file = (await um<{ id: string }>(`insert into public.financial_statement_files (financial_account_id, storage_path, original_name, format, sha256) values ($1,$2,'ISO','csv',$2) returning id`, [fin, `iso-${marca()}`])).id;
    const imp = (await um<{ id: string }>(`insert into public.financial_statement_imports (file_id, financial_account_id) values ($1,$2) returning id`, [file, fin])).id;
    const linha = (await um<{ id: string }>(
      `insert into public.financial_statement_lines (financial_account_id, file_id, import_id, line_no, data, valor_cents, kind, historico, documento, bank_id, raw, status)
       values ($1,$2,$3,1,$4,8800,'entrada','Recebimento',$5,$6,$7::text::jsonb,'pendente') returning id`,
      [fin, file, imp, DIA, ext, `bk_${marca()}`, JSON.stringify({ type: "PAYMENT_RECEIVED", paymentId: ext })])).id;
    await adm.unsafe(
      `insert into public.financial_statement_lines (financial_account_id, file_id, import_id, line_no, data, valor_cents, kind, historico, documento, bank_id, raw, status)
       values ($1,$2,$3,2,$4,199,'saida','Tarifa',$5,$6,$7::text::jsonb,'pendente')`,
      [fin, file, imp, DIA, ext, `bk_${marca()}`, JSON.stringify({ type: "PAYMENT_FEE", paymentId: ext })]);
    const antes = await saldoRazao();
    const l = await rpc<{ acao: string; linha: string }>(master, "asaas_extrato_lancar", { _line: linha, _payload: { party_id: p, descricao: "Outra receita" } });
    expect(l.erro).toBeNull();
    expect(l.dados.linha).toBe("conciliada");
    expect((await saldoRazao()) - antes).toBe(8800 - 199);
    const ativas = await um<{ c: number }>(
      `select count(*)::int c from public.financial_settlements x where x.idempotency_key like $1 and not x.is_reversal
         and not exists (select 1 from public.financial_settlements r where r.reversed_of = x.id)`, [`asaas:baixa:${acc}:%${ext}`]);
    expect(ativas.c).toBe(1);
  });

  test("permissões: consultora não lança nem desfaz; a rotina e a prévia só rodam pelo serviço", async () => {
    const p = await pessoa();
    const { ch } = await recebida(p, 1000);
    expect((await rpc(consultora, "asaas_auto_receber", { _charge: ch, _manual: true })).ok).toBe(false);
    expect((await rpc(master, "asaas_auto_rodar", { _limite: 1 })).ok).toBe(false);
    expect((await rpc(master, "asaas_auto_previa", { _limite: 1 })).ok).toBe(false);
    const d = await um<{ id: string }>(`select id from public.asaas_auto_decisoes where acao <> 'excecao' and desfeito_em is null limit 1`);
    expect((await rpc(consultora, "asaas_auto_desfazer", { _decisao: d.id, _motivo: "tentativa indevida" })).ok).toBe(false);
  });

  test("prévia mostra o que faria sem gravar nada", async () => {
    const p = await pessoa();
    const { ch, ext } = await recebida(p, 4321);
    const r = await servico<{ quantidade: Record<string, number> }>(`public.asaas_auto_previa(50)`);
    expect(r.erro).toBeNull();
    expect(r.dados.quantidade["titulo_3_1_1"]).toBeGreaterThanOrEqual(1);
    expect(await baixas(ext)).toBe(0);
    const d = await um<{ c: number }>(`select count(*)::int c from public.asaas_auto_decisoes where charge_id=$1`, [ch]);
    expect(d.c).toBe(0);
  });

  test("rotina a cada 5 minutos: lança o recebimento e tira da fila os avisos de vencida já processados", async () => {
    const p = await pessoa();
    const { ch, ext } = await recebida(p, 2500);
    const ev = (await um<{ id: string }>(
      `insert into public.asaas_events (account_id, external_id, event, charge_external_id, event_at, payload, status, processed_at)
       values ($1,$2,'PAYMENT_OVERDUE',$3,now(),'{}'::jsonb,'na_fila',now()) returning id`, [acc, `evt_${marca()}`, ext])).id;
    const r = await servico<{ erros: number }>(`public.asaas_auto_rodar(5)`);
    expect(r.erro).toBeNull();
    expect(await baixas(ext)).toBe(1);
    const e = await um<{ status: string }>(`select status from public.asaas_events where id=$1`, [ev]);
    expect(e.status).toBe("processado");
    const d = await um<{ acao: string }>(`select acao from public.asaas_auto_decisoes where charge_id=$1`, [ch]);
    expect(d.acao).toBe("titulo_3_1_1");
  });

  test("chave geral desligada: a rotina não lança nada", async () => {
    await adm.unsafe(`update public.asaas_auto_config set ligado = false`);
    const p = await pessoa();
    const { ch, ext } = await recebida(p, 1234);
    const r = await servico<{ desligado: boolean }>(`public.asaas_auto_rodar(5)`);
    expect(r.dados.desligado).toBe(true);
    expect((await receber(ch)).dados.motivo).toBe("automatico_desligado");
    expect(await baixas(ext)).toBe(0);
    await adm.unsafe(`update public.asaas_auto_config set ligado = true`);
  });
});
