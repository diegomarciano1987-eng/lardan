/**
 * 0293 — ajustes do Asaas pedidos pelo Diego em 12/11/2026 (banco ISOLADO, dados sintéticos).
 * 1/8) Pix da consultora com maleta aberta entra em 3.1.1 no nome dela (adiantamento).
 * 2) No acerto só se abate o que ela pagou pelo app; o resto vira o título do acerto.
 * 3) Negativação em 4.1.5 (teste em asaas-extrato-0286). 4) Tarifa de boleto em 4.1.2; 5) Pix em 5.1.3.
 * 7a) Linha com o mesmo nº de fatura e valor de baixa já importada liga sozinha. 7b) Ligar a transferência interna.
 * 7c) Baixas já realizadas fora dos 60 dias. 9) TED judicial: 7.1.7 + centro Administrativo.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, type Conta } from "./base";

let master: Conta, cons: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const oficial = async <T>(sql: string, p: unknown[] = []) =>
  (await adm.begin(async (tx) => {
    await tx.unsafe(`select set_config('lardann.asaas_link','on',true)`);
    return (await tx.unsafe(sql, p)) as T[];
  }))[0]!;
const DIA = "2026-11-05";

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
const receber = (ch: string) => servico<{ acao: string; motivo?: string; decisao?: string }>(`public.asaas_auto_receber($1::uuid, true)`, [ch]);
const rodarExtrato = () => servico<{ faturas_ligadas: number; tarifas: number; erros: number; ultimo_erro: string | null }>(`public.asaas_auto_extrato_rodar(true, 2000)`);

let fin: string, banco: string, emp: string, acc: string, file: string, imp: string, adm717: string, ccAdm: string, favorecido: string;
let linhaNo = 0;
async function pessoa(nome = `ISO 0293 ${marca()}`) {
  return (await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [nome])).id;
}
async function cobranca(party: string, valor: number, extra: { billing?: string; raw?: Record<string, unknown> } = {}) {
  const ext = `pay_${marca()}`;
  const ch = (await oficial<{ id: string }>(
    `insert into public.asaas_charges (account_id, external_id, value_cents, received_cents, fee_cents, net_value_cents, due_date, payment_date, billing_type, external_status, party_id, raw)
     values ($1,$2,$3,$3,0,$3,$4,$4,$5,'RECEIVED',$6,$7::text::jsonb) returning id`,
    [acc, ext, valor, DIA, extra.billing ?? "PIX", party, JSON.stringify(extra.raw ?? {})])).id;
  return { ch, ext };
}
async function linha(kind: "entrada" | "saida", valor: number, raw: Record<string, unknown>, dia = DIA) {
  return (await um<{ id: string }>(
    `insert into public.financial_statement_lines (financial_account_id, file_id, import_id, line_no, data, valor_cents, kind, historico, documento, bank_id, raw, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::text::jsonb,'pendente') returning id`,
    [fin, file, imp, ++linhaNo, dia, valor, kind, String(raw["description"] ?? "ISO"), String(raw["paymentId"] ?? ""), `bk_${marca()}`, JSON.stringify(raw)])).id;
}
const statusLinha = async (id: string) => (await um<{ s: string }>(`select status::text s from public.financial_statement_lines where id=$1`, [id])).s;
const saldoRazao = async () =>
  Number((await um<{ s: string }>(`select coalesce(sum(valor_cents),0) s from public.financial_account_movements where financial_account_id=$1`, [fin])).s);
const titulos = async () => Number((await um<{ c: string }>(`select count(*) c from public.financial_titles where status='ativo'`)).c);
/** Título da planilha já baixado no Asaas (como a importação faz). */
async function baixaImportada(direction: "receivable" | "payable", descricao: string, valor: number, dia = DIA) {
  const t = await rpc<string>(master, "fin_title_create", { _payload: {
    direction, party_id: favorecido, descricao, valor_cents: valor, emissao: dia, competencia: dia, business_entity_id: emp,
    origem: "importacao", sistema_origem: direction === "payable" ? "planilha_contas_a_pagar" : "planilha_contas_a_receber",
    parcelas: [{ vencimento: dia, valor_cents: valor }] } });
  if (!t.ok) throw new Error(t.erro!);
  const inst = (await um<{ id: string }>(`select id from public.financial_installments where title_id=$1`, [t.dados])).id;
  const s = await rpc<{ id: string }>(master, "fin_settlement_create", { _payload: {
    direction, valor_cents: valor, financial_account_id: fin, data: dia,
    alocacoes: [{ installment_id: inst, valor_cents: valor }], idempotency_key: `iso-0293-${marca()}` } });
  if (!s.ok) throw new Error(s.erro!);
  return { title: t.dados, settlement: s.dados.id };
}

