/**
 * 0200 — Cobrança da consultora e o acerto: cliente que paga (ou estorna) depois da conferência vira crédito/débito
 * recalculável e idempotente, que abate ou cria a dívida oficial sem mexer no acerto conferido; peça vendida duas vezes.
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
  let pedidoTarde = "", parcelaTarde = "", pedidoFalha = "";

  test("cobrança aberta aparece no cálculo do acerto e no financeiro dela (e não no da outra)", async () => {
    const o = await rpc<{ order_id: string }>(ana, "consultant_order_create", { _client: clienteAna, _itens: [{ cycle_id: cicloAna, variant_id: vA, quantidade: 1 }], _idempotency_key: `aud-t-${marca}` });
    expect(o.erro).toBeNull();
    pedidoTarde = o.dados.order_id;
    const t = await rpc<{ installment_id: string }>(ana, "consultora_pagamento_titulo", { _order: pedidoTarde, _forma: "depois", _doc: novoCpf(), _venc: null });
    expect(t.erro).toBeNull();
    parcelaTarde = t.dados.installment_id;
    const o2 = await rpc<{ order_id: string }>(ana, "consultant_order_create", { _client: clienteAna, _itens: [{ cycle_id: cicloAna, variant_id: vB, quantidade: 1 }], _idempotency_key: `aud-f-${marca}` });
    expect(o2.erro).toBeNull();
    pedidoFalha = o2.dados.order_id;
    expect((await rpc(ana, "consultora_pagamento_titulo", { _order: pedidoFalha, _forma: "depois", _doc: novoCpf(), _venc: null })).erro).toBeNull();
    await rpc(ana, "pre_baixa_vender", { _cycle: cicloAna, _variant: vA, _qtd: 1 });
    await rpc(ana, "pre_baixa_vender", { _cycle: cicloAna, _variant: vB, _qtd: 1 });
    const l = await rpc<{ calculo: { aguardando_lardan_cents: number; recebido_lardan_cents: number } }>(ana, "pre_baixa_ler", { _cycle: cicloAna });
    expect(l.erro).toBeNull();
    expect(Number(l.dados.calculo.aguardando_lardan_cents)).toBe(15000);
    expect(Number(l.dados.calculo.recebido_lardan_cents)).toBe(0);
    const f = await rpc<{ cobrancas: { situacao: string; valor_cents: number }[] }>(ana, "consultora_meu_financeiro", {});
    expect(f.erro).toBeNull();
    expect(f.dados.cobrancas.map((c) => [c.situacao, Number(c.valor_cents)]).sort()).toEqual([["pendente", 10000], ["pendente", 5000]]);
    expect((await rpc<{ cobrancas: unknown[] }>(bia, "consultora_meu_financeiro", {})).dados.cobrancas).toEqual([]);
  });

  test("cliente paga DEPOIS da conferência: abate o acerto em aberto, resto a devolver; acerto conferido intocado", async () => {
    expect((await rpc(ana, "pre_baixa_fechar", { _cycle: cicloAna })).erro).toBeNull();
    // vendeu 1 A + 1 B = 150,00 → 20% = 30,00 → acerto de 120,00 (título em aberto)
    const c = await rpc<{ status: string; valor_final_cents: number }>(master, "pre_baixa_conferir", {
      _cycle: cicloAna, _leituras: [{ variant_id: vA, qtd: 1 }, { variant_id: vB, qtd: 1 }, { variant_id: vUnica, qtd: 1 }], _aplicar: true });
    expect(c.erro).toBeNull();
    expect(c.dados).toMatchObject({ status: "encerrada", valor_final_cents: 12000 });
    const antes = await um<Record<string, string>>(`select valor_pagar_cents::text a, valor_final_cents::text b, diferenca_cents::text c, recebido_lardan_cents::text d, installment_id::text i from public.kit_pre_baixas where cycle_id=$1`, [cicloAna]);

    await pagar(parcelaTarde, 10000, `aud-pt-${marca}`);
    const pb = await um<Record<string, string>>(`select status, pendencia_motivo, valor_pagar_cents::text a, valor_final_cents::text b, diferenca_cents::text c, recebido_lardan_cents::text d from public.kit_pre_baixas where cycle_id=$1`, [cicloAna]);
    expect([pb.a, pb.b, pb.c, pb.d]).toEqual([antes.a, antes.b, antes.c, antes.d]);     // números conferidos intocados
    expect(pb.status).toBe("encerrada");                                                   // 100,00 couberam no acerto de 120,00
    expect(pb.pendencia_motivo).toContain("R$ 100,00 abatido do acerto em aberto");
    const saldo = await um<{ s: string }>(`select public.fin_installment_saldo($1)::text s`, [antes.i]);
    expect(Number(saldo.s)).toBe(2000);                                                   // dívida oficial: 120,00 − 100,00
    const aj = await um<{ n: number; v: string; ab: string }>(`select count(*)::int n, max(valor_cents)::text v, max(abatido_cents)::text ab from public.consultora_acerto_ajustes where order_id=$1`, [pedidoTarde]);
    expect(aj).toEqual({ n: 1, v: "10000", ab: "10000" });
    const f = await rpc<{ ajustes: { tipo: string; valor_cents: number }[] }>(ana, "consultora_meu_financeiro", {});
    expect(f.dados.ajustes).toEqual([expect.objectContaining({ tipo: "credito", valor_cents: 10000 })]);
    expect((await ler(bia, `select * from public.consultora_acerto_ajustes`)).linhas).toEqual([]);
  });

  test("rodar de novo não duplica (idempotente) e o reprocessamento mostra nada a fazer", async () => {
    const r = await um<{ r: unknown[] }>(`select public.acerto_ajuste_conciliar($1, true) r`, [pedidoTarde]);
    expect(r.r).toEqual([]);
    const p = await rpc<{ total: number }>(master, "acerto_ajustes_reprocessar", { _aplicar: false });
    expect(p.erro).toBeNull();
    expect(Number(p.dados.total)).toBe(0);
    expect((await rpc(ana, "acerto_ajustes_reprocessar", { _aplicar: true })).ok).toBe(false);
    expect((await rpc(master, "acerto_ajuste_conciliar", { _order: pedidoTarde, _aplicar: true })).ok).toBe(false);
  });

  test("falha no gatilho não trava a baixa; o reprocessamento refaz (prévia → aplica → nada mais)", async () => {
    const inst = (await um<{ i: string }>(`select pay_installment_id::text i from public.sales_orders where id=$1`, [pedidoFalha])).i;
    await adm.unsafe(`alter table public.consultora_acerto_ajustes add constraint teste_falha check (false) not valid`);
    try {
      await pagar(inst, 5000, `aud-pf-${marca}`);
    } finally {
      await adm.unsafe(`alter table public.consultora_acerto_ajustes drop constraint teste_falha`);
    }
    expect((await um<{ s: string }>(`select payment_status::text s from public.sales_orders where id=$1`, [pedidoFalha])).s).toBe("pago");
    expect((await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='pre_baixa.ajuste_falhou' and entity_id=$1`, [pedidoFalha])).n).toBe(1);
    const previa = await rpc<{ total: number; ajustes: { tipo: string; valor_cents: number }[] }>(master, "acerto_ajustes_reprocessar", { _aplicar: false });
    expect(previa.dados.ajustes).toEqual([expect.objectContaining({ tipo: "credito", valor_cents: 5000 })]);
    expect((await um<{ n: number }>(`select count(*)::int n from public.consultora_acerto_ajustes where order_id=$1`, [pedidoFalha])).n).toBe(0);
    expect(Number((await rpc<{ total: number }>(master, "acerto_ajustes_reprocessar", { _aplicar: true })).dados.total)).toBe(1);
    expect(Number((await rpc<{ total: number }>(master, "acerto_ajustes_reprocessar", { _aplicar: true })).dados.total)).toBe(0);
    // 50,00 a mais: abate os 20,00 que restavam no acerto e 30,00 ficam a devolver → pendência
    const pb = await um<{ status: string; m: string }>(`select status, pendencia_motivo m from public.kit_pre_baixas where cycle_id=$1`, [cicloAna]);
    expect(pb.status).toBe("pendencia");
    expect(pb.m).toContain("R$ 30,00 a devolver à consultora");
  });

  test("estorno depois da conferência: desconta o crédito ainda não devolvido e o resto vira título da consultora", async () => {
    // estorno oficial = alocação negativa da mesma parcela
    const s = await um<{ id: string }>(`insert into public.financial_settlements (direction, financial_account_id, valor_cents, idempotency_key) values ('receivable',$1,5000,$2) returning id`, [fin, `aud-est-${marca}`]);
    const inst = (await um<{ i: string }>(`select pay_installment_id::text i from public.sales_orders where id=$1`, [pedidoFalha])).i;
    await adm.unsafe(`insert into public.financial_allocations (settlement_id, installment_id, valor_cents) values ($1,$2,-5000)`, [s.id, inst]);
    expect((await um<{ s: string }>(`select payment_status::text s from public.sales_orders where id=$1`, [pedidoFalha])).s).toBe("estornado");
    const d = await um<{ v: string; c: string; t: string | null }>(`select valor_cents::text v, compensado_cents::text c, title_id::text t from public.consultora_acerto_ajustes where order_id=$1 and tipo='debito'`, [pedidoFalha]);
    expect(d.v).toBe("5000");
    expect(d.c).toBe("3000");                     // os 30,00 ainda não devolvidos
    expect(d.t).not.toBeNull();                   // 20,00 que tinham abatido o acerto voltam como dívida oficial
    const t = await um<{ v: string; p: string }>(`select sum(i.valor_cents)::text v, max(t.party_id::text) p from public.financial_titles t join public.financial_installments i on i.title_id=t.id where t.id=$1 group by t.id`, [d.t]);
    expect(t).toEqual({ v: "2000", p: ana.partyId });
    expect(Number((await rpc<{ total: number }>(master, "acerto_ajustes_reprocessar", { _aplicar: false })).dados.total)).toBe(0);
  });
});
