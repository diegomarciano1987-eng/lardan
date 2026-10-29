/**
 * 0159 — app da consultora: baixa automática do Pix da cliente, "pagou em dinheiro", desconto no acerto,
 * Meu financeiro, Início com pendências reais, indicação ("Quem te indicou?", representante pela madrinha,
 * situação da indicada), caminho para líder e Liga. Banco ISOLADO, dados sintéticos.
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
const hoje = () => new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);

let master: Conta, cons: Conta, indicada: Conta, rep: Conta, intrusa: Conta;
let deposito = "", praca = "", remessa = "", ciclo = "", vA = "", vB = "", vC = "", fin = "", codigo = "";
let pedidoPix = "", pedidoDinheiro = "", cliente = "", parcelaAcerto = "";

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
  const a = await rpc(c, "kit_aceitar", { _cycle: id, _idempotency_key: `ac-${id}`, _itens: itens.map(([v, q]) => ({ variant_id: v, qty_accepted: q, qty_divergent: 0 })) });
  if (a.erro) throw new Error(a.erro);
  return id;
}

beforeAll(async () => {
  master = await criarConta({ nome: `ac-master-${marca}`, papeis: ["master"], comParty: true });
  cons = await criarConta({ nome: `ac-cons-${marca} Souza`, papeis: ["consultora"], comParty: true });
  indicada = await criarConta({ nome: `ac-indicada-${marca} Lima`, papeis: ["consultora"], comParty: true });
  rep = await criarConta({ nome: `ac-rep-${marca}`, papeis: ["representante"], comParty: true });
  intrusa = await criarConta({ nome: `ac-intrusa-${marca}`, papeis: ["consultora"], comParty: true });
  deposito = await criarDeposito(`ac-${marca}`);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça AC ${marca}`])).linhas[0]!.id;
  for (const c of [cons, indicada, intrusa]) {
    await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [c.partyId]);
  }
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'representante') on conflict do nothing`, [rep.partyId]);
  await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id, representative_party_id) values ($1,$2,$3)
    on conflict (party_id) do update set praca_id=excluded.praca_id, representative_party_id=excluded.representative_party_id`, [cons.partyId, praca, rep.partyId]);
  for (const c of [indicada, intrusa]) {
    await adm.unsafe(`insert into public.consultant_profiles (party_id) values ($1) on conflict (party_id) do nothing`, [c.partyId]);
  }
  await adm.unsafe(`update public.parties set status='ativo' where id in ($1,$2,$3)`, [cons.partyId, indicada.partyId, intrusa.partyId]);
  codigo = (await um<{ c: string }>(`select referral_code c from public.consultant_profiles where party_id=$1`, [cons.partyId])).c;
  vA = await criarVariante(`ac-a-${marca}`, 10000);
  vB = await criarVariante(`ac-b-${marca}`, 5000);
  vC = await criarVariante(`ac-c-${marca}`, 3000);
  for (const v of [vA, vB, vC]) await porEstoque(v, deposito, 50);
  fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`AC ${marca}`])).id;
  const emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`AC Emp ${marca}`])).id;
  await adm.unsafe(`delete from public.consultora_cobranca_config`);
  await adm.unsafe(`insert into public.consultora_cobranca_config (id, ator_user_id, business_entity_id, financial_account_id) values (true,$1,$2,$3)`, [master.uid, emp, fin]);
  await adm.unsafe(`delete from public.consultora_comissao_faixas`);
  await adm.unsafe(`insert into public.consultora_comissao_faixas (min_vendido_cents, percentual, titulo) values (0,20,'20%'),(20000,25,'25%'),(50000,30,'30%'),(65000,35,'35%'),(120000,40,'40%')`);
  remessa = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _deposito: deposito,
    _data_acerto: new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10) })).dados.id;
  ciclo = await maletaAceita(cons, remessa, [[vA, 4], [vB, 2]]);
  cliente = (await ler<{ id: string }>(cons, `insert into public.consultant_clients (consultora_party_id, nome, telefone, aniversario) values ($1,'Bia Cliente','43911113333',$2) returning id`,
    [cons.partyId, `1990-${hoje().slice(5)}`])).linhas[0]!.id;
});

afterAll(async () => {
  await adm.unsafe(`update public.lider_config set indicadas_ativas_min=3, venda_ciclo_min_cents=65000, comissao_pct=0, comissao_ativa=false`);
  await adm.unsafe(`delete from public.liga_niveis`);
  await adm.unsafe(`insert into public.liga_niveis values (1,'Bronze',0,65000),(2,'Prata',2,65000),(3,'Ouro',4,65000),(4,'Diamante',8,65000)`);
});

describe("pagamentos da cliente", () => {
  test("Pix pago à Lardan dá baixa sozinho no pedido (sem a consultora abrir a tela)", async () => {
    const o = await rpc<{ order_id: string }>(cons, "consultant_order_create", { _client: cliente, _itens: [{ cycle_id: ciclo, variant_id: vA, quantidade: 1 }], _idempotency_key: `ac-o1-${marca}` });
    expect(o.erro).toBeNull();
    pedidoPix = o.dados.order_id;
    const t = await rpc<{ installment_id: string }>(cons, "consultora_pagamento_titulo", { _order: pedidoPix, _forma: "pix", _doc: novoCpf(), _venc: null });
    expect(t.erro).toBeNull();
    expect((await um<{ s: string }>(`select payment_status::text s from public.sales_orders where id=$1`, [pedidoPix])).s).toBe("pendente");
    const s = await um<{ id: string }>(`insert into public.financial_settlements (direction, financial_account_id, valor_cents, idempotency_key) values ('receivable',$1,10000,$2) returning id`, [fin, `ac-s-${marca}`]);
    await adm.unsafe(`insert into public.financial_allocations (settlement_id, installment_id, valor_cents) values ($1,$2,10000)`, [s.id, t.dados.installment_id]);
    const p = await um<{ pg: string; st: string; ev: number }>(`select payment_status::text pg, status::text st,
      (select count(*)::int from public.sales_order_events e where e.order_id=o.id and e.kind='pagamento.recebido_lardan') ev from public.sales_orders o where id=$1`, [pedidoPix]);
    // baixa no pagamento, mas o pedido NÃO é concluído (conclusão exige o registro da venda — regra de order_set_status)
    expect(p).toEqual({ pg: "pago", st: "em_atendimento", ev: 1 });
  });

  test("cliente pagou em dinheiro: pedido pago (sem concluir); pedido com cobrança Lardan não aceita", async () => {
    const o = await rpc<{ order_id: string }>(cons, "consultant_order_create", { _client: cliente, _itens: [{ cycle_id: ciclo, variant_id: vB, quantidade: 1 }], _idempotency_key: `ac-o2-${marca}` });
    expect(o.erro).toBeNull();
    pedidoDinheiro = o.dados.order_id;
    expect((await rpc(intrusa, "consultora_pedido_pago_dinheiro", { _order: pedidoDinheiro })).erro).toContain("não encontrado");
    await adm.unsafe(`update public.sales_orders set status='aguardando_pagamento' where id=$1`, [pedidoDinheiro]);
    const r = await rpc<{ repetido: boolean }>(cons, "consultora_pedido_pago_dinheiro", { _order: pedidoDinheiro });
    expect(r.erro).toBeNull();
    expect(r.dados).toEqual({ repetido: false });
    expect((await rpc<{ repetido: boolean }>(cons, "consultora_pedido_pago_dinheiro", { _order: pedidoDinheiro })).dados).toEqual({ repetido: true });
    const p = await um<{ pg: string; st: string; m: string }>(`select payment_status::text pg, status::text st, pay_method m from public.sales_orders where id=$1`, [pedidoDinheiro]);
    expect(p).toEqual({ pg: "pago", st: "em_atendimento", m: "dinheiro" });
    expect((await rpc(cons, "consultora_pedido_pago_dinheiro", { _order: pedidoPix })).erro).toContain("já tem uma cobrança da Lardan");
  });

  test("acerto desconta o que a cliente já pagou à Lardan (dinheiro fica com a consultora)", async () => {
    expect((await rpc(cons, "pre_baixa_abrir", { _cycle: ciclo })).erro).toBeNull();
    const l = await rpc<{ itens: { variant_id: string; vendida: number }[]; recebido_lardan_cents?: number }>(cons, "pre_baixa_ler", { _cycle: ciclo });
    expect(l.dados.itens.find((i) => i.variant_id === vA)!.vendida).toBe(1);
    expect(l.dados.itens.find((i) => i.variant_id === vB)!.vendida).toBe(1);
    const c = await rpc<Record<string, number>>(cons, "pre_baixa_vender", { _cycle: ciclo, _variant: vB, _qtd: 1 });
    // vendido 100 + 50 = 150,00 → 20% = 30,00 → menos 100,00 que a Lardan já recebeu no Pix → paga 20,00
    expect(c.dados).toMatchObject({ vendido_cents: 15000, comissao_pct: 20, comissao_cents: 3000, recebido_lardan_cents: 10000, valor_pagar_cents: 2000 });
  });
});

describe("Início e Meu financeiro", () => {
  test("Início mostra acerto, vendeu X de Y e aniversário de hoje; nunca 'tudo em dia' com pré-baixa aberta", async () => {
    const h = await rpc<{ acerto: { situacao: string; pecas_total: number; pecas_vendidas: number; valor_cents: number; data: string };
      aniversarios: { nome: string; quando: string }[]; pedidos_em_atendimento: unknown[]; debitos_abertos_cents: number }>(cons, "consultant_home", {});
    expect(h.erro).toBeNull();
    expect(h.dados.acerto).toMatchObject({ situacao: "aberta", pecas_total: 6, pecas_vendidas: 2, valor_cents: 2000 });
    expect(h.dados.acerto.data).toBeTruthy();
    expect(h.dados.aniversarios).toContainEqual(expect.objectContaining({ nome: "Bia", quando: "hoje" }));
    expect(Array.isArray(h.dados.pedidos_em_atendimento)).toBe(true);
    // o pedido em dinheiro está em atendimento, mas já pago: não aparece como pendência de pagamento
    expect(JSON.stringify(h.dados.pedidos_em_atendimento)).not.toContain(pedidoDinheiro);
  });

  test("Meu financeiro: próximo acerto, débito do acerto fechado, 2ª via só do que é dela", async () => {
    const f = await rpc<{ installment_id: string }>(cons, "pre_baixa_fechar", { _cycle: ciclo });
    expect(f.erro).toBeNull();
    parcelaAcerto = f.dados.installment_id;
    const m = await rpc<{ proximo_acerto: { valor_cents: number; situacao: string; dias: number }; debitos: { installment_id: string; saldo_cents: number; origem: string }[];
      acertos: { origem: string; pagar_cents: number }[] }>(cons, "consultora_meu_financeiro", {});
    expect(m.erro).toBeNull();
    expect(m.dados.proximo_acerto).toMatchObject({ valor_cents: 2000, situacao: "aguardando_pagamento" });
    expect(m.dados.proximo_acerto.dias).toBeGreaterThan(0);
    expect(m.dados.debitos).toContainEqual(expect.objectContaining({ installment_id: parcelaAcerto, saldo_cents: 2000, origem: "pre_baixa" }));
    expect(m.dados.acertos).toContainEqual(expect.objectContaining({ origem: "lardan", pagar_cents: 2000 }));
    const sv = await rpc<{ installment_id: string; actor: string }>(cons, "consultora_debito_cobranca", { _installment: parcelaAcerto });
    expect(sv.dados).toMatchObject({ installment_id: parcelaAcerto, actor: master.uid });
    expect((await rpc(intrusa, "consultora_debito_cobranca", { _installment: parcelaAcerto })).erro).toContain("não encontrado");
    expect((await rpc(intrusa, "consultora_meu_financeiro", {})).dados).toMatchObject({ debitos: [] });
    expect((await rpc(rep, "consultora_meu_financeiro", {})).ok).toBe(false);
    const h = await rpc<{ debitos_abertos_cents: number }>(cons, "consultant_home", {});
    expect(Number(h.dados.debitos_abertos_cents)).toBeGreaterThanOrEqual(2000);
  });

  test("Meus ganhos usa o que ela marcou na pré-baixa", async () => {
    const g = await um<{ v: number; p: number }>(`select (public.consultora_vendido_ciclo($1)->>'vendido_cents')::int v, (public.consultora_vendido_ciclo($1)->>'pecas')::int p`, [ciclo]);
    expect(g).toEqual({ v: 15000, p: 2 });
  });

  test("barra de vendas usa valor e comissão oficiais da remessa", async () => {
    const g = await rpc<{ valor_maleta_cents: number; kits: number; vendido_cents: number; comissao_cents: number; faixa: { percentual: number } }>(cons, "consultora_ganhos", {});
    expect(g.erro).toBeNull();
    expect(Number(g.dados.valor_maleta_cents)).toBe(50000);
    expect(g.dados.kits).toBe(1);
    expect(Number(g.dados.vendido_cents)).toBe(15000);
    expect(Number(g.dados.comissao_cents)).toBe(3000);
    expect(Number(g.dados.comissao_cents)).toBe(Math.round(Number(g.dados.vendido_cents) * Number(g.dados.faixa.percentual) / 100));
  });
});

describe("indicação", () => {
  const novoLead = async (nome: string) => (await um<{ id: string }>(
    `insert into public.leads (full_name, whatsapp, city, uf, privacy_version, stage_id)
     values ($1,'43999990000','Londrina','PR','v1',(select id from public.candidatura_stages order by sort_order limit 1)) returning id`, [nome])).id;
  const submeter = (lead: string, quem: string) => adm.unsafe(
    `insert into public.candidatura_submissions (lead_id, protocol, payload) values ($1,$2,$3::text::jsonb)`, [lead, `P-${lead.slice(0, 8)}`, JSON.stringify({ quem_indicou: quem })]);

  test("'Quem te indicou?' com o código liga à madrinha e ao representante dela; texto livre só fica anotado", async () => {
    const l1 = await novoLead(`Ana Indicada ${marca}`);
    await submeter(l1, codigo.toUpperCase());
    const a = await um<{ ref: string; txt: string; rep: string; orig: string }>(
      `select referred_by_party_id::text ref, indicado_por_texto txt, representante_party_id::text rep, representante_origem orig from public.leads where id=$1`, [l1]);
    expect(a).toEqual({ ref: cons.partyId!, txt: codigo.toUpperCase(), rep: rep.partyId!, orig: "madrinha" });
    const l2 = await novoLead(`Bea Feira ${marca}`);
    await submeter(l2, "Maria da feira");
    const b = await um<{ ref: string | null; txt: string }>(`select referred_by_party_id::text ref, indicado_por_texto txt from public.leads where id=$1`, [l2]);
    expect(b).toEqual({ ref: null, txt: "Maria da feira" });
    const mi = await rpc<{ indicadas: { nome: string; situacao: string }[] }>(cons, "minhas_indicacoes", {});
    expect(mi.dados.indicadas).toContainEqual(expect.objectContaining({ situacao: "candidata" }));
  });

  test("madrinha na ficha: Master corrige, puxa representante e praça; consultora não mexe", async () => {
    expect((await rpc(intrusa, "consultora_madrinha_definir", { _party: indicada.partyId, _madrinha: cons.partyId })).ok).toBe(false);
    expect((await rpc(master, "consultora_madrinha_definir", { _party: indicada.partyId, _madrinha: indicada.partyId })).erro).toContain("dela mesma");
    expect((await rpc(master, "consultora_madrinha_definir", { _party: indicada.partyId, _madrinha: rep.partyId })).erro).toContain("precisa ser consultora");
    expect((await rpc(master, "consultora_madrinha_definir", { _party: indicada.partyId, _madrinha: cons.partyId })).erro).toBeNull();
    const p = await um<{ s: string; r: string; pr: string }>(`select sponsor_party_id::text s, representative_party_id::text r, praca_id::text pr from public.consultant_profiles where party_id=$1`, [indicada.partyId]);
    expect(p).toEqual({ s: cons.partyId!, r: rep.partyId!, pr: praca });
    const l = await rpc<{ madrinha_id: string; origem: string }>(master, "consultora_madrinha_ler", { _party: indicada.partyId });
    expect(l.dados).toMatchObject({ madrinha_id: cons.partyId, origem: "manual" });
  });

  test("situação da indicada acompanha a jornada: aprovada → 1ª maleta", async () => {
    const l = await novoLead(`Indicada Cadastro ${marca}`);
    await adm.unsafe(`update public.leads set referred_by_party_id=$2, party_id=$3, outcome='ganha' where id=$1`, [l, cons.partyId, indicada.partyId]);
    const sit = async () => (await um<{ s: string }>(`select public.indicada_situacao(l) s from public.leads l where id=$1`, [l])).s;
    expect(await sit()).toBe("aprovada");
    await maletaAceita(indicada, remessa, [[vC, 1]]);
    expect(await sit()).toBe("primeira_maleta");
  });
});

describe("caminho para líder", () => {
  test("barra com os critérios do admin; pede, Master aprova e libera Minha equipe", async () => {
    expect((await rpc(cons, "lider_config_salvar", { _indicadas: 1, _venda_cents: 10000, _comissao_pct: 0, _comissao_ativa: false })).ok).toBe(false);
    expect((await rpc(master, "lider_config_salvar", { _indicadas: 1, _venda_cents: 10000, _comissao_pct: 0, _comissao_ativa: false })).erro).toBeNull();
    const c = await rpc<{ indicadas_ativas: number; venda_ciclo_cents: number; cumpre: boolean; status: string | null }>(cons, "meu_caminho_lider", {});
    expect(c.dados).toMatchObject({ indicadas_ativas: 1, venda_ciclo_cents: 15000, cumpre: true, status: null });
    expect((await rpc(intrusa, "lider_solicitar", {})).erro).toContain("ainda não cumpre");
    expect((await rpc(cons, "minha_equipe", {})).ok).toBe(false);
    expect((await rpc<string>(cons, "lider_solicitar", {})).dados).toBe("solicitado");
    expect((await rpc(cons, "lider_decidir", { _party: cons.partyId, _status: "aprovado" })).ok).toBe(false);
    const adminLista = await rpc<{ lideres: { party_id: string; status: string }[] }>(master, "lider_admin", {});
    expect(adminLista.dados.lideres).toContainEqual(expect.objectContaining({ party_id: cons.partyId, status: "solicitado" }));
    expect((await rpc(master, "lider_decidir", { _party: cons.partyId, _status: "aprovado" })).erro).toBeNull();
    const eq = await rpc<{ nome: string }[]>(cons, "minha_equipe", {});
    expect(eq.erro).toBeNull();
    expect(eq.dados).toHaveLength(1);
    expect(eq.dados[0]!.nome).toMatch(/^\S+ \S\.$/);   // só primeiro nome + inicial
    expect((await rpc(master, "lider_config_salvar", { _indicadas: 1, _venda_cents: 0, _comissao_pct: 50, _comissao_ativa: false })).erro).toContain("inválidos");
  });
});

describe("Liga Lardan", () => {
  test("nível atual e quanto falta; níveis só o Master altera", async () => {
    const l = await rpc<{ nivel: string; proximo: string; faltam: number }>(cons, "minha_liga", {});
    expect(l.dados).toMatchObject({ nivel: "Bronze", proximo: "Prata", faltam: 2 });
    expect((await rpc(cons, "liga_niveis_salvar", { _niveis: [{ ordem: 1, nome: "X", ciclos_min: 0, venda_min_cents: 0 }] })).ok).toBe(false);
    const nv = [{ ordem: 1, nome: "Iniciante", ciclos_min: 0, venda_min_cents: 0 }, { ordem: 2, nome: "Estrela", ciclos_min: 1, venda_min_cents: 10000 }];
    expect((await rpc(master, "liga_niveis_salvar", { _niveis: nv })).erro).toBeNull();
    const l2 = await rpc<{ nivel: string; proximo: string; faltam: number }>(cons, "minha_liga", {});
    expect(l2.dados).toMatchObject({ nivel: "Iniciante", proximo: "Estrela", faltam: 1 });
    expect((await rpc<unknown[]>(cons, "liga_niveis_ler", {})).dados).toHaveLength(2);
  });
});

describe("ajustes da revisão (0163)", () => {
  test("cliente que paga à Lardan depois do fechamento vira crédito na conferência (nunca pagamento em dobro)", async () => {
    const o = await rpc<{ order_id: string }>(cons, "consultant_order_create", { _client: cliente, _itens: [{ cycle_id: ciclo, variant_id: vB, quantidade: 1 }], _idempotency_key: `ac-o3-${marca}` });
    expect(o.erro).toBeNull();
    const t = await rpc<{ installment_id: string }>(cons, "consultora_pagamento_titulo", { _order: o.dados.order_id, _forma: "pix", _doc: novoCpf(), _venc: null });
    const s = await um<{ id: string }>(`insert into public.financial_settlements (direction, financial_account_id, valor_cents, idempotency_key) values ('receivable',$1,5000,$2) returning id`, [fin, `ac-s3-${marca}`]);
    await adm.unsafe(`insert into public.financial_allocations (settlement_id, installment_id, valor_cents) values ($1,$2,5000)`, [s.id, t.dados.installment_id]);
    // voltaram 3 A e nenhum B: vendeu 1 A + 2 B = 200,00 → 25% = 50,00; clientes pagaram 150,00 à Lardan → 0,00; ela já devia 20,00 → crédito de 20,00
    const c = await rpc<{ status: string; diferenca_cents: number; recebido_depois_cents: number }>(master, "pre_baixa_conferir", { _cycle: ciclo, _leituras: [{ variant_id: vA, qtd: 3 }], _aplicar: true });
    expect(c.erro).toBeNull();
    expect(c.dados).toMatchObject({ status: "pendencia", diferenca_cents: -2000, recebido_depois_cents: 5000 });
    const m = await um<{ m: string }>(`select pendencia_motivo m from public.kit_pre_baixas where cycle_id=$1`, [ciclo]);
    expect(m.m).toContain("depois do fechamento");
    expect(m.m).toContain("Crédito a devolver à consultora: R$ 20,00");
  });

  test("acerto que fecha com valor ≤ 0 não fica preso em 'aguardando pagamento'", async () => {
    const cli = (await ler<{ id: string }>(indicada, `insert into public.consultant_clients (consultora_party_id, nome, telefone) values ($1,'Cli Ind','43911114444') returning id`, [indicada.partyId])).linhas[0]!.id;
    const cicloInd = (await um<{ id: string }>(`select id from public.kit_cycles where consultora_party_id=$1 order by created_at desc limit 1`, [indicada.partyId])).id;
    const o = await rpc<{ order_id: string }>(indicada, "consultant_order_create", { _client: cli, _itens: [{ cycle_id: cicloInd, variant_id: vC, quantidade: 1 }], _idempotency_key: `ac-o4-${marca}` });
    expect(o.erro).toBeNull();
    const t = await rpc<{ installment_id: string }>(indicada, "consultora_pagamento_titulo", { _order: o.dados.order_id, _forma: "pix", _doc: novoCpf(), _venc: null });
    const s = await um<{ id: string }>(`insert into public.financial_settlements (direction, financial_account_id, valor_cents, idempotency_key) values ('receivable',$1,3000,$2) returning id`, [fin, `ac-s4-${marca}`]);
    await adm.unsafe(`insert into public.financial_allocations (settlement_id, installment_id, valor_cents) values ($1,$2,3000)`, [s.id, t.dados.installment_id]);
    const f = await rpc<{ valor_pagar_cents: number; installment_id: string | null }>(indicada, "pre_baixa_fechar", { _cycle: cicloInd });
    expect(f.erro).toBeNull();
    expect(Number(f.dados.valor_pagar_cents)).toBe(-600);   // a Lardan deve a comissão a ela
    expect(f.dados.installment_id).toBeNull();
    expect((await rpc<{ situacao: string }>(indicada, "pre_baixa_ler", { _cycle: cicloInd })).dados.situacao).toBe("aguardando_conferencia");
  });
});