async function maletaAceita(c: Conta, rem: string, itens: [string, number][]) {
  const m = await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: rem, _consultora: c.partyId });
  if (m.erro) throw new Error(m.erro);
  const id = m.dados.cycle_id;
  for (const [v, q] of itens) { const r = await rpc(master, "kit_item_upsert", { _cycle: id, _variant: v, _qty: q }); if (r.erro) throw new Error(r.erro); }
  for (const f of ["kit_conferir", "kit_expedir"]) {
    const r = await rpc(master, f, f === "kit_conferir" ? { _cycle: id, _note: null } : { _cycle: id, _payload: { rota: "direta" } });
    if (r.erro) throw new Error(`${f}: ${r.erro}`);
  }
  const t = (await um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 order by seq limit 1`, [id])).id;
  const t1 = await rpc(c, "kit_transfer_confirm", { _transfer: t, _payload: {} });
  if (t1.erro) throw new Error(t1.erro);
  const a = await rpc(c, "kit_aceitar", { _cycle: id, _idempotency_key: `pb293-${id}`, _itens: itens.map(([v, q]) => ({ variant_id: v, qty_accepted: q, qty_divergent: 0 })) });
  if (a.erro) throw new Error(a.erro);
  return id;
}

let ciclo = "", vA = "", vB = "";
beforeAll(async () => {
  master = await criarConta({ nome: "master-0293", papeis: ["master"], comParty: true });
  cons = await criarConta({ nome: `cons-0293-${marca()}`, papeis: ["consultora"], comParty: true });
  fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`ISO Asaas 0293 ${marca()}`])).id;
  banco = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'conta_corrente') returning id`, [`ISO Banco 0293 ${marca()}`])).id;
  emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`ISO Emp 0293 ${marca()}`])).id;
  acc = (await um<{ id: string }>(
    `insert into public.asaas_accounts (label, environment, financial_account_id, owner_entity_id, is_active) values ($1,'sandbox',$2,$3,true) returning id`, [`ISO 0293 ${marca()}`, fin, emp])).id;
  favorecido = await pessoa(`ISO Asaas Sistema ${marca()}`);
  for (const [c, nome, nat] of [["3.1.1", "Revenda", "receita"], ["4.1.2", "Emissões de Boletos Bancários", "despesa"], ["4.1.5", "Taxas Negativação", "despesa"],
    ["5.1.1", "Tarifas Bancárias", "despesa"], ["5.1.3", "Tarifas TED/PIX", "despesa"], ["7.1.7", "Recebimento judicial", "receita"]] as const)
    if (!(await um<{ id: string } | undefined>(`select id from public.chart_of_accounts where codigo=$1`, [c])))
      await adm.unsafe(`insert into public.chart_of_accounts(codigo,nome,natureza) values ($1,$2,$3::fin_account_nature)`, [c, nome, nat]);
  adm717 = (await um<{ id: string }>(`select id from public.chart_of_accounts where codigo='7.1.7' limit 1`)).id;
  ccAdm = (await um<{ id: string } | undefined>(`select id from public.cost_centers where lower(codigo)='administrativo' limit 1`))?.id
    ?? (await um<{ id: string }>(`insert into public.cost_centers (codigo, nome) values ('administrativo','Administrativo') returning id`)).id;
  file = (await um<{ id: string }>(`insert into public.financial_statement_files (financial_account_id, storage_path, original_name, format, sha256) values ($1,$2,'ISO','csv',$2) returning id`, [fin, `iso-0293-${marca()}`])).id;
  imp = (await um<{ id: string }>(`insert into public.financial_statement_imports (file_id, financial_account_id) values ($1,$2) returning id`, [file, fin])).id;
  await adm.unsafe(`delete from public.consultora_cobranca_config`);
  await adm.unsafe(`insert into public.consultora_cobranca_config (id, ator_user_id, business_entity_id, financial_account_id) values (true,$1,$2,$3)`, [master.uid, emp, fin]);
  await adm.unsafe(
    `update public.asaas_auto_config set ligado = true, extrato_ligado = true, corte = '2026-10-01', favorecido_party_id = $1,
       tarifa_chart_id = (select id from public.chart_of_accounts where codigo='5.1.3' limit 1),
       boleto_chart_id = (select id from public.chart_of_accounts where codigo='4.1.2' limit 1),
       notificacao_chart_id = (select id from public.chart_of_accounts where codigo='5.1.1' limit 1),
       negativacao_chart_id = (select id from public.chart_of_accounts where codigo='4.1.5' limit 1),
       judicial_chart_id = $2, judicial_cost_center_id = $3, tarifa_cost_center_id = null, notificacao_cost_center_id = null`, [favorecido, adm717, ccAdm]);
  // maleta aceita (em vendas) da consultora
  const deposito = await criarDeposito(`p293-${marca()}`);
  const praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça 0293 ${marca()}`])).linhas[0]!.id;
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [cons.partyId]);
  await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id) values ($1,$2) on conflict (party_id) do update set praca_id=excluded.praca_id`, [cons.partyId, praca]);
  vA = await criarVariante(`p293-a-${marca()}`, 10000);
  vB = await criarVariante(`p293-b-${marca()}`, 5000);
  for (const v of [vA, vB]) await porEstoque(v, deposito, 20);
  await adm.unsafe(`delete from public.consultora_comissao_faixas`);
  await adm.unsafe(`insert into public.consultora_comissao_faixas (min_vendido_cents, percentual, titulo) values (0,20,'20%'),(20000,25,'25%'),(50000,30,'30%')`);
  const remessa = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _deposito: deposito,
    _data_acerto: new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10) })).dados.id;
  ciclo = await maletaAceita(cons, remessa, [[vA, 4], [vB, 2]]);
});
afterAll(async () => {
  await adm.unsafe(`update public.asaas_auto_config set ligado = false, extrato_ligado = false`);
});

