/**
 * Correção do financeiro — tarifa com regra única, DRE com encargos,
 * novo lançamento atômico na Mesa e vínculo 1:N. Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

let master: Conta;
let semAcesso: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const DIA = "2026-09-15";
let planoReceita: string, planoDespesa: string, planoTarifa: string, planoJuros: string;

async function conta() {
  return (await um<{ id: string }>(
    `insert into public.financial_accounts (nome, kind) values ($1,'conta_corrente') returning id`, [`ISO Banco ${marca()}`])).id;
}
async function linha(acc: string, valor: number, kind: "entrada" | "saida", hist = "PIX ISO") {
  const f = await um<{ id: string }>(
    `insert into public.financial_statement_files (financial_account_id, storage_path, original_name, format, sha256)
     values ($1,'iso/x.ofx','x.ofx','ofx',$2) returning id`, [acc, marca()]);
  const i = await um<{ id: string }>(
    `insert into public.financial_statement_imports (file_id, financial_account_id) values ($1,$2) returning id`, [f.id, acc]);
  return (await um<{ id: string }>(
    `insert into public.financial_statement_lines (import_id, file_id, financial_account_id, line_no, data, valor_cents, kind, historico, hash, status)
     values ($1,$2,$3,1,$4,$5,$6,$7,$8,'pendente') returning id`,
    [i.id, f.id, acc, DIA, valor, kind, hist, marca()])).id;
}
async function titulo(direction: "receivable" | "payable", valor: number, plano: string) {
  const p = await um<{ id: string }>(
    `insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO P ${marca()}`]);
  const r = await rpc<string>(master, "fin_title_create", {
    _payload: { direction, party_id: p.id, descricao: `ISO ${marca()}`, valor_cents: valor, emissao: DIA, competencia: DIA,
      chart_account_id: plano, parcelas: [{ vencimento: DIA, valor_cents: valor }] },
  });
  if (!r.ok) throw new Error(r.erro!);
  const inst = await um<{ id: string }>(`select id from public.financial_installments where title_id=$1`, [r.dados]);
  return { title: r.dados, inst: inst.id, party: p.id };
}
const parcela = (id: string) =>
  um<{ settlement_status: string; saldo: number }>(
    `select i.settlement_status, p.saldo_cents::int saldo from public.financial_installments i
       join public.fin_parcela_posicao('2099-12-31') p on p.installment_id = i.id where i.id=$1`, [id]);
const razao = async (acc: string) =>
  ((await adm.unsafe(`select valor_cents::int v from public.financial_account_movements where financial_account_id=$1 order by valor_cents desc`, [acc])) as { v: number }[]).map((x) => x.v);
const dre = async (de = DIA, ate = DIA) => {
  const r = await rpc<{ totais: Record<string, number>; indicadores: Record<string, { quantidade: number; valor_cents: number }> }>(
    master, "fin_dre", { _filtros: { de, ate, regime: "caixa" } });
  if (!r.ok) throw new Error(r.erro!);
  return r.dados;
};

beforeAll(async () => {
  master = await criarConta({ nome: "master-tarifa", papeis: ["master"], comParty: true });
  semAcesso = await criarConta({ nome: "cons-tarifa", papeis: ["consultora"], comParty: true });
  const plano = async (nat: string) =>
    (await um<{ id: string }>(`insert into public.chart_of_accounts (codigo, nome, natureza) values ($1,$1,$2::fin_account_nature) returning id`,
      [`ISO-${nat}-${marca()}`, nat])).id;
  planoReceita = await plano("receita");
  planoDespesa = await plano("despesa");
  planoTarifa = await plano("despesa");
  planoJuros = await plano("receita");
  // DRE com dia isolado: sem contas padrão, os encargos aparecem no indicador
  await adm.unsafe(`delete from public.site_settings where key='financeiro.contas_encargos'`);
});

describe("1) tarifa — regra única", () => {
  test("recebimento 98,01 = 100,00 − 1,99: liquida a parcela e o razão mostra +100,00 e −1,99", async () => {
    const acc = await conta();
    const l = await linha(acc, 9801, "entrada");
    const t = await titulo("receivable", 10000, planoReceita);

    const errado = await rpc(master, "fin_reconcile", {
      _payload: { line_ids: [l], alocacoes: [{ installment_id: t.inst, valor_cents: 9602 }], tarifa_cents: 199, idempotency_key: marca() } });
    expect(errado.ok).toBe(false);

    const key = marca();
    const payload = { line_ids: [l], alocacoes: [{ installment_id: t.inst, valor_cents: 10000 }], tarifa_cents: 199, idempotency_key: key };
    const ok = await rpc<{ repetido: boolean; settlement_id: string }>(master, "fin_reconcile", { _payload: payload });
    expect(ok.erro).toBeNull();
    expect(await parcela(t.inst)).toEqual({ settlement_status: "liquidado", saldo: 0 });
    expect(await razao(acc)).toEqual([10000, -199]);
    const s = await um<{ valor_cents: number }>(`select valor_cents::int valor_cents from public.financial_settlements where id=$1`, [ok.dados.settlement_id]);
    expect(s.valor_cents).toBe(10000);
    expect((await um<{ c: number }>(`select count(*)::int c from public.financial_adjustments where installment_id=$1 and kind='tarifa'`, [t.inst])).c).toBe(0);

    const rep = await rpc<{ repetido: boolean }>(master, "fin_reconcile", { _payload: payload });
    expect(rep.dados.repetido).toBe(true);
    expect(await razao(acc)).toEqual([10000, -199]);
  });

  test("pagamento 101,99 = 100,00 + 1,99: liquida e o razão mostra −100,00 e −1,99", async () => {
    const acc = await conta();
    const l = await linha(acc, 10199, "saida");
    const t = await titulo("payable", 10000, planoDespesa);
    const ok = await rpc(master, "fin_reconcile", {
      _payload: { line_ids: [l], alocacoes: [{ installment_id: t.inst, valor_cents: 10000 }], tarifa_cents: 199, idempotency_key: marca() } });
    expect(ok.erro).toBeNull();
    expect(await parcela(t.inst)).toEqual({ settlement_status: "liquidado", saldo: 0 });
    expect(await razao(acc)).toEqual([-199, -10000]);
  });

  test("juros continuam ajuste da parcela e a alocação cobre o saldo ajustado", async () => {
    const acc = await conta();
    const l = await linha(acc, 10301, "entrada");
    const t = await titulo("receivable", 10000, planoReceita);
    const ok = await rpc(master, "fin_reconcile", {
      _payload: { line_ids: [l], alocacoes: [{ installment_id: t.inst, valor_cents: 10500 }], tarifa_cents: 199, juros_cents: 500, idempotency_key: marca() } });
    expect(ok.erro).toBeNull();
    expect(await parcela(t.inst)).toEqual({ settlement_status: "liquidado", saldo: 0 });
  });

  test("consulta de leitura das tarifas antigas exige acesso financeiro", async () => {
    expect((await rpc(master, "fin_auditoria_tarifa_conciliacao")).ok).toBe(true);
    expect((await rpc(semAcesso, "fin_auditoria_tarifa_conciliacao")).ok).toBe(false);
  });
});

describe("2) DRE caixa com encargos", () => {
  test("receita 100,00, tarifa 1,99, resultado 98,01 — sem conta padrão, vai para 'encargos sem conta'", async () => {
    const d1 = "2026-08-03";
    const acc = await conta();
    const l = (await um<{ id: string }>(`update public.financial_statement_lines set data=$2 where id=$1 returning id`, [await linha(acc, 9801, "entrada"), d1])).id;
    const p = await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa','ISO DRE','ISO DRE','ativo') returning id`);
    const r = await rpc<string>(master, "fin_title_create", { _payload: { direction: "receivable", party_id: p.id, descricao: "ISO DRE", valor_cents: 10000,
      emissao: d1, chart_account_id: planoReceita, parcelas: [{ vencimento: d1, valor_cents: 10000 }] } });
    const inst = (await um<{ id: string }>(`select id from public.financial_installments where title_id=$1`, [r.dados])).id;
    expect((await rpc(master, "fin_reconcile", { _payload: { line_ids: [l], alocacoes: [{ installment_id: inst, valor_cents: 10000 }], tarifa_cents: 199, idempotency_key: marca() } })).erro).toBeNull();

    const sem = await dre(d1, d1);
    expect(sem.totais.receita_bruta_cents).toBe(10000);
    expect(sem.indicadores.encargos_sem_conta!.valor_cents).toBe(199);

    expect((await rpc(master, "fin_encargos_contas_set", { _payload: { tarifas: planoTarifa, juros_recebidos: planoJuros } })).erro).toBeNull();
    const com = await dre(d1, d1);
    expect(com.totais.receita_bruta_cents).toBe(10000);
    expect(com.totais.despesas_cents).toBe(199);
    expect(com.totais.resultado_cents).toBe(9801);
    expect(com.indicadores.encargos_sem_conta!.valor_cents).toBe(0);

    const det = await rpc<{ soma_cents: number }>(master, "fin_dre_detalhe", { _filtros: { de: d1, ate: d1, regime: "caixa", chart_id: planoTarifa } });
    expect(det.dados.soma_cents).toBe(199);
    expect((await rpc(semAcesso, "fin_encargos_contas_set", { _payload: {} })).ok).toBe(false);
  });
});

describe("5) novo lançamento atômico", () => {
  test("cria título ativo com origem extrato e concilia numa só chamada; repetir devolve o mesmo", async () => {
    const acc = await conta();
    const l = await linha(acc, 5000, "saida", "TARIFA AVULSA");
    const p = await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa','ISO Novo','ISO Novo','ativo') returning id`);
    const payload = { line_id: l, party_id: p.id, descricao: "Despesa avulsa", competencia: "2026-08-01", chart_account_id: planoDespesa };
    const a = await rpc<{ title_id: string; repetido: boolean }>(master, "fin_mesa_novo_conciliar", { _payload: payload });
    expect(a.erro).toBeNull();
    const t = await um<{ status: string; sistema_origem: string; id_externo: string; competencia: string }>(
      `select status::text, sistema_origem, id_externo, competencia::text from public.financial_titles where id=$1`, [a.dados.title_id]);
    expect(t).toEqual({ status: "ativo", sistema_origem: "extrato", id_externo: `extrato:${l}`, competencia: "2026-08-01" });
    const b = await rpc<{ title_id: string; repetido: boolean }>(master, "fin_mesa_novo_conciliar", { _payload: payload });
    expect(b.dados.repetido).toBe(true);
    expect(b.dados.title_id).toBe(a.dados.title_id);
    expect((await um<{ c: number }>(`select count(*)::int c from public.financial_titles where id_externo=$1`, [`extrato:${l}`])).c).toBe(1);
  });

  test("regra de aprovação exigindo rascunho recusa sem criar nada", async () => {
    const acc = await conta();
    const l = await linha(acc, 7000, "saida");
    const p = await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa','ISO Apr','ISO Apr','ativo') returning id`);
    await adm.unsafe(`insert into public.site_settings (key, value) values ('financeiro.aprovacao','{"exigir":true,"valor_minimo_cents":0}') on conflict (key) do update set value=excluded.value`);
    try {
      const r = await rpc(master, "fin_mesa_novo_conciliar", { _payload: { line_id: l, party_id: p.id, descricao: "x" } });
      expect(r.ok).toBe(false);
      expect(r.erro).toContain("rascunho");
      expect((await um<{ c: number }>(`select count(*)::int c from public.financial_titles where id_externo=$1`, [`extrato:${l}`])).c).toBe(0);
    } finally {
      await adm.unsafe(`delete from public.site_settings where key='financeiro.aprovacao'`);
    }
  });
});

describe("6) conciliação 1:N grava cada par linha × parcela", () => {
  test("duas linhas para duas parcelas: vínculos com o valor real de cada uma", async () => {
    const acc = await conta();
    const l1 = await linha(acc, 3000, "entrada");
    const l2 = await linha(acc, 7000, "entrada");
    const t1 = await titulo("receivable", 3000, planoReceita);
    const t2 = await titulo("receivable", 7000, planoReceita);
    const r = await rpc<{ id: string }>(master, "fin_reconcile", { _payload: { line_ids: [l1, l2],
      alocacoes: [{ installment_id: t1.inst, valor_cents: 3000 }, { installment_id: t2.inst, valor_cents: 7000 }], idempotency_key: marca() } });
    expect(r.erro).toBeNull();
    const pares = (await adm.unsafe(
      `select line_id, installment_id, valor_cents::int v from public.financial_reconciliation_allocations where reconciliation_id=$1 order by v`, [r.dados.id])) as { line_id: string; installment_id: string; v: number }[];
    expect(pares.map((p) => p.v)).toEqual([3000, 7000]);
    expect(new Set(pares.map((p) => p.installment_id))).toEqual(new Set([t1.inst, t2.inst]));
    expect(pares.reduce((s, p) => s + p.v, 0)).toBe(10000);
  });
});
