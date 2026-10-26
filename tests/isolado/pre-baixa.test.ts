/**
 * 0158 — acerto pelo app (pré-baixa). Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let master: Conta, cons: Conta, consB: Conta, intrusa: Conta;
let deposito = "", praca = "", remessa = "", ciclo = "", cicloB = "", vA = "", vB = "", vC = "";

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
  const a = await rpc(c, "kit_aceitar", { _cycle: id, _idempotency_key: `pb-${id}`, _itens: itens.map(([v, q]) => ({ variant_id: v, qty_accepted: q, qty_divergent: 0 })) });
  if (a.erro) throw new Error(a.erro);
  return id;
}

beforeAll(async () => {
  master = await criarConta({ nome: `pb-master-${marca}`, papeis: ["master"], comParty: true });
  cons = await criarConta({ nome: `pb-cons-${marca}`, papeis: ["consultora"], comParty: true });
  consB = await criarConta({ nome: `pb-consB-${marca}`, papeis: ["consultora"], comParty: true });
  intrusa = await criarConta({ nome: `pb-intrusa-${marca}`, papeis: ["consultora"], comParty: true });
  deposito = await criarDeposito(`pb-${marca}`);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça PB ${marca}`])).linhas[0]!.id;
  for (const c of [cons, consB]) {
    await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora')`, [c.partyId]);
    await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id) values ($1,$2) on conflict (party_id) do update set praca_id=excluded.praca_id`, [c.partyId, praca]);
  }
  vA = await criarVariante(`pb-a-${marca}`, 10000);
  vB = await criarVariante(`pb-b-${marca}`, 5000);
  vC = await criarVariante(`pb-c-${marca}`, 3000);
  for (const v of [vA, vB, vC]) await porEstoque(v, deposito, 50);
  // cobrança Lardan configurada (ator técnico = master, como no financeiro real)
  const fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`PB ${marca}`])).id;
  const emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`PB Emp ${marca}`])).id;
  await adm.unsafe(`delete from public.consultora_cobranca_config`);
  await adm.unsafe(`insert into public.consultora_cobranca_config (id, ator_user_id, business_entity_id, financial_account_id) values (true,$1,$2,$3)`, [master.uid, emp, fin]);
  await adm.unsafe(`delete from public.consultora_comissao_faixas`);
  await adm.unsafe(`insert into public.consultora_comissao_faixas (min_vendido_cents, percentual, titulo) values (0,20,'20%'),(20000,25,'25%'),(50000,30,'30%'),(65000,35,'35%'),(120000,40,'40%')`);
  remessa = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _deposito: deposito,
    _data_acerto: new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10) })).dados.id;
  ciclo = await maletaAceita(cons, remessa, [[vA, 4], [vB, 2], [vC, 2]]);
});

describe("pré-baixa pelo app", () => {
  test("venda paga pelo app entra sozinha e não dá para marcar menos", async () => {
    const cli = (await ler<{ id: string }>(cons, `insert into public.consultant_clients (consultora_party_id, nome, telefone) values ($1,'Cli PB','43911112222') returning id`, [cons.partyId])).linhas[0]!.id;
    const o = await rpc<{ order_id: string }>(cons, "consultant_order_create", { _client: cli, _itens: [{ cycle_id: ciclo, variant_id: vA, quantidade: 1 }], _idempotency_key: `pb-o-${marca}` });
    expect(o.erro).toBeNull();
    await adm.unsafe(`update public.sales_orders set payment_status='pago' where id=$1`, [o.dados.order_id]);
    const l = await rpc<{ status: string; itens: { variant_id: string; app: number; vendida: number; preco_cents: number }[] } | null>(cons, "pre_baixa_ler", { _cycle: ciclo });
    expect(l.dados).toBeNull();
    expect((await rpc(cons, "pre_baixa_abrir", { _cycle: ciclo })).erro).toBeNull();
    const l2 = await rpc<{ status: string; itens: { variant_id: string; app: number; vendida: number; preco_cents: number }[] }>(cons, "pre_baixa_ler", { _cycle: ciclo });
    expect(l2.dados.itens.find((i) => i.variant_id === vA)).toMatchObject({ app: 1, vendida: 1, preco_cents: 10000 });
    expect((await rpc(cons, "pre_baixa_vender", { _cycle: ciclo, _variant: vA, _qtd: 0 })).erro).toContain("paga");
    expect((await rpc(cons, "pre_baixa_vender", { _cycle: ciclo, _variant: vA, _qtd: 9 })).erro).toContain("recebeu só 4");
    expect((await rpc(intrusa, "pre_baixa_ler", { _cycle: ciclo })).ok).toBe(false);
    expect((await rpc(intrusa, "pre_baixa_vender", { _cycle: ciclo, _variant: vA, _qtd: 2 })).ok).toBe(false);
  });

  test("lança as vendas: total, faixa pela remessa, comissão e valor a pagar", async () => {
    await rpc(cons, "pre_baixa_vender", { _cycle: ciclo, _variant: vA, _qtd: 3 });
    const c = await rpc<Record<string, number>>(cons, "pre_baixa_vender", { _cycle: ciclo, _variant: vB, _qtd: 1 });
    expect(c.erro).toBeNull();
    // 3 × 100 + 1 × 50 = 350,00 → faixa 25% → comissão 87,50 → paga 262,50
    expect(c.dados).toMatchObject({ vendido_cents: 35000, comissao_pct: 25, comissao_cents: 8750, valor_pagar_cents: 26250 });
  });

  test("sem pré-baixa fechada não sai kit novo (regra ligada pelo Master); liberação do Master vale uma vez", async () => {
    expect((await rpc(cons, "pre_baixa_exigir_definir", { _ligar: true })).ok).toBe(false);
    expect((await rpc(master, "pre_baixa_exigir_definir", { _ligar: true })).erro).toBeNull();
    try {
      const rem2 = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _deposito: deposito })).dados.id;
      const bloq = await rpc(master, "remessa_abrir_maleta", { _remessa: rem2, _consultora: cons.partyId });
      expect(bloq.erro).toContain("pré-baixa");
      expect((await rpc(master, "pre_baixa_liberar_kit", { _consultora: cons.partyId, _motivo: "acerto presencial combinado" })).erro).toBeNull();
      const ok = await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: rem2, _consultora: cons.partyId });
      expect(ok.erro).toBeNull();
      expect(ok.dados.cycle_id).toBeTruthy();   // fica em montagem (não conta para a regra)
      // outra consultora sem maleta anterior: livre
      const outra = await rpc(master, "remessa_abrir_maleta", { _remessa: rem2, _consultora: consB.partyId });
      expect(outra.erro).toBeNull();
    } finally {
      await rpc(master, "pre_baixa_exigir_definir", { _ligar: false });
    }
  });

  test("fecha: título a receber da consultora no valor exato; depois de fechada não muda", async () => {
    const f = await rpc<{ installment_id: string; valor_pagar_cents: number; actor: string }>(cons, "pre_baixa_fechar", { _cycle: ciclo });
    expect(f.erro).toBeNull();
    expect(Number(f.dados.valor_pagar_cents)).toBe(26250);
    expect(f.dados.actor).toBe(master.uid);
    const t = await um<{ party: string; valor: number; origem: string }>(
      `select t.party_id::text party, t.valor_cents::int valor, t.sistema_origem origem from public.financial_installments i join public.financial_titles t on t.id=i.title_id where i.id=$1`, [f.dados.installment_id]);
    expect(t).toEqual({ party: cons.partyId!, valor: 26250, origem: "pre_baixa" });
    expect((await rpc<{ situacao: string }>(cons, "pre_baixa_ler", { _cycle: ciclo })).dados.situacao).toBe("aguardando_pagamento");
    expect((await rpc(cons, "pre_baixa_vender", { _cycle: ciclo, _variant: vB, _qtd: 2 })).erro).toContain("fechada");
    const de_novo = await rpc<{ repetida: boolean; installment_id: string }>(cons, "pre_baixa_fechar", { _cycle: ciclo });
    expect(de_novo.dados).toMatchObject({ repetida: true, installment_id: f.dados.installment_id });
    // Pix pago (o aviso do Asaas liquida a parcela)
    await adm.unsafe(`update public.financial_installments set settlement_status='liquidado' where id=$1`, [f.dados.installment_id]);
    expect((await rpc<{ situacao: string }>(cons, "pre_baixa_ler", { _cycle: ciclo })).dados.situacao).toBe("aguardando_conferencia");
  });

  test("conferência: peça faltando é cobrada como vendida (pendência com título da diferença); o que voltou entra no estoque", async () => {
    // esperado devolver: A 1, B 1, C 2 — chegou A 1, C 2 (faltou 1 B)
    const leit = [{ variant_id: vA, qtd: 1 }, { variant_id: vC, qtd: 2 }];
    expect((await rpc(cons, "pre_baixa_conferir", { _cycle: ciclo, _leituras: leit, _aplicar: false })).ok).toBe(false);
    const prev = await rpc<{ bateu: boolean; pecas_faltando: number; vendido_final_cents: number; diferenca_cents: number; aplicado: boolean }>(
      master, "pre_baixa_conferir", { _cycle: ciclo, _leituras: leit, _aplicar: false });
    expect(prev.erro).toBeNull();
    // 3 A + 2 B = 400,00 → 25% → paga 300,00 → diferença 37,50
    expect(prev.dados).toMatchObject({ bateu: false, pecas_faltando: 1, vendido_final_cents: 40000, diferenca_cents: 3750, aplicado: false });
    const antesA = (await um<{ q: number }>(`select quantity q from public.stock_balances where variant_id=$1 and location_id=$2`, [vA, deposito])).q;
    const ap = await rpc<{ status: string; pendencia_title_id: string }>(master, "pre_baixa_conferir", { _cycle: ciclo, _leituras: leit, _aplicar: true });
    expect(ap.erro).toBeNull();
    expect(ap.dados.status).toBe("pendencia");
    expect((await um<{ v: number }>(`select valor_cents::int v from public.financial_titles where id=$1`, [ap.dados.pendencia_title_id])).v).toBe(3750);
    expect((await um<{ q: number }>(`select quantity q from public.stock_balances where variant_id=$1 and location_id=$2`, [vA, deposito])).q).toBe(antesA + 1);
    const b = await um<{ a: number; bb: number; c: number }>(`select
       max(qty_sold) filter (where variant_id=$2) a, max(qty_sold) filter (where variant_id=$3) bb, max(qty_sold) filter (where variant_id=$4) c
       from public.kit_balances where cycle_id=$1`, [ciclo, vA, vB, vC]);
    expect(b).toEqual({ a: 3, bb: 2, c: 0 });
    expect((await um<{ s: string }>(`select status::text s from public.kit_cycles where id=$1`, [ciclo])).s).toBe("encerrada");
    expect((await rpc(master, "pre_baixa_conferir", { _cycle: ciclo, _leituras: leit, _aplicar: true })).erro).toContain("já foi conferido");
    expect((await rpc(master, "pre_baixa_pendencia_resolver", { _cycle: ciclo, _motivo: "ok" })).erro).toContain("Escreva");
    expect((await rpc(master, "pre_baixa_pendencia_resolver", { _cycle: ciclo, _motivo: "consultora pagou a diferença no Pix" })).erro).toBeNull();
  });

  test("bateu: encerra sem pendência; indicadores do admin", async () => {
    cicloB = await maletaAceita(consB, remessa, [[vC, 3]]);
    await rpc(consB, "pre_baixa_vender", { _cycle: cicloB, _variant: vC, _qtd: 1 });
    const f = await rpc<{ valor_pagar_cents: number }>(consB, "pre_baixa_fechar", { _cycle: cicloB });
    expect(Number(f.dados.valor_pagar_cents)).toBe(2400);   // 30,00 − 20%
    const ap = await rpc<{ status: string; bateu: boolean }>(master, "pre_baixa_conferir", { _cycle: cicloB, _leituras: [{ variant_id: vC, qtd: 2 }], _aplicar: true });
    expect(ap.dados).toMatchObject({ status: "encerrada", bateu: true });
    const ind = await rpc<{ geral: { conferidos: number; sem_divergencia_pct: number }; por_consultora: unknown[] }>(master, "pre_baixa_indicadores", {});
    expect(ind.erro).toBeNull();
    expect(ind.dados.geral.conferidos).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(ind.dados.por_consultora)).toContain(`pb-consB-${marca}`);
    const painel = await rpc<{ cycle_id: string; situacao: string }[]>(master, "pre_baixa_painel", {});
    expect(painel.dados.find((p) => p.cycle_id === cicloB)!.situacao).toBe("encerrada");
    expect((await rpc(cons, "pre_baixa_painel", {})).ok).toBe(false);
  });
});