describe("0293 — Pix com maleta aberta e acerto", () => {
  let primeiro = "";
  test("Pix da consultora com maleta em vendas: 3.1.1 no nome dela, ligado como adiantamento (nada de exceção)", async () => {
    const { ch } = await cobranca(cons.partyId!, 10000);
    const r = await receber(ch);
    expect(r.erro).toBeNull();
    expect(r.dados.acao).toBe("adiantamento_maleta");
    primeiro = r.dados.decisao!;
    const t = await um<{ party: string; codigo: string; valor: number }>(
      `select t.party_id::text party, ca.codigo, t.valor_cents::int valor from public.asaas_charges c join public.financial_titles t on t.id=c.title_id
         join public.chart_of_accounts ca on ca.id=t.chart_account_id where c.id=$1`, [ch]);
    expect(t).toEqual({ party: cons.partyId!, codigo: "3.1.1", valor: 10000 });
    const a = await um<{ maletas: string[] }>(`select maletas::text[] maletas from public.asaas_maleta_adiantamentos where charge_id=$1 and desfeito_em is null`, [ch]);
    expect(a.maletas).toContain(ciclo);
  });

  test("acerto abate o Pix já pago: vendeu R$ 300 (25% = R$ 75), pagou R$ 100 pelo app, título do acerto de R$ 125", async () => {
    expect((await rpc(cons, "pre_baixa_abrir", { _cycle: ciclo })).erro).toBeNull();
    const c = await rpc<Record<string, number>>(cons, "pre_baixa_vender", { _cycle: ciclo, _variant: vA, _qtd: 3 });
    expect(c.erro).toBeNull();
    expect(c.dados).toMatchObject({ vendido_cents: 30000, comissao_cents: 7500, adiantado_consultora_cents: 10000, valor_pagar_cents: 12500 });
    const f = await rpc<{ installment_id: string; valor_pagar_cents: number }>(cons, "pre_baixa_fechar", { _cycle: ciclo });
    expect(f.erro).toBeNull();
    expect(Number(f.dados.valor_pagar_cents)).toBe(12500);
    const t = await um<{ valor: number }>(`select t.valor_cents::int valor from public.financial_installments i join public.financial_titles t on t.id=i.title_id where i.id=$1`, [f.dados.installment_id]);
    expect(t.valor).toBe(12500);
    expect(Number((await um<{ v: string }>(`select public.asaas_adiantamento_disponivel($1) v`, [cons.partyId])).v)).toBe(0);
  });

  test("Pix já abatido no acerto não pode ser desfeito pelo painel", async () => {
    const u = await rpc(master, "asaas_auto_desfazer", { _decisao: primeiro, _motivo: "teste de trava" });
    expect(u.erro).toContain("abatido no acerto");
  });

  test("Pix pago depois do fechamento abate a diferença da conferência; o que sobra fica para o próximo acerto", async () => {
    // ela paga o título do acerto (valor exato: baixa normal) e depois manda mais um Pix com a maleta ainda em conferência
    const pago = await cobranca(cons.partyId!, 12500);
    expect((await receber(pago.ch)).dados.acao).toBe("baixa_titulo");
    const { ch } = await cobranca(cons.partyId!, 5000);
    const r = await receber(ch);
    expect(r.dados.acao).toBe("adiantamento_maleta");
    // falta 1 peça B (R$ 50): vendido final R$ 350, 25% = R$ 87,50 → 350 − 87,50 − 100 = 162,50; diferença 37,50 sai do Pix de R$ 50
    const prev = await rpc<Record<string, number>>(master, "pre_baixa_conferir", { _cycle: ciclo, _leituras: [{ variant_id: vA, qtd: 1 }, { variant_id: vB, qtd: 1 }], _aplicar: false });
    expect(prev.erro).toBeNull();
    expect(prev.dados).toMatchObject({ valor_final_cents: 12500, diferenca_cents: 0, adiantado_depois_cents: 3750 });
    const ap = await rpc<{ status: string }>(master, "pre_baixa_conferir", { _cycle: ciclo, _leituras: [{ variant_id: vA, qtd: 1 }, { variant_id: vB, qtd: 1 }], _aplicar: true });
    expect(ap.erro).toBeNull();
    expect(ap.dados.status).toBe("encerrada");
    expect(Number((await um<{ v: string }>(`select public.asaas_adiantamento_disponivel($1) v`, [cons.partyId])).v)).toBe(1250);
    expect(Number((await um<{ v: string }>(`select adiantado_cents v from public.kit_pre_baixas where cycle_id=$1`, [ciclo])).v)).toBe(13750);
  });

  test("0294: Pix desfeito antes só é refeito à mão; refazer vira adiantamento com chave nova e uma baixa ativa só", async () => {
    const outra = await criarConta({ nome: `cons-0294-${marca()}`, papeis: ["consultora"], comParty: true });
    const kit = (await um<{ id: string }>(`insert into public.kits(code) values($1) returning id`, [`ISO-0294-${marca()}`])).id;
    await adm.unsafe(`insert into public.kit_cycles (kit_id, cycle_no, consultora_party_id, status) values ($1, 1, $2, 'operacao')`, [kit, outra.partyId]);
    const { ch, ext } = await cobranca(outra.partyId!, 8800);
    const r1 = await receber(ch);
    expect(r1.dados.acao).toBe("adiantamento_maleta");
    expect((await rpc(master, "asaas_auto_desfazer", { _decisao: r1.dados.decisao, _motivo: "conferir à mão" })).erro).toBeNull();
    const auto = await servico<{ acao: string; motivo: string }>(`public.asaas_auto_receber($1::uuid, false)`, [ch]);
    expect(auto.dados.acao).toBe("ignorado");
    const r2 = await receber(ch);
    expect(r2.erro).toBeNull();
    expect(r2.dados.acao).toBe("adiantamento_maleta");
    const ativas = await um<{ c: number; k: string }>(
      `select count(*)::int c, min(idempotency_key) k from public.financial_settlements s where s.idempotency_key like $1 and not s.is_reversal
         and not exists (select 1 from public.financial_settlements x where x.reversed_of = s.id)`, [`asaas:baixa:${acc}:%${ext}`]);
    expect(ativas.c).toBe(1);
    expect(ativas.k).toBe(`asaas:baixa:${acc}:r1:${ext}`);
    expect((await receber(ch)).dados.acao).toBe("ignorado");
  });

  test("Pix sem maleta aberta e sem nada em aberto continua 3.1.1 comum", async () => {
    const p = await pessoa();
    const { ch } = await cobranca(p, 7000);
    expect((await receber(ch)).dados.acao).toBe("titulo_3_1_1");
    expect((await um<{ c: number }>(`select count(*)::int c from public.asaas_maleta_adiantamentos where charge_id=$1`, [ch])).c).toBe(0);
  });
});

