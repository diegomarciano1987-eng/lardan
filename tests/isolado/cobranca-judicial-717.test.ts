/**
 * Etapa D (0234) — banco ISOLADO, dados sintéticos.
 *  1. Fatura nova de venda (consultora/PDV/representante) sem classificação nasce na 3.1.1; classificação dada é respeitada.
 *  2. TED de recurso judicial sugere 7.1.7 e acha a devedora pelo número do processo (20 dígitos no histórico).
 *  3. Palavra judicial sem processo cadastrado: sugere 7.1.7 sem devedora. Pix comum: nenhuma sugestão.
 *  4. Só sugere: nada é conciliado; a função de apoio não é chamável por usuário.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0];
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let conta311: string, conta717: string, party: string;

async function servico<T>(sql: string, p: unknown[] = []): Promise<T> {
  const c = await adm.reserve();
  try {
    await c.unsafe(`set role service_role`);
    return ((await c.unsafe(sql, p)) as { r: T }[])[0].r;
  } finally {
    try { await c.unsafe(`reset role`); } catch { /* */ }
    c.release();
  }
}

beforeAll(async () => {
  const a = await um<{ id: string }>(`select id from chart_of_accounts where codigo='3.1.1'`);
  conta311 = a?.id ?? (await um<{ id: string }>(
    `insert into chart_of_accounts(codigo,nome) values ('3.1.1','Revenda de Mercadorias Produção Própria') returning id`))!.id;
  const b = await um<{ id: string }>(`select id from chart_of_accounts where codigo='7.1.7'`);
  conta717 = b?.id ?? (await um<{ id: string }>(
    `insert into chart_of_accounts(codigo,nome) values ('7.1.7','Recebimento judicial') returning id`))!.id;
  party = (await um<{ id: string }>(
    `insert into parties(display_name, legal_name) values ($1,$1) returning id`, [`Devedora ${marca}`]))!.id;
  await adm.unsafe(`insert into cob_judicial(party_id, processo) values ($1, '0005731-06.2025.8.16.0090')
                    on conflict (party_id) do update set processo = excluded.processo`, [party]);
});
afterAll(async () => { await adm.unsafe(`delete from cob_judicial where party_id=$1`, [party]); });

describe("3.1.1 padrão das faturas de venda", () => {
  test("consultora sem classificação nasce na 3.1.1", async () => {
    const t = await um<{ c: string }>(`insert into financial_titles(direction, descricao, emissao, competencia, valor_cents, origem)
      values ('receivable','teste ${marca}', current_date, current_date, 100, 'consultora') returning chart_account_id c`);
    expect(t!.c).toBe(conta311);
  });
  test("classificação escolhida é respeitada", async () => {
    const t = await um<{ c: string }>(`insert into financial_titles(direction, descricao, emissao, competencia, valor_cents, origem, chart_account_id)
      values ('receivable','teste2 ${marca}', current_date, current_date, 100, 'pdv', $1) returning chart_account_id c`, [conta717]);
    expect(t!.c).toBe(conta717);
  });
  test("outra origem não é tocada", async () => {
    const t = await um<{ c: string | null }>(`insert into financial_titles(direction, descricao, emissao, competencia, valor_cents, origem)
      values ('receivable','teste3 ${marca}', current_date, current_date, 100, 'importacao') returning chart_account_id c`);
    expect(t!.c).toBeNull();
  });
});

describe("sugestão 7.1.7 judicial", () => {
  test("TED de recurso judicial acha a devedora pelo processo", async () => {
    const r = await servico<{ party_id: string; motivo: string; processo: string }>(
      `select public.fin_judicial_por_historico('TED LIBERACAO RECURSO JUDICAIL PAG 0000000057310620258160090') r`);
    expect(r.party_id).toBe(party);
    expect(r.motivo).toBe("numero_processo");
    expect(r.processo).toBe("0005731-06.2025.8.16.0090");
  });
  test("palavra judicial sem processo cadastrado: sem devedora", async () => {
    const r = await servico<{ party_id: string | null; motivo: string }>(
      `select public.fin_judicial_por_historico('TED LIBERACAO RECURSO JUDICAIL PAG 0000000099999920258160090') r`);
    expect(r.party_id).toBeNull();
    expect(r.motivo).toBe("palavra_judicial");
  });
  test("Pix comum não vira judicial", async () => {
    const r = await servico<unknown>(`select public.fin_judicial_por_historico('PIX RECEBIDO MARIA 00823283909') r`);
    expect(r).toBeNull();
  });
  test("usuário comum não chama a função de apoio", async () => {
    const c = await adm.reserve();
    try {
      await c.unsafe(`set role authenticated`);
      await expect(c.unsafe(`select public.fin_judicial_por_historico('x')`)).rejects.toThrow();
    } finally { try { await c.unsafe(`reset role`); } catch { /* */ } c.release(); }
  });
});
