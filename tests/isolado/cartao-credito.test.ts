/**
 * Cartão de crédito: fatura única a pagar + gastos na DRE pela data da compra.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

let master: Conta;
let consultora: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
let planoA: string, planoB: string, banco: string, emissor: string, cartao: string, fatura: string;

const ok = async <T>(c: Conta, f: string, a: Record<string, unknown>) => {
  const r = await rpc<T>(c, f, a);
  if (!r.ok) throw new Error(r.erro!);
  return r.dados;
};
const dre = (regime: string, de: string, ate: string) =>
  ok<{ totais: Record<string, number>; indicadores: Record<string, { quantidade: number; valor_cents: number }> }>(
    master, "fin_dre", { _filtros: { de, ate, regime } });
const baseSoma = async (regime: string, de: string, ate: string, plano: string) =>
  Number((await um<{ s: string | null }>(
    `select sum(valor_cents) s from public.fin_dre_base($1,$2,$3,null,null) where chart_id=$4`, [de, ate, regime, plano])).s ?? 0);

beforeAll(async () => {
  master = await criarConta({ nome: "master-cartao", papeis: ["master"], comParty: true });
  consultora = await criarConta({ nome: "cons-cartao", papeis: ["consultora"], comParty: true });
  const plano = async () => (await um<{ id: string }>(
    `insert into public.chart_of_accounts (codigo, nome, natureza) values ($1,$1,'despesa') returning id`, [`ISO-CC-${marca()}`])).id;
  planoA = await plano();
  planoB = await plano();
  banco = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'conta_corrente') returning id`, [`ISO Banco ${marca()}`])).id;
  emissor = (await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('organizacao',$1,$1,'ativo') returning id`, [`ISO Emissor ${marca()}`])).id;
});

describe("cartão de crédito", () => {
  test("consultora não cria cartão; master cria conta + configuração", async () => {
    const neg = await rpc(consultora, "fin_cartao_criar", { _payload: { nome: "X", dia_vencimento: 10 } });
    expect(neg.ok).toBe(false);
    cartao = await ok<string>(master, "fin_cartao_criar", {
      _payload: { nome: `ISO Cartão ${marca()}`, dia_vencimento: 10, dia_fechamento: 3, limite_cents: 500000, conta_pagamento_id: banco, emissor_party_id: emissor, final_cartao: "12-34" } });
    const c = await um<{ kind: string; final_cartao: string }>(
      `select a.kind::text, c.final_cartao from public.financial_accounts a join public.fin_cartoes c on c.account_id=a.id where a.id=$1`, [cartao]);
    expect(c).toEqual({ kind: "cartao_credito", final_cartao: "1234" });
  });

  test("abrir fatura é idempotente por mês", async () => {
    fatura = await ok<string>(master, "fin_cartao_fatura_abrir", { _account: cartao, _referencia: "2026-09", _vencimento: "2026-09-10" });
    const de_novo = await ok<string>(master, "fin_cartao_fatura_abrir", { _account: cartao, _referencia: "2026-09", _vencimento: "2026-09-10" });
    expect(de_novo).toBe(fatura);
  });

  test("importação: repetições legítimas entram, reimportar não duplica", async () => {
    const linhas = [
      { data: "2026-08-05", descricao: "POSTO SHELL", valor_cents: 10000, ocorrencia: 1 },
      { data: "2026-08-05", descricao: "POSTO SHELL", valor_cents: 10000, ocorrencia: 2 },
      { data: "2026-08-20", descricao: "META ADS", valor_cents: 30000, ocorrencia: 1 },
      { data: "2026-08-21", descricao: "ESTORNO LOJA", valor_cents: -5000, ocorrencia: 1 },
    ];
    expect(await ok(master, "fin_cartao_importar", { _fatura: fatura, _linhas: linhas })).toEqual({ inseridos: 4, repetidos: 0 });
    expect(await ok(master, "fin_cartao_importar", { _fatura: fatura, _linhas: linhas })).toEqual({ inseridos: 0, repetidos: 4 });
  });

  test("não fecha com gasto sem categoria", async () => {
    const r = await rpc(master, "fin_cartao_fechar", { _fatura: fatura, _payload: {} });
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("sem categoria");
  });

  test("DRE competência: gastos sem categoria aparecem como pendentes, não somem", async () => {
    const d = await dre("competencia", "2026-08-01", "2026-08-31");
    expect(d.indicadores["pendentes_classificacao"]?.valor_cents ?? Object.values(d.indicadores).some((i) => i.valor_cents >= 45000)).toBeTruthy();
  });

  test("classificar valida natureza e audita; fechar gera UMA conta a pagar", async () => {
    const ls = (await adm.unsafe(`select id, descricao from public.fin_cartao_lancamentos where fatura_id=$1`, [fatura])) as { id: string; descricao: string }[];
    const receita = (await um<{ id: string }>(`insert into public.chart_of_accounts (codigo, nome, natureza) values ($1,$1,'receita') returning id`, [`ISO-R-${marca()}`])).id;
    const ruim = await rpc(master, "fin_cartao_classificar", { _itens: [{ id: ls[0]!.id, chart_account_id: receita }] });
    expect(ruim.ok).toBe(false);
    await ok(master, "fin_cartao_classificar", {
      _itens: ls.map((l) => ({ id: l.id, chart_account_id: l.descricao === "META ADS" ? planoB : planoA, origem: "manual" })) });
    const tid = await ok<string>(master, "fin_cartao_fechar", { _fatura: fatura, _payload: { vencimento: "2026-09-12" } });
    const t = await um<{ valor_cents: string; origem: string; party_id: string; financial_account_id: string; parcelas: string; venc: string }>(
      `select t.valor_cents, t.origem, t.party_id, t.financial_account_id, count(i.*) parcelas, max(i.vencimento)::text venc
         from public.financial_titles t join public.financial_installments i on i.title_id=t.id where t.id=$1 group by t.id`, [tid]);
    expect(Number(t.valor_cents)).toBe(45000);
    expect(t.origem).toBe("cartao_fatura");
    expect(t.party_id).toBe(emissor);
    expect(t.financial_account_id).toBe(banco);
    expect(Number(t.parcelas)).toBe(1);
    expect(t.venc).toBe("2026-09-12");
    const imp = await rpc(master, "fin_cartao_importar", { _fatura: fatura, _linhas: [{ data: "2026-08-30", descricao: "Y", valor_cents: 100 }] });
    expect(imp.ok).toBe(false);
  });

  test("DRE competência: gastos por data da compra (agosto); a fatura de setembro não conta de novo", async () => {
    expect(await baseSoma("competencia", "2026-08-01", "2026-08-31", planoA)).toBe(15000);
    expect(await baseSoma("competencia", "2026-08-01", "2026-08-31", planoB)).toBe(30000);
    const set = Number((await um<{ s: string | null }>(
      `select sum(b.valor_cents) s from public.fin_dre_base('2026-09-01','2026-09-30','competencia',null,null) b
        join public.fin_cartao_faturas f on f.title_id=b.title_id where f.id=$1`, [fatura])).s ?? 0);
    expect(set).toBe(0);
  });

  test("DRE caixa: pagamento parcial distribui proporcional, exato ao centavo", async () => {
    const inst = (await um<{ id: string }>(`select i.id from public.financial_installments i join public.fin_cartao_faturas f on f.title_id=i.title_id where f.id=$1`, [fatura])).id;
    const s = await um<{ id: string }>(
      `insert into public.financial_settlements (direction, financial_account_id, data, valor_cents, idempotency_key) values ('payable',$1,'2026-09-12',10001,$2) returning id`, [banco, marca()]);
    await adm.unsafe(`insert into public.financial_allocations (settlement_id, installment_id, valor_cents) values ($1,$2,10001)`, [s.id, inst]);
    const a = await baseSoma("caixa", "2026-09-01", "2026-09-30", planoA);
    const b = await baseSoma("caixa", "2026-09-01", "2026-09-30", planoB);
    expect(a + b).toBe(10001);
    expect(Math.abs(b - Math.round((10001 * 30000) / 45000))).toBeLessThanOrEqual(1);
  });

  test("não reabre fatura já paga", async () => {
    const r = await rpc(master, "fin_cartao_reabrir", { _fatura: fatura, _motivo: "teste" });
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("pagamento");
  });

  test("reabrir fatura sem pagamento cancela o título e permite corrigir", async () => {
    const f2 = await ok<string>(master, "fin_cartao_fatura_abrir", { _account: cartao, _referencia: "2026-10", _vencimento: "2026-10-10" });
    await ok(master, "fin_cartao_importar", { _fatura: f2, _linhas: [{ data: "2026-09-15", descricao: "GRAFICA", valor_cents: 2000, ocorrencia: 1 }] });
    const l = await um<{ id: string }>(`select id from public.fin_cartao_lancamentos where fatura_id=$1`, [f2]);
    await ok(master, "fin_cartao_classificar", { _itens: [{ id: l.id, chart_account_id: planoA }] });
    const tid = await ok<string>(master, "fin_cartao_fechar", { _fatura: f2, _payload: {} });
    await ok(master, "fin_cartao_reabrir", { _fatura: f2, _motivo: "valor errado" });
    expect((await um<{ status: string }>(`select status::text from public.financial_titles where id=$1`, [tid])).status).toBe("cancelado");
    expect((await um<{ status: string }>(`select status from public.fin_cartao_faturas where id=$1`, [f2])).status).toBe("aberta");
    const aud = await um<{ c: string }>(`select count(*) c from public.audit_logs where action like 'financeiro.cartao.%' and entity_id in ($1,$2)`, [fatura, f2]);
    expect(Number(aud.c)).toBeGreaterThanOrEqual(5);
  });
});
