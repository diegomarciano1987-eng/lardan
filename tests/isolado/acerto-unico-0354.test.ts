/**
 * 0354 (Diego, 19/11/2026) — duas maletas da mesma remessa e do mesmo acerto: um acerto só no app, UM Pix só.
 * Banco ISOLADO, dados sintéticos.
 *  - o app lê as duas maletas como um acerto (peças das duas, faixa de comissão pela soma);
 *  - fechar gera UM título a receber com o total; as duas pré-baixas apontam para a mesma parcela;
 *  - fechar uma maleta só (caminho antigo) vira o acerto único, nunca um segundo Pix; clique duplo devolve o mesmo título;
 *  - para a Lardan cada maleta segue com a sua pré-baixa e a sua conferência (sem diferença quando bate);
 *  - desfazer (equipe) reabre as duas e cancela o título uma vez; consultora com uma maleta só não muda nada.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const dia = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

let master: Conta, gra: Conta, solo: Conta, intrusa: Conta;
let deposito = "", praca = "", remessa = "", m1 = "", m2 = "", mSolo = "", vA = "", vB = "", vC = "";

async function entregarEAceitar(c: Conta, id: string, itens: [string, number][]) {
  for (const [v, q] of itens) { const r = await rpc(master, "kit_item_upsert", { _cycle: id, _variant: v, _qty: q }); if (r.erro) throw new Error(r.erro); }
  for (const f of ["kit_conferir", "kit_expedir"]) {
    const r = await rpc(master, f, f === "kit_conferir" ? { _cycle: id, _note: null } : { _cycle: id, _payload: { rota: "direta" } });
    if (r.erro) throw new Error(`${f}: ${r.erro}`);
  }
  const t = (await um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 order by seq limit 1`, [id])).id;
  const t1 = await rpc(c, "kit_transfer_confirm", { _transfer: t, _payload: {} });
  if (t1.erro) throw new Error(t1.erro);
  const a = await rpc(c, "kit_aceitar", { _cycle: id, _idempotency_key: `au-${id}`, _itens: itens.map(([v, q]) => ({ variant_id: v, qty_accepted: q, qty_divergent: 0 })) });
  if (a.erro) throw new Error(a.erro);
}

beforeAll(async () => {
  master = await criarConta({ nome: `au-master-${marca}`, papeis: ["master"], comParty: true });
  gra = await criarConta({ nome: `au-graziella-${marca}`, papeis: ["consultora"], comParty: true });
  solo = await criarConta({ nome: `au-solo-${marca}`, papeis: ["consultora"], comParty: true });
  intrusa = await criarConta({ nome: `au-intrusa-${marca}`, papeis: ["consultora"], comParty: true });
  deposito = await criarDeposito(`au-${marca}`);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça AU ${marca}`])).linhas[0]!.id;
  for (const c of [gra, solo]) {
    await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [c.partyId]);
    await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id) values ($1,$2) on conflict (party_id) do update set praca_id=excluded.praca_id`, [c.partyId, praca]);
  }
  vA = await criarVariante(`au-a-${marca}`, 10000);
  vB = await criarVariante(`au-b-${marca}`, 5000);
  vC = await criarVariante(`au-c-${marca}`, 3000);
  for (const v of [vA, vB, vC]) await porEstoque(v, deposito, 50);
  const fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`AU ${marca}`])).id;
  const emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`AU Emp ${marca}`])).id;
  await adm.unsafe(`delete from public.consultora_cobranca_config`);
  await adm.unsafe(`insert into public.consultora_cobranca_config (id, ator_user_id, business_entity_id, financial_account_id) values (true,$1,$2,$3)`, [master.uid, emp, fin]);
  await adm.unsafe(`delete from public.consultora_comissao_faixas`);
  await adm.unsafe(`insert into public.consultora_comissao_faixas (min_vendido_cents, percentual, titulo) values (0,20,'20%'),(20000,25,'25%'),(50000,30,'30%')`);
  remessa = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _deposito: deposito, _data_acerto: dia(7) })).dados.id;
  m1 = (await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: gra.partyId })).dados.cycle_id;
  const seg = await rpc<{ cycle_id: string }>(master, "remessa_abrir_segunda_maleta", { _remessa: remessa, _consultora: gra.partyId, _motivo: "Duas maletas para a mesma consultora" });
  if (seg.erro) throw new Error(seg.erro);
  m2 = seg.dados.cycle_id;
  mSolo = (await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: solo.partyId })).dados.cycle_id;
  await entregarEAceitar(gra, m1, [[vA, 3], [vB, 2]]);
  await entregarEAceitar(gra, m2, [[vB, 2], [vC, 4]]);
  await entregarEAceitar(solo, mSolo, [[vA, 2]]);
});

describe("0354 — acerto único das duas maletas", () => {
  test("o app lê as duas maletas como um acerto; outra consultora não lê", async () => {
    const g = await rpc<{ grupo: boolean; iniciado: boolean; maletas: { cycle_id: string }[] }>(gra, "pre_baixa_grupo_ler", { _cycle: m2 });
    expect(g.erro).toBeNull();
    expect(g.dados.grupo).toBe(true);
    expect(g.dados.iniciado).toBe(false);
    expect(g.dados.maletas.map((m) => m.cycle_id)).toEqual([m1, m2]);
    expect((await rpc(intrusa, "pre_baixa_grupo_ler", { _cycle: m1 })).ok).toBe(false);
    // consultora com uma maleta só: nada muda
    expect((await rpc<{ grupo: boolean }>(solo, "pre_baixa_grupo_ler", { _cycle: mSolo })).dados).toEqual({ grupo: false });
  });

  test("marca vendas nas duas maletas: faixa pela soma, peças das duas na mesma lista", async () => {
    expect((await rpc(gra, "pre_baixa_grupo_abrir", { _cycle: m1 })).erro).toBeNull();
    await rpc(gra, "pre_baixa_vender", { _cycle: m1, _variant: vA, _qtd: 2 });   // 200,00
    await rpc(gra, "pre_baixa_vender", { _cycle: m2, _variant: vB, _qtd: 1 });   //  50,00
    await rpc(gra, "pre_baixa_vender", { _cycle: m2, _variant: vC, _qtd: 1 });   //  30,00
    const g = await rpc<{ iniciado: boolean; calculo: Record<string, number>; itens: { cycle_id: string }[] }>(gra, "pre_baixa_grupo_ler", { _cycle: m1 });
    expect(g.dados.iniciado).toBe(true);
    expect(new Set(g.dados.itens.map((i) => i.cycle_id))).toEqual(new Set([m1, m2]));
    expect(g.dados.itens.length).toBe(4);
    // 280,00 somadas → faixa 25% (sozinha a maleta 2 ficaria em 20%) → comissão 70,00 → paga 210,00
    expect(g.dados.calculo).toMatchObject({ vendido_cents: 28000, comissao_pct: 25, comissao_cents: 7000, valor_pagar_cents: 21000 });
  });

  test("fechar pelo caminho de uma maleta só vira o acerto único: UM título com o total, as duas na mesma parcela", async () => {
    const f = await rpc<{ installment_id: string; valor_pagar_cents: number; repetida: boolean; grupo: string }>(gra, "pre_baixa_fechar", { _cycle: m2 });
    expect(f.erro).toBeNull();
    expect(Number(f.dados.valor_pagar_cents)).toBe(21000);
    expect(f.dados.grupo).toBeTruthy();
    const pbs = (await adm.unsafe(`select cycle_id::text, installment_id::text, valor_pagar_cents::int v, comissao_pct::int pct, grupo_id::text g
      from public.kit_pre_baixas where cycle_id in ($1,$2) order by valor_pagar_cents desc`, [m1, m2])) as { cycle_id: string; installment_id: string; v: number; pct: number; g: string }[];
    expect(pbs.map((p) => [p.cycle_id, p.v, p.pct])).toEqual([[m1, 15000, 25], [m2, 6000, 25]]);
    expect(new Set(pbs.map((p) => p.installment_id))).toEqual(new Set([f.dados.installment_id]));
    expect(new Set(pbs.map((p) => p.g)).size).toBe(1);
    const t = await um<{ n: number; valor: number }>(`select count(*)::int n, max(valor_cents)::int valor from public.financial_titles
      where party_id=$1 and sistema_origem='pre_baixa' and status <> 'cancelado'`, [gra.partyId]);
    expect(t).toEqual({ n: 1, valor: 21000 });
    // clique duplo / "Ver o Pix" pela outra maleta: o mesmo título, nenhum novo
    const de_novo = await rpc<{ repetida: boolean; installment_id: string; valor_pagar_cents: number }>(gra, "pre_baixa_grupo_fechar", { _cycle: m1 });
    expect(de_novo.dados).toMatchObject({ repetida: true, installment_id: f.dados.installment_id });
    expect(Number(de_novo.dados.valor_pagar_cents)).toBe(21000);
    expect((await um<{ n: number }>(`select count(*)::int n from public.financial_titles where party_id=$1 and sistema_origem='pre_baixa'`, [gra.partyId])).n).toBe(1);
    expect((await rpc<{ situacao: string }>(gra, "pre_baixa_grupo_ler", { _cycle: m1 })).dados.situacao).toBe("aguardando_pagamento");
  });

  test("Pix pago: as duas ficam aguardando conferência; a Lardan confere cada maleta separada e bate sem diferença", async () => {
    const inst = (await um<{ i: string }>(`select installment_id::text i from public.kit_pre_baixas where cycle_id=$1`, [m1])).i;
    await adm.unsafe(`update public.financial_installments set settlement_status='liquidado' where id=$1`, [inst]);
    expect((await rpc<{ situacao: string }>(gra, "pre_baixa_ler", { _cycle: m1 })).dados.situacao).toBe("aguardando_conferencia");
    expect((await rpc<{ situacao: string }>(gra, "pre_baixa_ler", { _cycle: m2 })).dados.situacao).toBe("aguardando_conferencia");
    // maleta 1 volta: A 1, B 2 (vendeu 2 A)
    const c1 = await rpc<{ diferenca_cents: number; comissao_pct: number }>(master, "pre_baixa_conferir", { _cycle: m1, _leituras: [{ variant_id: vA, qtd: 1 }, { variant_id: vB, qtd: 2 }], _aplicar: false });
    expect(c1.erro).toBeNull();
    expect(c1.dados).toMatchObject({ diferenca_cents: 0, comissao_pct: 25 });
    // maleta 2 volta: B 1, C 3
    const c2 = await rpc<{ diferenca_cents: number; comissao_pct: number }>(master, "pre_baixa_conferir", { _cycle: m2, _leituras: [{ variant_id: vB, qtd: 1 }, { variant_id: vC, qtd: 3 }], _aplicar: false });
    expect(c2.dados).toMatchObject({ diferenca_cents: 0, comissao_pct: 25 });
  });

  test("desfazer (equipe) reabre as duas e cancela o título uma vez", async () => {
    // cenário novo e sem pagamento: outra remessa com duas maletas
    const rem2 = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _deposito: deposito, _data_acerto: dia(5) })).dados.id;
    const a = (await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: rem2, _consultora: gra.partyId })).dados.cycle_id;
    const b = (await rpc<{ cycle_id: string }>(master, "remessa_abrir_segunda_maleta", { _remessa: rem2, _consultora: gra.partyId, _motivo: "Segunda maleta de teste" })).dados.cycle_id;
    await entregarEAceitar(gra, a, [[vA, 1]]);
    await entregarEAceitar(gra, b, [[vC, 1]]);
    await rpc(gra, "pre_baixa_vender", { _cycle: a, _variant: vA, _qtd: 1 });
    const f = await rpc<{ installment_id: string }>(gra, "pre_baixa_grupo_fechar", { _cycle: a });
    expect(f.erro).toBeNull();
    expect((await rpc(gra, "pre_baixa_desfazer", { _cycle: b, _motivo: "consultora fechou sem querer" })).ok).toBe(false);
    const d = await rpc<{ titulo_cancelado: string; grupo: string }>(master, "pre_baixa_desfazer", { _cycle: b, _motivo: "consultora fechou sem querer" });
    expect(d.erro).toBeNull();
    const st = (await adm.unsafe(`select status, grupo_id, installment_id from public.kit_pre_baixas where cycle_id in ($1,$2)`, [a, b])) as { status: string; grupo_id: string | null; installment_id: string | null }[];
    expect(st.every((x) => x.status === "aberta" && x.grupo_id === null && x.installment_id === null)).toBe(true);
    expect((await um<{ s: string }>(`select t.status s from public.financial_titles t join public.financial_installments i on i.title_id=t.id where i.id=$1`, [f.dados.installment_id])).s).toBe("cancelado");
  });

  test("consultora com uma maleta só fecha como sempre (título da maleta, sem grupo)", async () => {
    await rpc(solo, "pre_baixa_vender", { _cycle: mSolo, _variant: vA, _qtd: 1 });
    const f = await rpc<{ valor_pagar_cents: number; grupo?: string }>(solo, "pre_baixa_fechar", { _cycle: mSolo });
    expect(f.erro).toBeNull();
    expect(Number(f.dados.valor_pagar_cents)).toBe(8000);   // 100,00 − 20%
    expect(f.dados.grupo).toBeUndefined();
    expect((await um<{ g: string | null }>(`select grupo_id g from public.kit_pre_baixas where cycle_id=$1`, [mSolo])).g).toBeNull();
  });
});
