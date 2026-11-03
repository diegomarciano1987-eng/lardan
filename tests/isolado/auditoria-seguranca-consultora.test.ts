/**
 * 0199 — Auditoria de segurança do app da consultora (03/11/2026): alcance das rotinas de maletas, is_staff,
 * fotos de divergência, rotinas internas fechadas, parâmetros de montagem e carteira da colaboradora.
 * Banco ISOLADO, dados sintéticos.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
function cpf(base9: string) {
  const d = base9.split("").map(Number);
  const dv = (arr: number[]) => { const s = arr.reduce((a, n, i) => a + n * (arr.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(d);
  return base9 + d1 + dv([...d, d1]);
}
const novoCpf = () => cpf(String(100000000 + Math.floor(Math.random() * 799999999)));

let master: Conta, estoque: Conta, ana: Conta, bia: Conta, rep: Conta, curiosa: Conta;
let deposito = "", pracaAna = "", pracaBia = "", remAna = "", remBia = "", cicloAna = "", cicloBia = "", vA = "", vB = "", vUnica = "", fin = "";
let clienteAna = "";
let cobrancaAntes: Record<string, unknown>[] = [];
let faixasAntes: Record<string, unknown>[] = [];

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
  const a = await rpc(c, "kit_aceitar", { _cycle: id, _idempotency_key: `aud-${id}`, _itens: itens.map(([v, q]) => ({ variant_id: v, qty_accepted: q, qty_divergent: 0 })) });
  if (a.erro) throw new Error(a.erro);
  return id;
}
async function pagar(installment: string, valor: number, chave: string) {
  const s = await um<{ id: string }>(`insert into public.financial_settlements (direction, financial_account_id, valor_cents, idempotency_key) values ('receivable',$1,$2,$3) returning id`, [fin, valor, chave]);
  await adm.unsafe(`insert into public.financial_allocations (settlement_id, installment_id, valor_cents) values ($1,$2,$3)`, [s.id, installment, valor]);
}

beforeAll(async () => {
  master = await criarConta({ nome: `aud-master-${marca}`, papeis: ["master"], comParty: true });
  estoque = await criarConta({ nome: `aud-estoque-${marca}`, papeis: ["estoque"], comParty: true });
  ana = await criarConta({ nome: `aud-ana-${marca} Souza`, papeis: ["consultora"], comParty: true });
  bia = await criarConta({ nome: `aud-bia-${marca} Lima`, papeis: ["consultora"], comParty: true });
  rep = await criarConta({ nome: `aud-rep-${marca}`, papeis: ["representante"], comParty: true });
  curiosa = await criarConta({ nome: `aud-curiosa-${marca}`, papeis: [], comParty: false });
  deposito = await criarDeposito(`aud-${marca}`);
  pracaAna = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça AUD A ${marca}`])).linhas[0]!.id;
  pracaBia = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça AUD B ${marca}`])).linhas[0]!.id;
  for (const c of [ana, bia]) await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [c.partyId]);
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'representante') on conflict do nothing`, [rep.partyId]);
  await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id, representative_party_id) values ($1,$2,$3)
    on conflict (party_id) do update set praca_id=excluded.praca_id, representative_party_id=excluded.representative_party_id`, [ana.partyId, pracaAna, rep.partyId]);
  await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id) values ($1,$2)
    on conflict (party_id) do update set praca_id=excluded.praca_id`, [bia.partyId, pracaBia]);
  await adm.unsafe(`update public.parties set status='ativo' where id in ($1,$2)`, [ana.partyId, bia.partyId]);
  vA = await criarVariante(`aud-a-${marca}`, 10000);
  vB = await criarVariante(`aud-b-${marca}`, 5000);
  vUnica = await criarVariante(`aud-u-${marca}`, 8000);
  for (const v of [vA, vB, vUnica]) await porEstoque(v, deposito, 50);
  fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`AUD ${marca}`])).id;
  const emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`AUD Emp ${marca}`])).id;
  cobrancaAntes = (await adm.unsafe(`select * from public.consultora_cobranca_config`)) as Record<string, unknown>[];
  faixasAntes = (await adm.unsafe(`select min_vendido_cents, percentual, titulo from public.consultora_comissao_faixas`)) as Record<string, unknown>[];
  await adm.unsafe(`delete from public.consultora_cobranca_config where true`);
  await adm.unsafe(`insert into public.consultora_cobranca_config (id, ator_user_id, business_entity_id, financial_account_id) values (true,$1,$2,$3)`, [master.uid, emp, fin]);
  await adm.unsafe(`delete from public.consultora_comissao_faixas where true`);
  await adm.unsafe(`insert into public.consultora_comissao_faixas (min_vendido_cents, percentual, titulo) values (0,20,'20%'),(20000,25,'25%'),(50000,30,'30%'),(65000,35,'35%'),(120000,40,'40%')`);
  const acerto = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
  remAna = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: pracaAna, _deposito: deposito, _data_acerto: acerto })).dados.id;
  remBia = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: pracaBia, _deposito: deposito, _data_acerto: acerto })).dados.id;
  cicloAna = await maletaAceita(ana, remAna, [[vA, 2], [vB, 2], [vUnica, 1]]);
  cicloBia = await maletaAceita(bia, remBia, [[vA, 3]]);
  clienteAna = (await ler<{ id: string }>(ana, `insert into public.consultant_clients (consultora_party_id, nome, telefone) values ($1,'Carla Cliente','43911112222') returning id`,
    [ana.partyId])).linhas[0]!.id;
  await adm.unsafe(`insert into public.kit_divergencia_fotos (cycle_id, variant_id, path, enviado_por) values ($1,$2,$3,$4)`,
    [cicloBia, vA, `${bia.uid}/div-${marca}.jpg`, bia.uid]);
});

afterAll(async () => {
  await adm.unsafe(`delete from public.consultora_cobranca_config where true`);
  for (const c of cobrancaAntes) {
    await adm.unsafe(`insert into public.consultora_cobranca_config (id, ator_user_id, business_entity_id, financial_account_id) values (true,$1,$2,$3)`,
      [c["ator_user_id"], c["business_entity_id"], c["financial_account_id"]]);
  }
  await adm.unsafe(`delete from public.consultora_comissao_faixas where true`);
  for (const f of faixasAntes) {
    await adm.unsafe(`insert into public.consultora_comissao_faixas (min_vendido_cents, percentual, titulo) values ($1,$2,$3)`, [f["min_vendido_cents"], f["percentual"], f["titulo"]]);
  }
});

describe("S1 — consultora não enxerga a rede pelas rotinas da operação", () => {
  test("remessas_lista / remessas_buscar: nada para a consultora; a equipe vê as duas", async () => {
    const a = await ler(ana, `select * from public.remessas_lista(null)`);
    expect(a.erro).toBeNull();
    expect(a.linhas).toEqual([]);
    const lista = await ler<{ id: string }>(ana, `select id from public.remessas_buscar(null,null,null,null,null,null,null)`);
    expect(lista.linhas).toEqual([]);
    const e = await ler<{ id: string }>(estoque, `select id from public.remessas_lista(null) where id in ($1,$2)`, [remAna, remBia]);
    expect(e.linhas.map((x) => x.id).sort()).toEqual([remAna, remBia].sort());
  });

  test("remessa_maletas e praca_consultoras de outra praça: vazio para a consultora e para o representante", async () => {
    for (const quem of [ana, rep]) {
      const m = await ler(quem, `select * from public.remessa_maletas($1)`, [remBia]);
      expect(m.linhas).toEqual([]);
      const p = await ler(quem, `select * from public.praca_consultoras($1, null)`, [pracaBia]);
      expect(p.linhas).toEqual([]);
    }
    const ok = await ler<{ consultora_party_id: string }>(estoque, `select * from public.remessa_maletas($1)`, [remBia]);
    expect(ok.linhas.map((x) => x.consultora_party_id)).toEqual([bia.partyId]);
  });

  test("maleta_total_sugerido de outra pessoa: nada para a consultora", async () => {
    expect((await ler(ana, `select * from public.kit_depositos_operacao()`)).linhas).toEqual([]);
    const r = await ler<{ r: unknown }>(ana, `select public.maleta_total_sugerido($1) r`, [bia.partyId]);
    expect(r.linhas[0]!.r).toBeNull();
    const e = await ler<{ r: { maletas: number } | null }>(estoque, `select public.maleta_total_sugerido($1) r`, [bia.partyId]);
    expect(e.linhas[0]!.r).not.toBeNull();
  });

  test("tabela remessas: a consultora só vê a remessa em que tem maleta", async () => {
    const r = await ler<{ id: string }>(ana, `select id from public.remessas where id in ($1,$2)`, [remAna, remBia]);
    expect(r.linhas.map((x) => x.id)).toEqual([remAna]);
  });
});

describe("S2–S4 — equipe, fotos e rotinas internas", () => {
  test("is_staff: consultora e representante não são equipe; estoque é", async () => {
    for (const [c, esperado] of [[ana, false], [rep, false], [estoque, true]] as const) {
      const r = await ler<{ s: boolean }>(c, `select public.is_staff(auth.uid()) s`);
      expect(r.linhas[0]!.s).toBe(esperado);
    }
  });

  test("foto de divergência da Bia não aparece para a Ana; aparece para a Bia e para a equipe", async () => {
    const q = `select count(*)::int n from public.kit_divergencia_fotos where cycle_id=$1`;
    expect((await ler<{ n: number }>(ana, q, [cicloBia])).linhas[0]!.n).toBe(0);
    expect((await ler<{ n: number }>(bia, q, [cicloBia])).linhas[0]!.n).toBe(1);
    expect((await ler<{ n: number }>(estoque, q, [cicloBia])).linhas[0]!.n).toBe(1);
  });

  test("parâmetros de montagem: a equipe lê, consultora e conta qualquer não", async () => {
    const q = `select count(*)::int n from public.remessa_parametros`;
    expect((await ler<{ n: number }>(estoque, q)).linhas[0]!.n).toBeGreaterThan(0);
    expect((await ler<{ n: number }>(ana, q)).linhas[0]!.n).toBe(0);
    expect((await ler<{ n: number }>(curiosa, q)).linhas[0]!.n).toBe(0);
  });

  test("crm_filtrar e fin_installment_saldo não são chamáveis por conta logada qualquer", async () => {
    expect((await rpc(curiosa, "crm_filtrar", { _f: {} })).ok).toBe(false);
    expect((await rpc(ana, "crm_filtrar", { _f: {} })).ok).toBe(false);
    expect((await rpc(curiosa, "fin_installment_saldo", { _installment: "00000000-0000-0000-0000-000000000000" })).ok).toBe(false);
  });

  test("consultora não libera maleta (sem kit.manage); equipe continua liberando", async () => {
    expect((await rpc(ana, "kit_liberar_consultora", { _cycle: cicloBia })).ok).toBe(false);
    const r = await rpc<{ repetida?: boolean }>(estoque, "kit_liberar_consultora", { _cycle: cicloBia });
    expect(r.erro).toBeNull();
    expect(r.dados.repetida).toBe(true);
  });
});
