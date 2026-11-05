/**
 * 0211 — Compra de verdade na vitrine, tela "Vendidos" e Central de vendas. Banco ISOLADO, dados sintéticos.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, rpcServico, VISITANTE, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const slug = `vt${marca}`.toLowerCase();
function cpf(base9: string) {
  const d = base9.split("").map(Number);
  const dv = (arr: number[]) => { const s = arr.reduce((a, n, i) => a + n * (arr.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(d);
  return base9 + d1 + dv([...d, d1]);
}
const novoCpf = () => cpf(String(100000000 + Math.floor(Math.random() * 799999999)));
const ddd = String(11 + Math.floor(Math.random() * 80));
const meio = String(Date.now()).slice(-4);
const tel = (n: string) => `${ddd}9${meio}${n}`;
let master: Conta, cons: Conta, outra: Conta, deposito = "", praca = "", vA = "", vB = "", fin = "", ciclo = "";
let cobrancaAntes: Record<string, unknown>[] = [];
let pedido1 = "", token1 = "", parcela1 = "";
const cliente = (fone: string, doc = novoCpf()) => ({ nome: "Carla Compradora", telefone: fone, cpf: doc, email: "carla@exemplo.com" });

type Compra = { order_id: string; codigo: string; token: string; total_cents: number; installment_id: string; forma: string; repetido?: boolean };
const disponivel = async (variant: string) => {
  const r = await um<{ j: { variant_id: string; disponivel: number }[] }>(`select public.showcase_items_for($1, '{}'::jsonb) j`, [cons.partyId]);
  return Number(r.j.find((x) => x.variant_id === variant)?.disponivel ?? 0);
};

beforeAll(async () => {
  master = await criarConta({ nome: `vt-master-${marca}`, papeis: ["master"], comParty: true });
  cons = await criarConta({ nome: `vt-cons-${marca} Silva`, papeis: ["consultora"], comParty: true });
  outra = await criarConta({ nome: `vt-outra-${marca}`, papeis: ["consultora"], comParty: true });
  for (const c of [cons, outra]) await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [c.partyId]);
  await adm.unsafe(`update public.parties set status='ativo', doc_digits=$2, doc=$2 where id=$1`, [cons.partyId, novoCpf()]);
  deposito = await criarDeposito(`vt-${marca}`);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça VT ${marca}`])).linhas[0]!.id;
  await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id) values ($1,$2) on conflict (party_id) do update set praca_id=excluded.praca_id`, [cons.partyId, praca]);
  vA = await criarVariante(`vt-a-${marca}`, 10000);
  vB = await criarVariante(`vt-b-${marca}`, 5000);
  for (const v of [vA, vB]) await porEstoque(v, deposito, 20);
  fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`VT ${marca}`])).id;
  const emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`VT Emp ${marca}`])).id;
  cobrancaAntes = (await adm.unsafe(`select * from public.consultora_cobranca_config`)) as Record<string, unknown>[];
  await adm.unsafe(`delete from public.consultora_cobranca_config where true`);
  await adm.unsafe(`insert into public.consultora_cobranca_config (id, ator_user_id, business_entity_id, financial_account_id) values (true,$1,$2,$3)`, [master.uid, emp, fin]);
  const rem = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _deposito: deposito, _data_acerto: new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10) })).dados.id;
  ciclo = (await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: rem, _consultora: cons.partyId })).dados.cycle_id;
  for (const [v, q] of [[vA, 1], [vB, 3]] as const) await rpc(master, "kit_item_upsert", { _cycle: ciclo, _variant: v, _qty: q });
  await rpc(master, "kit_conferir", { _cycle: ciclo, _note: null });
  await rpc(master, "kit_expedir", { _cycle: ciclo, _payload: { rota: "direta" } });
  const t = (await um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 order by seq limit 1`, [ciclo])).id;
  await rpc(cons, "kit_transfer_confirm", { _transfer: t, _payload: {} });
  const a = await rpc(cons, "kit_aceitar", { _cycle: ciclo, _idempotency_key: `vt-${ciclo}`, _itens: [{ variant_id: vA, qty_accepted: 1, qty_divergent: 0 }, { variant_id: vB, qty_accepted: 3, qty_divergent: 0 }] });
  if (a.erro) throw new Error(a.erro);
  await adm.unsafe(`insert into public.consultant_showcases (party_id, slug, is_public, design_published) values ($1,$2,true,'{}'::jsonb)
    on conflict (party_id) do update set slug=excluded.slug, is_public=true, design_published='{}'::jsonb`, [cons.partyId, slug]);
});

afterAll(async () => {
  await adm.unsafe(`delete from public.consultora_cobranca_config where true`);
  for (const c of cobrancaAntes) {
    await adm.unsafe(`insert into public.consultora_cobranca_config (id, ator_user_id, business_entity_id, financial_account_id) values (true,$1,$2,$3)`,
      [c["ator_user_id"], c["business_entity_id"], c["financial_account_id"]]);
  }
});

describe("compra na vitrine", () => {
  test("visitante não chama a compra direto no banco (só o servidor)", async () => {
    expect((await rpc(VISITANTE, "vitrine_comprar", { _slug: slug, _cliente: cliente(tel("0001")), _itens: [{ variant_id: vA, quantidade: 1 }], _forma: "pix", _chave: `x-${marca}-0000000000` })).ok).toBe(false);
    expect((await rpc(cons, "vitrine_comprar", { _slug: slug, _cliente: cliente(tel("0001")), _itens: [{ variant_id: vA, quantidade: 1 }], _forma: "pix", _chave: `x-${marca}-0000000001` })).ok).toBe(false);
  });

  test("compra: pedido da vitrine com cobrança Lardan e a peça sai da vitrine na hora", async () => {
    expect(await disponivel(vA)).toBe(1);
    const r = await rpcServico<Compra>("vitrine_comprar", { _slug: slug, _cliente: cliente(tel("0001")), _itens: [{ variant_id: vA, quantidade: 1 }], _forma: "pix", _chave: `c1-${marca}-abcdefgh` });
    expect(r.erro).toBeNull();
    expect(Number(r.dados.total_cents)).toBe(10000);
    expect(r.dados.installment_id).toBeTruthy();
    pedido1 = r.dados.order_id; token1 = r.dados.token; parcela1 = r.dados.installment_id;
    const o = await um<Record<string, string>>(`select channel, status::text s, payment_status::text p, pay_method, client_id::text c from public.sales_orders where id=$1`, [pedido1]);
    expect([o.channel, o.s, o.p, o.pay_method]).toEqual(["vitrine", "aguardando_pagamento", "pendente", "pix"]);
    expect(o.c).toBeTruthy();                                                      // cliente entrou na carteira dela
    expect(await disponivel(vA)).toBe(0);                                          // sumiu da vitrine
    const app = await rpc<{ variant_id: string }[]>(cons, "consultora_pecas_buscar", { _busca: "", _categoria: "", _banho: "" });
    expect((app.dados ?? []).some((x) => x.variant_id === vA)).toBe(false);       // e do app de vendas
    // o mesmo clique de novo devolve a mesma compra
    const de_novo = await rpcServico<Compra>("vitrine_comprar", { _slug: slug, _cliente: cliente(tel("0001")), _itens: [{ variant_id: vA, quantidade: 1 }], _forma: "pix", _chave: `c1-${marca}-abcdefgh` });
    expect(de_novo.dados).toMatchObject({ order_id: pedido1, repetido: true });
    // a página pública acompanha o pagamento sem login
    const s = await rpc<{ pago: boolean; codigo: string }>(VISITANTE, "vitrine_pagamento_situacao", { _token: token1 });
    expect(s.dados).toMatchObject({ pago: false });
  });

  test("peça que acabou, CPF da consultora e abuso de pedidos não pagos são recusados", async () => {
    const acabou = await rpcServico("vitrine_comprar", { _slug: slug, _cliente: cliente(tel("0002")), _itens: [{ variant_id: vA, quantidade: 1 }], _forma: "pix", _chave: `c2-${marca}-abcdefgh` });
    expect(acabou.erro).toContain("acabou de ser vendida");
    const cpfDela = (await um<{ d: string }>(`select doc_digits d from public.parties where id=$1`, [cons.partyId])).d;
    const propria = await rpcServico("vitrine_comprar", { _slug: slug, _cliente: cliente(tel("0003"), cpfDela), _itens: [{ variant_id: vB, quantidade: 1 }], _forma: "pix", _chave: `c3-${marca}-abcdefgh` });
    expect(propria.erro).toContain("própria consultora");
    expect((await rpcServico("vitrine_comprar", { _slug: slug, _cliente: cliente(tel("0009")), _itens: [{ variant_id: vB, quantidade: 1 }], _forma: "pix", _chave: `c4-${marca}-abcdefgh` })).erro).toBeNull();
    expect((await rpcServico("vitrine_comprar", { _slug: slug, _cliente: cliente(tel("0009")), _itens: [{ variant_id: vB, quantidade: 1 }], _forma: "cartao", _chave: `c5-${marca}-abcdefgh` })).erro).toBeNull();
    const terceira = await rpcServico("vitrine_comprar", { _slug: slug, _cliente: cliente(tel("0009")), _itens: [{ variant_id: vB, quantidade: 1 }], _forma: "pix", _chave: `c6-${marca}-abcdefgh` });
    expect(terceira.erro).toContain("aguardando pagamento");
  });

  test("pagou: conta como vendida na maleta, aparece em Vendidos e na Central, não cancela, marca entregue", async () => {
    const st = await um<{ id: string }>(`insert into public.financial_settlements (direction, financial_account_id, valor_cents, idempotency_key) values ('receivable',$1,10000,$2) returning id`, [fin, `vt-p-${marca}`]);
    await adm.unsafe(`insert into public.financial_allocations (settlement_id, installment_id, valor_cents) values ($1,$2,10000)`, [st.id, parcela1]);
    expect((await rpc<{ pago: boolean }>(VISITANTE, "vitrine_pagamento_situacao", { _token: token1 })).dados.pago).toBe(true);
    expect((await um<{ q: number }>(`select public.pre_baixa_qtd_app($1,$2) q`, [ciclo, vA])).q).toBe(1);
    expect((await rpc(cons, "order_set_status", { _order: pedido1, _status: "cancelado", _note: null })).erro).toContain("já foi pago");

    const v = await rpc<{ resumo: Record<string, number>; formas: { forma: string; valor_cents: number }[]; vendas: { codigo: string; canal: string; forma: string; pago: boolean }[] }>(cons, "consultora_vendidos", { _de: null, _ate: null });
    expect(v.erro).toBeNull();
    expect(Number(v.dados.resumo.vitrine_cents)).toBe(10000 + 5000 + 5000);
    expect(Number(v.dados.resumo.pago_lardan_cents)).toBe(10000);
    expect(v.dados.vendas.find((x) => x.canal === "vitrine" && x.pago)).toMatchObject({ forma: "pix" });
    expect((await rpc<{ vendas: unknown[] }>(outra, "consultora_vendidos", { _de: null, _ate: null })).dados.vendas).toEqual([]);

    const c = await rpc<{ resumo: Record<string, number>; ranking: { party_id: string; valor_cents: number }[]; pracas: { praca: string }[] }>(master, "central_vendas", { _de: null, _ate: null });
    expect(c.erro).toBeNull();
    expect(c.dados.ranking.find((r) => r.party_id === cons.partyId)?.valor_cents).toBe(20000);
    expect(c.dados.pracas.some((p) => p.praca.toUpperCase() === `Praça VT ${marca}`.toUpperCase())).toBe(true);
    expect((await rpc(cons, "central_vendas", { _de: null, _ate: null })).ok).toBe(false);

    const e = await rpc<{ situacao: string }>(cons, "consultora_pedido_entregue", { _order: pedido1 });
    expect(e.dados).toMatchObject({ situacao: "concluido" });
  });

  test("não pagou em 60 min: o laço cancela a cobrança e a peça volta para a vitrine", async () => {
    const antes = await disponivel(vB);
    await adm.unsafe(`update public.sales_orders set reserve_expires_at = now() - interval '1 minute' where channel='vitrine' and consultora_party_id=$1 and payment_status='pendente'`, [cons.partyId]);
    const lista = (await adm.unsafe(`select order_id::text, acao from public.pedidos_cobranca_para_cancelar() where order_id in (select id from public.sales_orders where consultora_party_id=$1)`, [cons.partyId])) as { order_id: string; acao: string }[];
    expect(lista.length).toBe(2);
    expect(new Set(lista.map((l) => l.acao))).toEqual(new Set(["expirar"]));
    // primeira: Asaas recusou → continua presa; segunda: cancelada → expira
    await adm.unsafe(`select public.pedido_cobranca_cancelada($1, false, 'falha de rede')`, [lista[0]!.order_id]);
    await adm.unsafe(`select public.pedido_cobranca_cancelada($1, true, null)`, [lista[1]!.order_id]);
    expect(await disponivel(vB)).toBe(antes + 1);
    const s = await um<{ s: string }>(`select status::text s from public.sales_orders where id=$1`, [lista[1]!.order_id]);
    expect(s.s).toBe("cancelado");
    const ainda = (await adm.unsafe(`select order_id::text from public.pedidos_cobranca_para_cancelar() where order_id in (select id from public.sales_orders where consultora_party_id=$1)`, [cons.partyId])) as { order_id: string }[];
    expect(ainda.map((x) => x.order_id)).toEqual([lista[0]!.order_id]);         // tenta de novo na próxima volta
  });
});

describe("0213 — forma combinada na Nova venda", () => {
  test("pedido com Pix combinado aparece como Pix combinado em Vendidos e na Central (não como 'sem forma')", async () => {
    const clienteCombinado = (await ler<{ id: string }>(cons, `insert into public.consultant_clients (consultora_party_id, nome, telefone) values ($1,'Bia Combinado','43988887777') returning id`, [cons.partyId])).linhas[0];
    if (!clienteCombinado) throw new Error('Cliente de teste não foi criado');
    const cli = clienteCombinado.id;
    const o = await rpc<{ order_id: string }>(cons, "consultant_order_create", { _client: cli, _itens: [{ cycle_id: ciclo, variant_id: vB, quantidade: 1 }], _idempotency_key: `comb-${marca}-1` });
    expect(o.erro).toBeNull();
    expect((await rpc(cons, "consultant_order_combinado_set", { _order: o.dados.order_id, _forma: "pix", _parcelas: null, _vencimento: null })).erro).toBeNull();
    const v = await rpc<{ vendas: { order_id: string; forma: string }[] }>(cons, "consultora_vendidos", { _de: null, _ate: null });
    expect(v.dados.vendas.find((x) => x.order_id === o.dados.order_id)?.forma).toBe("pix_combinado");
    const c = await rpc<{ formas: { forma: string }[] }>(master, "central_vendas", { _de: null, _ate: null });
    expect(c.dados.formas.some((f) => f.forma === "pix_combinado")).toBe(true);
  });
});