describe("0293 — TED judicial", () => {
  test("TED de tribunal sem processo cadastrado: 7.1.7 com centro Administrativo", async () => {
    const caixa = await pessoa("ISO Caixa Econômica");
    const { ch } = await cobranca(caixa, 120000, { billing: "TRANSFER",
      raw: { description: "Cobrança gerada automaticamente a partir de TED recebido. Nome do tribunal: TJ PARANA" } });
    const r = await receber(ch);
    expect(r.erro).toBeNull();
    expect(r.dados.acao).toBe("titulo_judicial");
    const t = await um<{ chart: string; cc: string }>(
      `select t.chart_account_id::text chart, t.cost_center_id::text cc from public.asaas_charges c join public.financial_titles t on t.id=c.title_id where c.id=$1`, [ch]);
    expect(t).toEqual({ chart: adm717, cc: ccAdm });
  });
});

describe("0293 — extrato: tarifas e baixas já importadas", () => {
  test("tarifa de boleto vai para 4.1.2 e tarifa do Pix para 5.1.3", async () => {
    const out: Record<string, string> = {};
    for (const [nome, desc] of [["boleto", "Taxa de boleto - fatura nr. 700000001 ISO"], ["pix", "Taxa do Pix - fatura nr. 700000002 ISO"]] as const) {
      const ext = `pay_${marca()}`;
      // recebimento já baixado pela planilha (sem tarifa) e a linha dele ligada a essa baixa
      const b = await baixaImportada("receivable", `Recebimento planilha ${ext}`, 4000);
      const rec = await linha("entrada", 4000, { type: "PAYMENT_RECEIVED", paymentId: ext });
      const lig = await rpc(master, "fin_reconcile_baixa_existente", { _line_ids: [rec], _settlement: b.settlement, _idempotency_key: `iso-lig-${ext}`, _observacao: "ISO" });
      expect(lig.erro).toBeNull();
      out[nome] = await linha("saida", 199, { type: "PAYMENT_FEE", paymentId: ext, description: desc });
    }
    const r = await rodarExtrato();
    expect(r.erro).toBeNull();
    for (const [nome, codigo] of [["boleto", "4.1.2"], ["pix", "5.1.3"]] as const) {
      const e = await um<{ codigo: string } | undefined>(
        `select ca.codigo from public.asaas_auto_extrato e join public.financial_titles t on t.id=e.title_id
           join public.chart_of_accounts ca on ca.id=t.chart_account_id where e.tipo='tarifa' and e.chave=$1`, [out[nome]]);
      expect(e?.codigo).toBe(codigo);
    }
  });

  test("taxa de antecipação com o mesmo nº de fatura e valor da baixa importada: liga sozinha, sem lançamento novo; repetida fica para a Mesa", async () => {
    await baixaImportada("payable", "Taxa de antecipacao - fatura nr. 652889544 ISO DALETE", 1135);
    await baixaImportada("receivable", "Antecipacao - fatura nr. 652889544 ISO DALETE", 44580);
    const fee = await linha("saida", 1135, { type: "RECEIVABLE_ANTICIPATION_FEE", description: "Taxa de antecipação - fatura nr. 652889544 ISO DALETE" });
    const cred = await linha("entrada", 44580, { type: "RECEIVABLE_ANTICIPATION_GROSS_CREDIT", description: "Antecipação - fatura nr. 652889544 ISO DALETE" });
    // duas baixas iguais da mesma fatura: ambígua, não liga
    await baixaImportada("payable", "Taxa de antecipacao - fatura nr. 652889999 ISO A", 999);
    await baixaImportada("payable", "Taxa de antecipacao - fatura nr. 652889999 ISO B", 999);
    const amb = await linha("saida", 999, { type: "RECEIVABLE_ANTICIPATION_FEE", description: "Taxa de antecipação - fatura nr. 652889999 ISO" });
    const antesSaldo = await saldoRazao();
    const antesTit = await titulos();
    const r = await rodarExtrato();
    expect(r.erro).toBeNull();
    expect(r.dados.erros).toBe(0);
    expect(await statusLinha(fee)).toBe("conciliada");
    expect(await statusLinha(cred)).toBe("conciliada");
    expect(await statusLinha(amb)).toBe("pendente");
    expect(await saldoRazao()).toBe(antesSaldo);
    expect(await titulos()).toBe(antesTit);
    // desfazer solta a linha e mantém a baixa; a rotina não refaz
    const e = await um<{ id: string }>(`select id from public.asaas_auto_extrato where tipo='fatura_baixa' and chave=$1`, [fee]);
    expect((await rpc(master, "asaas_auto_extrato_desfazer", { _id: e.id, _motivo: "Conferir à mão" })).erro).toBeNull();
    expect(await statusLinha(fee)).toBe("pendente");
    await rodarExtrato();
    expect(await statusLinha(fee)).toBe("pendente");
    expect(await saldoRazao()).toBe(antesSaldo);
  });
});

