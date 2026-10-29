/**
 * 0182 — Painel de incentivo (etiqueta verde no topo do app da consultora). Banco ISOLADO, dados sintéticos.
 * Faixas da bancada: 0 → 20% · 200 → 25% · 500 → 30% · 650 → 35% · 1.200 → 40%.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, VISITANTE, type Conta } from "./base";

const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
let master: Conta, cons: Conta, semMaleta: Conta, ciclo = "";
let minimoAntes: string | null = null;

type Incentivo = {
  maleta: boolean; cycle_id: string; valor_maleta_cents: number; vendido_cents: number; comissao_cents: number;
  comissao_maleta_cents: number; percentual_maleta: number; proxima_ganho_extra_cents: number | null;
  objetivo: { tipo: string; objetivo_cents: number }; objetivo_falta_cents: number; objetivo_batido: boolean;
};

beforeAll(async () => {
  master = await criarConta({ nome: `pi-master-${marca}`, papeis: ["master"], comParty: true });
  cons = await criarConta({ nome: `pi-cons-${marca}`, papeis: ["consultora"], comParty: true });
  semMaleta = await criarConta({ nome: `pi-sem-${marca}`, papeis: ["consultora"], comParty: true });
  minimoAntes = (await um<{ m: string | null }>(`select proxima_maleta_minimo_cents::text m from public.pedido_config limit 1`))?.m ?? null;
  await adm.unsafe(`update public.pedido_config set proxima_maleta_minimo_cents = 65000 where true`);
  for (const c of [cons, semMaleta]) await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [c.partyId]);
  const deposito = await criarDeposito(`pi-${marca}`);
  const praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça PI ${marca}`])).linhas[0]!.id;
  await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id) values ($1,$2) on conflict (party_id) do update set praca_id=excluded.praca_id`, [cons.partyId, praca]);
  await adm.unsafe(`update public.parties set status='ativo' where id=$1`, [cons.partyId]);
  const vA = await criarVariante(`pi-a-${marca}`, 10000);
  const vB = await criarVariante(`pi-b-${marca}`, 5000);
  for (const v of [vA, vB]) await porEstoque(v, deposito, 50);
  const rem = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _deposito: deposito,
    _data_acerto: new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10) })).dados.id;
  // maleta de R$ 1.500 (10 × 100 + 10 × 50), aceita pela consultora
  const itens: [string, number][] = [[vA, 10], [vB, 10]];
  ciclo = (await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: rem, _consultora: cons.partyId })).dados.cycle_id;
  for (const [v, q] of itens) await rpc(master, "kit_item_upsert", { _cycle: ciclo, _variant: v, _qty: q });
  await rpc(master, "kit_conferir", { _cycle: ciclo, _note: null });
  await rpc(master, "kit_expedir", { _cycle: ciclo, _payload: { rota: "direta" } });
  const t = (await um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 order by seq limit 1`, [ciclo])).id;
  await rpc(cons, "kit_transfer_confirm", { _transfer: t, _payload: {} });
  const a = await rpc(cons, "kit_aceitar", { _cycle: ciclo, _idempotency_key: `pi-${ciclo}`, _itens: itens.map(([v, q]) => ({ variant_id: v, qty_accepted: q, qty_divergent: 0 })) });
  if (a.erro) throw new Error(a.erro);
});
afterAll(async () => {
  await adm.unsafe(`update public.pedido_config set proxima_maleta_minimo_cents = $1 where true`, [minimoAntes]);
});

describe("painel de incentivo", () => {
  test("etiqueta: comissão vendendo a maleta inteira, pelas faixas de hoje", async () => {
    const r = await rpc<Incentivo>(cons, "consultora_incentivo");
    expect(r.erro).toBeNull();
    expect(r.dados).toMatchObject({ maleta: true, cycle_id: ciclo });
    expect(Number(r.dados.valor_maleta_cents)).toBe(150000);
    expect(Number(r.dados.comissao_maleta_cents)).toBe(60000);          // 40% de R$ 1.500
    expect(Number(r.dados.percentual_maleta)).toBe(40);
  });

  test("objetivo da maleta (nova → meta mínima), quanto falta e o próximo degrau", async () => {
    const r = (await rpc<Incentivo>(cons, "consultora_incentivo")).dados;
    expect(r.objetivo).toMatchObject({ tipo: "meta" });
    expect(Number(r.objetivo.objetivo_cents)).toBe(65000);
    expect(Number(r.objetivo_falta_cents)).toBe(65000 - Number(r.vendido_cents));
    expect(r.objetivo_batido).toBe(false);
    // sem venda ainda: chegar a R$ 200 (25%) rende R$ 50 a mais do que hoje
    if (Number(r.vendido_cents) === 0) expect(Number(r.proxima_ganho_extra_cents)).toBe(5000);
    // o objetivo do painel é o gravado na maleta
    const g = await um<{ o: string }>(`select objetivo_cents::text o from public.kit_cycles where id=$1`, [ciclo]);
    expect(String(r.objetivo.objetivo_cents)).toBe(g.o);
  });

  test("sem maleta: nada a mostrar; visitante e equipe sem papel de consultora não leem", async () => {
    expect((await rpc<Incentivo>(semMaleta, "consultora_incentivo")).dados).toEqual({ maleta: false } as Incentivo);
    expect((await rpc(VISITANTE, "consultora_incentivo")).ok).toBe(false);
    expect((await rpc(master, "consultora_incentivo")).ok).toBe(false);
  });
});
