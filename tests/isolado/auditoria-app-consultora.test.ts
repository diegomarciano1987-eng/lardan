/**
 * 0199 — Auditoria do app da consultora (03/11/2026): alcance das rotinas de maletas, is_staff, fotos de divergência,
 * rotinas internas fechadas, crédito quando a cliente paga depois da conferência e peça vendida duas vezes.
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

describe("M4 — a mesma peça não sai em dois pedidos", () => {
  test("peça única: o segundo pedido é recusado; cancelar o primeiro libera", async () => {
    const it = [{ cycle_id: cicloAna, variant_id: vUnica, quantidade: 1 }];
    const p1 = await rpc<{ order_id: string }>(ana, "consultant_order_create", { _client: clienteAna, _itens: it, _idempotency_key: `aud-u1-${marca}` });
    expect(p1.erro).toBeNull();
    const p2 = await rpc(ana, "consultant_order_create", { _client: clienteAna, _itens: it, _idempotency_key: `aud-u2-${marca}` });
    expect(p2.erro).toContain("já está em outro pedido seu");
    await adm.unsafe(`update public.sales_orders set status='cancelado' where id=$1`, [p1.dados.order_id]);
    const p3 = await rpc(ana, "consultant_order_create", { _client: clienteAna, _itens: it, _idempotency_key: `aud-u3-${marca}` });
    expect(p3.erro).toBeNull();
  });

  test("duas linhas da mesma peça no mesmo pedido também contam", async () => {
    const p = await rpc(ana, "consultant_order_create", { _client: clienteAna, _itens: [
      { cycle_id: cicloAna, variant_id: vB, quantidade: 1 }, { cycle_id: cicloAna, variant_id: vB, quantidade: 2 }], _idempotency_key: `aud-b2-${marca}` });
    expect(p.erro).toContain("já está em outro pedido seu");
  });
});

describe("M1–M3 — cobrança da consultora e o acerto", () => {
  let pedidoTarde = "", parcelaTarde = "";

  test("cobrança aberta aparece no cálculo do acerto e no financeiro dela", async () => {
    const o = await rpc<{ order_id: string }>(ana, "consultant_order_create", { _client: clienteAna, _itens: [{ cycle_id: cicloAna, variant_id: vA, quantidade: 1 }], _idempotency_key: `aud-t-${marca}` });
    expect(o.erro).toBeNull();
    pedidoTarde = o.dados.order_id;
    const t = await rpc<{ installment_id: string }>(ana, "consultora_pagamento_titulo", { _order: pedidoTarde, _forma: "depois", _doc: novoCpf(), _venc: null });
    expect(t.erro).toBeNull();
    parcelaTarde = t.dados.installment_id;
    await rpc(ana, "pre_baixa_vender", { _cycle: cicloAna, _variant: vA, _qtd: 1 });
    const l = await rpc<{ calculo: { aguardando_lardan_cents: number; recebido_lardan_cents: number } }>(ana, "pre_baixa_ler", { _cycle: cicloAna });
    expect(l.erro).toBeNull();
    expect(Number(l.dados.calculo.aguardando_lardan_cents)).toBe(10000);
    expect(Number(l.dados.calculo.recebido_lardan_cents)).toBe(0);
    const f = await rpc<{ cobrancas: { codigo: string; situacao: string; valor_cents: number }[] }>(ana, "consultora_meu_financeiro", {});
    expect(f.erro).toBeNull();
    expect(f.dados.cobrancas).toEqual([expect.objectContaining({ situacao: "pendente", valor_cents: 10000 })]);
    // a Bia não vê as cobranças da Ana
    const fb = await rpc<{ cobrancas: unknown[] }>(bia, "consultora_meu_financeiro", {});
    expect(fb.dados.cobrancas).toEqual([]);
  });

  test("cliente paga DEPOIS da conferência: vira crédito da consultora e o acerto volta para pendência", async () => {
    const fe = await rpc(ana, "pre_baixa_fechar", { _cycle: cicloAna });
    expect(fe.erro).toBeNull();
    // voltaram 1 A, 2 B e a peça única: vendeu 1 A = 100,00 → 20% = 20,00 → ela pagou 80,00
    const c = await rpc<{ status: string; valor_final_cents: number }>(master, "pre_baixa_conferir", {
      _cycle: cicloAna, _leituras: [{ variant_id: vA, qtd: 1 }, { variant_id: vB, qtd: 2 }, { variant_id: vUnica, qtd: 1 }], _aplicar: true });
    expect(c.erro).toBeNull();
    expect(c.dados).toMatchObject({ status: "encerrada", valor_final_cents: 8000 });

    await pagar(parcelaTarde, 10000, `aud-pt-${marca}`);
    const pb = await um<{ status: string; diferenca_cents: string; valor_final_cents: string; recebido_lardan_cents: string; pendencia_motivo: string }>(
      `select status, diferenca_cents::text, valor_final_cents::text, recebido_lardan_cents::text, pendencia_motivo from public.kit_pre_baixas where cycle_id=$1`, [cicloAna]);
    expect(pb.status).toBe("pendencia");
    expect(Number(pb.diferenca_cents)).toBe(-10000);
    expect(Number(pb.valor_final_cents)).toBe(-2000);           // pagou 80,00, a cliente pagou 100,00 à Lardan → Lardan deve 20,00 de comissão
    expect(Number(pb.recebido_lardan_cents)).toBe(10000);
    expect(pb.pendencia_motivo).toContain("depois da conferência");
    expect(pb.pendencia_motivo).toContain("R$ 100,00");
    const aj = await um<{ n: number; tipo: string; v: string }>(`select count(*)::int n, max(tipo) tipo, max(valor_cents)::text v from public.consultora_acerto_ajustes where order_id=$1`, [pedidoTarde]);
    expect(aj).toEqual({ n: 1, tipo: "credito", v: "10000" });
    // ela vê o ajuste e o motivo; a Bia não
    const f = await rpc<{ ajustes: { tipo: string; valor_cents: number }[]; acertos: { situacao: string; motivo: string | null }[] }>(ana, "consultora_meu_financeiro", {});
    expect(f.dados.ajustes).toEqual([expect.objectContaining({ tipo: "credito", valor_cents: 10000 })]);
    expect(f.dados.acertos.find((a) => a.situacao === "pendencia")?.motivo).toContain("depois da conferência");
    expect((await ler(bia, `select * from public.consultora_acerto_ajustes`)).linhas).toEqual([]);
    // a pendência resolve pelo caminho de sempre
    expect((await rpc(master, "pre_baixa_pendencia_resolver", { _cycle: cicloAna, _motivo: "Crédito pago no Pix da consultora" })).erro).toBeNull();
  });

  test("estorno depois da conferência faz o inverso (débito) e reabre a pendência", async () => {
    await adm.unsafe(`select public.acerto_ajuste_pos_conferencia($1, 'debito')`, [pedidoTarde]);
    const pb = await um<{ status: string; diferenca_cents: string; recebido_lardan_cents: string }>(
      `select status, diferenca_cents::text, recebido_lardan_cents::text from public.kit_pre_baixas where cycle_id=$1`, [cicloAna]);
    expect(pb).toEqual({ status: "pendencia", diferenca_cents: "0", recebido_lardan_cents: "0" });
    const aj = await um<{ n: number }>(`select count(*)::int n from public.consultora_acerto_ajustes where order_id=$1 and tipo='debito'`, [pedidoTarde]);
    expect(aj.n).toBe(1);
  });

  test("ninguém de fora chama a rotina de ajuste", async () => {
    expect((await rpc(master, "acerto_ajuste_pos_conferencia", { _order: pedidoTarde, _tipo: "credito" })).ok).toBe(false);
    expect((await rpc(ana, "acerto_ajuste_pos_conferencia", { _order: pedidoTarde, _tipo: "credito" })).ok).toBe(false);
  });
});