describe("0293 — Mesa", () => {
  test("ligar a uma transferência interna: lista, liga sem mexer no saldo, não reaproveita a mesma transferência e desliga com motivo", async () => {
    const t = await rpc<string>(master, "fin_transfer_create", { _payload: {
      from_account_id: fin, to_account_id: banco, valor_cents: 30000, data: "2026-01-06", idempotency_key: `iso-tr293-${marca()}` } });
    expect(t.erro).toBeNull();
    const l1 = await linha("saida", 30000, { type: "TRANSFER", description: "Transferência para conta bancária" }, "2026-01-06");
    const l2 = await linha("saida", 30000, { type: "TRANSFER", description: "Transferência para conta bancária" }, "2026-01-07");
    const lista = await rpc<{ id: string; mesmo_valor: boolean }[]>(master, "fin_mesa_transferencias", { _line_id: l1, _busca: null });
    expect(lista.erro).toBeNull();
    expect(lista.dados.find((x) => x.id === t.dados)?.mesmo_valor).toBe(true);
    const antes = await saldoRazao();
    expect((await rpc(master, "fin_mesa_ligar_transferencia", { _line_id: l1, _transfer_id: t.dados, _observacao: null })).erro).toBeNull();
    expect(await statusLinha(l1)).toBe("ignorada");
    expect(await saldoRazao()).toBe(antes);
    expect((await rpc(master, "fin_mesa_ligar_transferencia", { _line_id: l2, _transfer_id: t.dados, _observacao: null })).erro).toContain("já está ligada");
    expect((await rpc<unknown[]>(master, "fin_mesa_transferencias", { _line_id: l2, _busca: null })).dados.length).toBe(0);
    expect((await rpc(cons, "fin_mesa_ligar_transferencia", { _line_id: l2, _transfer_id: t.dados, _observacao: null })).ok).toBe(false);
    expect((await rpc(master, "fin_mesa_desligar_transferencia", { _line_id: l1, _motivo: "Era a outra linha" })).erro).toBeNull();
    expect(await statusLinha(l1)).toBe("pendente");
  });

  test("Baixas já realizadas: baixa de 100 dias antes só aparece buscando pelo nº da fatura (ou pela cobrança da linha)", async () => {
    const velha = await baixaImportada("receivable", "Recebimento - fatura nr. 871021163 ISO ELIANE", 44580, "2026-07-01");
    const l = await linha("entrada", 44580, { type: "PAYMENT_RECEIVED", description: "Cobrança recebida - fatura nr. 999000111 ISO" }, "2026-10-09");
    const sem = await rpc<{ id: string }[]>(master, "fin_mesa_baixas_existentes", { _line_id: l, _busca: null });
    expect(sem.erro).toBeNull();
    expect(sem.dados.some((b) => b.id === velha.settlement)).toBe(false);
    const com = await rpc<{ id: string; fora_janela: boolean }[]>(master, "fin_mesa_baixas_existentes", { _line_id: l, _busca: "871021163" });
    expect(com.dados.find((b) => b.id === velha.settlement)?.fora_janela).toBe(true);
    // a própria fatura da linha também puxa a baixa antiga
    const l2 = await linha("entrada", 44580, { type: "PAYMENT_RECEIVED", description: "Cobrança recebida - fatura nr. 871021163 ISO ELIANE" }, "2026-10-09");
    const auto = await rpc<{ id: string }[]>(master, "fin_mesa_baixas_existentes", { _line_id: l2, _busca: null });
    expect(auto.dados.some((b) => b.id === velha.settlement)).toBe(true);
  });
});
