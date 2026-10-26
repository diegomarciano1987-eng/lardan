/**
 * 0160 — app do representante. Banco ISOLADO, dados sintéticos.
 * Cobrança por faixa/ordem, contato e promessa no histórico da Central, reativação só sem dívida (ou com o Master),
 * cobrança nova ligada à parcela e até o saldo, só a carteira dele, dinheiro com recibo (Retido Representante),
 * acerto em campo, maletas da carteira, agenda de visitas, funil coerente e telefones repetidos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const dia = (n: number) => new Date(Date.now() - 3 * 36e5 + n * 864e5).toISOString().slice(0, 10);
const chave = () => crypto.randomUUID();

let master: Conta, rep: Conta, rep2: Conta, cons: Conta, consB: Conta, consInativa: Conta, consLimpa: Conta, consOutra: Conta;
let emp = "", fin = "", deposito = "", praca = "", remessa = "", vA = "", vB = "";
let p40 = "", p5 = "", pFutura = "", pB = "", pInativa = "", ciclo = "";

async function titulo(party: string, valor: number, venc: string, desc: string) {
  const r = await rpc<string>(master, "fin_title_create", { _payload: {
    direction: "receivable", business_entity_id: emp, party_id: party, descricao: desc, documento: `T-${chave().slice(0, 6)}`,
    emissao: dia(-60), competencia: venc, valor_cents: valor, financial_account_id: fin, origem: "manual", status: "ativo",
    parcelas: [{ valor_cents: valor, vencimento: venc }] } });
  if (r.erro) throw new Error(r.erro);
  return (await um<{ id: string }>(`select id from public.financial_installments where title_id=$1`, [r.dados])).id;
}

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
  const a = await rpc(c, "kit_aceitar", { _cycle: id, _idempotency_key: `rp-${id}`, _itens: itens.map(([v, q]) => ({ variant_id: v, qty_accepted: q, qty_divergent: 0 })) });
  if (a.erro) throw new Error(a.erro);
  return id;
}

beforeAll(async () => {
  master = await criarConta({ nome: `rp-master-${marca}`, papeis: ["master"], comParty: true });
  rep = await criarConta({ nome: `rp-rep-${marca}`, papeis: ["representante"], comParty: true });
  rep2 = await criarConta({ nome: `rp-rep2-${marca}`, papeis: ["representante"], comParty: true });
  cons = await criarConta({ nome: `rp-cons-${marca}`, papeis: ["consultora"], comParty: true });
  consB = await criarConta({ nome: `rp-consB-${marca}`, papeis: ["consultora"], comParty: true });
  consInativa = await criarConta({ nome: `rp-inativa-${marca}`, papeis: ["consultora"], comParty: true });
  consLimpa = await criarConta({ nome: `rp-limpa-${marca}`, papeis: ["consultora"], comParty: true });
  consOutra = await criarConta({ nome: `rp-outra-${marca}`, papeis: ["consultora"], comParty: true });
  for (const r of [rep, rep2]) await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'representante') on conflict do nothing`, [r.partyId]);
  deposito = await criarDeposito(`rp-${marca}`);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça RP ${marca}`])).linhas[0]!.id;
  for (const [c, r] of [[cons, rep], [consB, rep], [consInativa, rep], [consLimpa, rep], [consOutra, rep2]] as [Conta, Conta][]) {
    await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [c.partyId]);
    await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id, representative_party_id) values ($1,$2,$3)
      on conflict (party_id) do update set praca_id=excluded.praca_id, representative_party_id=excluded.representative_party_id`, [c.partyId, praca, r.partyId]);
  }
  await adm.unsafe(`update public.parties set status='inativo' where id in ($1,$2)`, [consInativa.partyId, consLimpa.partyId]);
  fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`RP ${marca}`])).id;
  emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`RP Emp ${marca}`])).id;
  await adm.unsafe(`delete from public.consultora_cobranca_config`);
  await adm.unsafe(`insert into public.consultora_cobranca_config (id, ator_user_id, business_entity_id, financial_account_id) values (true,$1,$2,$3)`, [master.uid, emp, fin]);
  await adm.unsafe(`delete from public.consultora_comissao_faixas`);
  await adm.unsafe(`insert into public.consultora_comissao_faixas (min_vendido_cents, percentual, titulo) values (0,20,'20%'),(20000,25,'25%'),(50000,30,'30%'),(65000,35,'35%'),(120000,40,'40%')`);
  p40 = await titulo(cons.partyId!, 10000, dia(-40), "Acerto antigo");
  p5 = await titulo(cons.partyId!, 5000, dia(-5), "Acerto recente");
  pFutura = await titulo(cons.partyId!, 7000, dia(10), "Acerto a vencer");
  pB = await titulo(consB.partyId!, 30000, dia(-10), "Acerto B");
  pInativa = await titulo(consInativa.partyId!, 8000, dia(-95), "Dívida antiga");
  vA = await criarVariante(`rp-a-${marca}`, 10000);
  vB = await criarVariante(`rp-b-${marca}`, 5000);
  for (const v of [vA, vB]) await porEstoque(v, deposito, 20);
  remessa = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _deposito: deposito, _data_acerto: dia(15) })).dados.id;
});

type Item = { installment_id: string; party_id: string; atraso: number; divida_cents: number; ultimo_contato: { tipo: string } | null; promessa: { valor_cents: number } | null };
type Lista = { total: number; faixas: Record<string, number>; itens: Item[] };

describe("1-2. cobrança da carteira", () => {
  test("mais recentes primeiro, ou maior dívida; filtro por faixa de atraso; só a carteira dele", async () => {
    const rec = await rpc<Lista>(rep, "rep_cobrancas_lista", { _rep: rep.partyId, _faixa: "vencidas", _ordem: "recentes", _pagina: 1, _busca: null });
    expect(rec.erro).toBeNull();
    const ids = rec.dados.itens.map((i) => i.installment_id);
    expect(ids.indexOf(p5)).toBeLessThan(ids.indexOf(pB));
    expect(ids.indexOf(pB)).toBeLessThan(ids.indexOf(p40));
    expect(ids).not.toContain(pFutura);
    const maior = await rpc<Lista>(rep, "rep_cobrancas_lista", { _rep: rep.partyId, _faixa: "vencidas", _ordem: "maior", _pagina: 1, _busca: null });
    expect(maior.dados.itens[0]!.installment_id).toBe(pB);   // 300,00 é a maior dívida
    const f = await rpc<Lista>(rep, "rep_cobrancas_lista", { _rep: rep.partyId, _faixa: "31_60", _ordem: "recentes", _pagina: 1, _busca: null });
    expect(f.dados.itens.map((i) => i.installment_id)).toEqual([p40]);
    expect(f.dados.faixas).toMatchObject({ "1_30": 2, "31_60": 1, "90_mais": 1, a_vencer: 1 });
    expect((await rpc(rep2, "rep_cobrancas_lista", { _rep: rep.partyId, _faixa: "todas", _ordem: "recentes", _pagina: 1, _busca: null })).ok).toBe(false);
  });

  test("contato e promessa vão para o mesmo histórico da Central de Cobrança", async () => {
    expect((await rpc(rep2, "rep_cob_registrar", { _party: cons.partyId, _tipo: "ligacao", _resultado: "sucesso", _obs: "x", _parcelas: [] })).ok).toBe(false);
    expect((await rpc(rep, "rep_cob_registrar", { _party: cons.partyId, _tipo: "etapa", _resultado: null, _obs: "x", _parcelas: [] })).erro).toContain("inválido");
    const c = await rpc<string>(rep, "rep_cob_registrar", { _party: cons.partyId, _tipo: "ligacao", _resultado: "nao_atendeu", _obs: "Liguei 2x", _parcelas: [p40] });
    expect(c.erro).toBeNull();
    const i = await um<{ autor: string; tipo: string }>(`select autor_id::text autor, tipo from public.cob_interacoes where id=$1`, [c.dados]);
    expect(i).toEqual({ autor: rep.uid!, tipo: "ligacao" });
    expect((await um<{ e: string }>(`select etapa e from public.cob_casos where party_id=$1`, [cons.partyId])).e).toBe("em_contato");
    expect((await rpc(rep, "rep_cob_promessa", { _party: cons.partyId, _valor: 20000, _data: dia(3), _parcelas: [p40], _obs: null })).erro).toContain("até o saldo");
    expect((await rpc(rep, "rep_cob_promessa", { _party: cons.partyId, _valor: 5000, _data: dia(-1), _parcelas: [p40], _obs: null })).erro).toContain("data");
    expect((await rpc(rep, "rep_cob_promessa", { _party: cons.partyId, _valor: 10000, _data: dia(3), _parcelas: [pB], _obs: null })).erro).toContain("inválida");
    const p = await rpc<string>(rep, "rep_cob_promessa", { _party: cons.partyId, _valor: 10000, _data: dia(3), _parcelas: [p40], _obs: "paga sexta" });
    expect(p.erro).toBeNull();
    expect((await rpc(rep, "rep_cob_promessa", { _party: cons.partyId, _valor: 5000, _data: dia(4), _parcelas: [p40], _obs: null })).erro).toContain("Já existe");
    const h = await rpc<{ interacoes: { tipo: string }[]; promessas: { status: string }[] }>(rep, "rep_cob_historico", { _party: cons.partyId });
    expect(h.dados.interacoes.map((x) => x.tipo)).toEqual(expect.arrayContaining(["ligacao", "negociacao"]));
    expect(h.dados.promessas[0]!.status).toBe("vigente");
    const l = await rpc<Lista>(rep, "rep_cobrancas_lista", { _rep: rep.partyId, _faixa: "31_60", _ordem: "recentes", _pagina: 1, _busca: null });
    expect(l.dados.itens[0]).toMatchObject({ ultimo_contato: { tipo: "negociacao" }, promessa: { valor_cents: 10000 } });
  });
});

describe("3. reativação", () => {
  test("com dívida vira pedido para o Master; sem dívida reativa na hora", async () => {
    const r = await rpc<{ resultado: string; divida_cents: number }>(rep, "rep_consultora_reativar_pedir", { _party: consInativa.partyId, _motivo: "quer voltar" });
    expect(r.dados).toEqual({ resultado: "pedido_enviado", divida_cents: 8000 });
    expect((await rpc<{ resultado: string }>(rep, "rep_consultora_reativar_pedir", { _party: consInativa.partyId, _motivo: null })).dados.resultado).toBe("ja_pedido");
    expect((await rpc<boolean>(rep, "rep_consultora_reativar", { _party: consInativa.partyId })).dados).toBe(false);
    expect((await um<{ s: string }>(`select status::text s from public.parties where id=$1`, [consInativa.partyId])).s).toBe("inativo");
    expect((await rpc(rep, "rep_reativacoes_pendentes", {})).ok).toBe(false);
    const pend = await rpc<{ id: string; party_id: string }[]>(master, "rep_reativacoes_pendentes", {});
    const pedido = pend.dados.find((x) => x.party_id === consInativa.partyId)!;
    expect(pedido).toBeTruthy();
    expect((await rpc(rep, "rep_reativacao_decidir", { _id: pedido.id, _aprovar: true, _motivo: "x" })).ok).toBe(false);
    expect((await rpc(master, "rep_reativacao_decidir", { _id: pedido.id, _aprovar: true, _motivo: "acordo de parcelamento" })).erro).toBeNull();
    expect((await um<{ s: string }>(`select status::text s from public.parties where id=$1`, [consInativa.partyId])).s).toBe("ativo");
    expect((await rpc<{ resultado: string }>(rep, "rep_consultora_reativar_pedir", { _party: consLimpa.partyId, _motivo: null })).dados.resultado).toBe("reativada");
    expect((await um<{ s: string }>(`select status::text s from public.parties where id=$1`, [consLimpa.partyId])).s).toBe("ativo");
  });
});

describe("4-5. cobrança nova e carteira", () => {
  test("sem parcela não cobra; parcial nunca passa do saldo (somando as parciais abertas)", async () => {
    expect((await rpc(rep, "rep_cobranca_avulsa", { _party: cons.partyId, _valor_cents: 1000, _descricao: "x", _chave: chave() })).erro).toContain("ligada a uma parcela");
    expect((await rpc(rep2, "rep_cobranca_parcial", { _installment: pFutura, _valor_cents: 1000, _chave: chave() })).ok).toBe(false);
    expect((await rpc(rep, "rep_cobranca_parcial", { _installment: pFutura, _valor_cents: 7001, _chave: chave() })).erro).toContain("passa do saldo");
    const k = chave();
    const a = await rpc<string>(rep, "rep_cobranca_parcial", { _installment: pFutura, _valor_cents: 3000, _chave: k });
    expect(a.erro).toBeNull();
    expect(a.dados).not.toBe(pFutura);
    expect((await rpc<string>(rep, "rep_cobranca_parcial", { _installment: pFutura, _valor_cents: 3000, _chave: k })).dados).toBe(a.dados);
    expect((await um<{ v: number }>(`select valor_cents::int v from public.financial_installments where id=$1`, [a.dados])).v).toBe(3000);
    expect((await rpc(rep, "rep_cobranca_parcial", { _installment: pFutura, _valor_cents: 4001, _chave: chave() })).erro).toContain("até 40,00");
    expect((await rpc<string>(rep, "rep_cobranca_parcial", { _installment: pB, _valor_cents: 30000, _chave: chave() })).dados).toBe(pB);
  });

  test("'Buscar em todas do sistema' some para o representante (o espelho da Lardan continua)", async () => {
    expect((await rpc(rep, "rep_portal_busca_todas", { _rep: rep.partyId, _busca: "rp-outra", _pagina: 1 })).erro).toContain("só na sua carteira");
    expect((await rpc(master, "rep_portal_busca_todas", { _rep: rep.partyId, _busca: "rp-outra", _pagina: 1 })).erro).toBeNull();
  });
});

describe("6. dinheiro em mãos", () => {
  test("recibo, baixa na conta Retido Representante, idempotente e até o saldo", async () => {
    expect((await rpc(rep, "rep_dinheiro_receber", { _installment: p5, _valor_cents: 5001, _chave: chave(), _obs: null })).erro).toContain("passa do saldo");
    const k = chave();
    const r = await rpc<{ numero: number; valor_cents: number; saldo_restante_cents: number; consultora: string; representante: string; repetido: boolean }>(
      rep, "rep_dinheiro_receber", { _installment: p5, _valor_cents: 3000, _chave: k, _obs: "em espécie" });
    expect(r.erro).toBeNull();
    expect(r.dados).toMatchObject({ valor_cents: 3000, saldo_restante_cents: 2000, repetido: false });
    expect(r.dados.numero).toBeGreaterThan(0);
    const conta = await um<{ nome: string; v: number }>(`select a.nome, s.valor_cents::int v from public.rep_recibos r join public.financial_settlements s on s.id=r.settlement_id
       join public.financial_accounts a on a.id=s.financial_account_id where r.chave=$1`, [k]);
    expect(conta.v).toBe(3000);
    expect(conta.nome).toMatch(/^Retido Representante/);
    const de_novo = await rpc<{ numero: number; repetido: boolean }>(rep, "rep_dinheiro_receber", { _installment: p5, _valor_cents: 3000, _chave: k, _obs: null });
    expect(de_novo.dados).toMatchObject({ numero: r.dados.numero, repetido: true });
    expect((await um<{ s: number }>(`select public.fin_installment_saldo($1)::int s`, [p5])).s).toBe(2000);
    expect((await rpc(rep2, "rep_dinheiro_receber", { _installment: p5, _valor_cents: 100, _chave: chave(), _obs: null })).ok).toBe(false);
    const lista = await rpc<{ total_cents: number }>(rep, "rep_recibos_lista", { _rep: rep.partyId, _dias: 30 });
    expect(Number(lista.dados.total_cents)).toBe(3000);
  });
});

describe("7-8. acerto em campo e maletas da carteira", () => {
  test("lê a devolução, calcula venda e comissão, fecha e cobra; maleta vencida aparece com alerta", async () => {
    ciclo = await maletaAceita(cons, remessa, [[vA, 4], [vB, 2]]);
    await adm.unsafe(`update public.kit_cycles set due_at = now() - interval '2 days' where id=$1`, [ciclo]);
    const m = await rpc<{ cycle_id: string; vencida: boolean; pre_baixa: string }[]>(rep, "rep_maletas_carteira", { _rep: rep.partyId });
    expect(m.dados.find((x) => x.cycle_id === ciclo)).toMatchObject({ vencida: true, pre_baixa: "sem_pre_baixa" });
    expect((await rpc(rep2, "rep_maletas_carteira", { _rep: rep.partyId })).ok).toBe(false);
    expect((await rpc(cons, "rep_acerto_campo_devolucao", { _cycle: ciclo, _leituras: [] })).ok).toBe(false);
    expect((await rpc(rep, "rep_acerto_campo_devolucao", { _cycle: ciclo, _leituras: [{ variant_id: vA, qtd: 5 }] })).erro).toContain("leu 5");
    // voltaram 1 A e 2 B → vendeu 3 A = 300,00 → 25% → paga 225,00
    const c = await rpc<Record<string, number>>(rep, "rep_acerto_campo_devolucao", { _cycle: ciclo, _leituras: [{ variant_id: vA, qtd: 1 }, { variant_id: vB, qtd: 2 }] });
    expect(c.erro).toBeNull();
    expect(c.dados).toMatchObject({ vendido_cents: 30000, comissao_pct: 25, valor_pagar_cents: 22500 });
    const f = await rpc<{ installment_id: string; valor_pagar_cents: number }>(rep, "pre_baixa_fechar", { _cycle: ciclo });
    expect(f.erro).toBeNull();
    expect(Number(f.dados.valor_pagar_cents)).toBe(22500);
    const m2 = await rpc<{ cycle_id: string; pre_baixa: string; origem: string; saldo_cents: number }[]>(rep, "rep_maletas_carteira", { _rep: rep.partyId });
    expect(m2.dados.find((x) => x.cycle_id === ciclo)).toMatchObject({ pre_baixa: "aguardando_pagamento", origem: "campo", saldo_cents: 22500 });
    // pagou em dinheiro ao representante → aguardando conferência; na Lardan a conferência bate com o que ele leu
    const k = chave();
    expect((await rpc(rep, "rep_dinheiro_receber", { _installment: f.dados.installment_id, _valor_cents: 22500, _chave: k, _obs: null })).erro).toBeNull();
    expect((await rpc<{ situacao: string }>(rep, "pre_baixa_ler", { _cycle: ciclo })).dados.situacao).toBe("aguardando_conferencia");
    const conf = await rpc<{ status: string; bateu: boolean }>(master, "pre_baixa_conferir", { _cycle: ciclo, _leituras: [{ variant_id: vA, qtd: 1 }, { variant_id: vB, qtd: 2 }], _aplicar: true });
    expect(conf.dados).toMatchObject({ status: "encerrada", bateu: true });
  });
});

describe("9. agenda de visitas", () => {
  test("agenda, registra e o registro entra no histórico da consultora", async () => {
    expect((await rpc(rep, "rep_visita_agendar", { _rep: rep.partyId, _party: consOutra.partyId, _lead: null, _quando: new Date(Date.now() + 864e5).toISOString(), _motivo: "Cobrança" })).erro).toContain("fora da sua carteira");
    const v = await rpc<string>(rep, "rep_visita_agendar", { _rep: rep.partyId, _party: cons.partyId, _lead: null, _quando: new Date(Date.now() + 864e5).toISOString(), _motivo: "Acerto e cobrança" });
    expect(v.erro).toBeNull();
    const ag = await rpc<{ id: string; status: string }[]>(rep, "rep_agenda", { _rep: rep.partyId, _de: null, _ate: null });
    expect(ag.dados.find((x) => x.id === v.dados)!.status).toBe("agendada");
    expect((await rpc(rep, "rep_visita_registrar", { _id: v.dados, _status: "realizada", _resultado: "" })).erro).toContain("como foi");
    expect((await rpc(rep2, "rep_visita_registrar", { _id: v.dados, _status: "realizada", _resultado: "ok ok" })).ok).toBe(false);
    expect((await rpc(rep, "rep_visita_registrar", { _id: v.dados, _status: "realizada", _resultado: "Pagou parte e combinou o resto" })).erro).toBeNull();
    const h = await um<{ n: number }>(`select count(*)::int n from public.cob_interacoes where party_id=$1 and observacao like 'Visita do representante%'`, [cons.partyId]);
    expect(h.n).toBe(1);
  });
});

describe("10. funil de captação", () => {
  test("a coluna acompanha a situação na Lardan e não dá para arrastar para as colunas da Lardan", async () => {
    const lead = (await um<{ id: string }>(`insert into public.leads (full_name, whatsapp, city, uf, privacy_version, stage_id, representante_party_id)
       values ($1,'43999997777','Londrina','PR','v1',(select id from public.candidatura_stages order by sort_order limit 1),$2) returning id`, [`Cand RP ${marca}`, rep.partyId])).id;
    type Crm = { etapas: { id: string; nome: string; sistema: string | null }[]; cards: { lead_id: string; etapa_id: string; travado: boolean }[] };
    const crm = async () => (await rpc<Crm>(rep, "rep_crm", { _rep: rep.partyId })).dados;
    let d = await crm();
    const sis = (s: string) => d.etapas.find((e) => e.sistema === s)!.id;
    const livre = d.etapas.filter((e) => !e.sistema);
    expect(d.etapas.filter((e) => e.sistema).map((e) => e.sistema)).toEqual(["aprovada", "primeira_maleta", "nao_aprovada"]);
    expect(d.cards.find((c) => c.lead_id === lead)).toMatchObject({ etapa_id: livre[0]!.id, travado: false });
    expect((await rpc(rep, "rep_crm_mover", { _lead: lead, _etapa: sis("aprovada"), _nota: null })).erro).toContain("muda sozinha");
    expect((await rpc(rep, "rep_crm_mover", { _lead: lead, _etapa: livre[1]!.id, _nota: null })).erro).toBeNull();
    await adm.unsafe(`update public.leads set status='aprovado' where id=$1`, [lead]);
    d = await crm();
    expect(d.cards.find((c) => c.lead_id === lead)).toMatchObject({ etapa_id: sis("aprovada"), travado: true });
    expect((await rpc(rep, "rep_crm_mover", { _lead: lead, _etapa: livre[0]!.id, _nota: null })).erro).toContain("decisão da Lardan");
    await adm.unsafe(`update public.leads set party_id=$2 where id=$1`, [lead, cons.partyId]);   // cons já tem maleta
    d = await crm();
    expect(d.cards.find((c) => c.lead_id === lead)!.etapa_id).toBe(sis("primeira_maleta"));
    const nova = await rpc<string>(rep, "rep_crm_etapa_nova", { _rep: rep.partyId, _nome: "Retornar sábado" });
    d = await crm();
    expect(d.etapas.findIndex((e) => e.id === nova.dados)).toBeLessThan(d.etapas.findIndex((e) => e.sistema === "aprovada"));
  });
});

describe("11. telefones repetidos", () => {
  test("ficha mostra cada número uma vez; limpeza só pelo Master, com prévia e desfazer", async () => {
    await adm.unsafe(`insert into public.contact_points (party_id, kind, value, is_primary) values ($1,'telefone','(43) 99999-0101',true),($1,'whatsapp','43999990101',false),($1,'telefone','43 3333-0101',false)`, [consB.partyId]);
    const f = await rpc<{ contatos: { kind: string; value: string }[] }>(rep, "rep_consultora_ficha_rep", { _party: consB.partyId, _rep: rep.partyId });
    expect(f.erro).toBeNull();
    expect(f.dados.contatos).toHaveLength(2);
    expect(f.dados.contatos).toContainEqual({ kind: "whatsapp", value: "+5543999990101" });
    const pv = await ler<{ party_id: string; remover_qtd: number; manter_tipo: string }>(master, `select * from public.contatos_duplicados_previa() where party_id=$1`, [consB.partyId]);
    expect(pv.linhas).toEqual([expect.objectContaining({ remover_qtd: 1, manter_tipo: "whatsapp" })]);
    expect((await rpc(rep, "contatos_duplicados_aplicar", { _confirmacao: "REMOVER REPETIDOS" })).ok).toBe(false);
    expect((await rpc(master, "contatos_duplicados_aplicar", { _confirmacao: "sim" })).erro).toContain("REMOVER REPETIDOS");
    const ap = await rpc<{ lote: string; removidos: number }>(master, "contatos_duplicados_aplicar", { _confirmacao: "REMOVER REPETIDOS" });
    expect(ap.erro).toBeNull();
    const ficou = await ler<{ kind: string; is_primary: boolean }>(master, `select kind::text kind, is_primary from public.contact_points where party_id=$1 and value_norm='+5543999990101'`, [consB.partyId]);
    expect(ficou.linhas).toEqual([{ kind: "whatsapp", is_primary: true }]);
    expect((await rpc<number>(master, "contatos_duplicados_desfazer", { _lote: ap.dados.lote })).dados).toBe(ap.dados.removidos);
    expect((await um<{ n: number }>(`select count(*)::int n from public.contact_points where party_id=$1`, [consB.partyId])).n).toBe(3);
  });
});

describe("ajuste da revisão (0163)", () => {
  test("dinheiro em parcela com link do Asaas aberto: recibo sai, com aviso e tarefa para cancelar o link", async () => {
    await adm.begin(async (tx) => {
      await tx.unsafe(`set local session_replication_role = replica`);
      await tx.unsafe(`insert into public.asaas_charges (account_id, external_id, installment_id, external_status, value_cents) values (gen_random_uuid(), $1, $2, 'PENDING', 10000)`, [`pay_${marca}`, p40]);
    });
    const r = await rpc<{ numero: number; aviso_asaas?: boolean }>(rep, "rep_dinheiro_receber", { _installment: p40, _valor_cents: 1000, _chave: chave(), _obs: null });
    expect(r.erro).toBeNull();
    expect(r.dados.aviso_asaas).toBe(true);
    const t = await um<{ n: number }>(`select count(*)::int n from public.cob_tarefas where party_id=$1 and titulo like 'Cancelar o link do Asaas%' and $2 = any(installment_ids)`, [cons.partyId, p40]);
    expect(t.n).toBe(1);
    await adm.begin(async (tx) => { await tx.unsafe(`set local session_replication_role = replica`); await tx.unsafe(`delete from public.asaas_charges where external_id=$1`, [`pay_${marca}`]); });
  });
});

describe("maletas do SmallData na carteira (0163)", () => {
  test("maleta do SmallData na rua aparece na lista do representante, com alerta de vencida", async () => {
    const cod = 700000 + Math.floor(Math.random() * 90000), rem = 80000 + Math.floor(Math.random() * 9000);
    await adm.unsafe(`insert into public.party_codigos_legados (party_id, sistema, codigo) values ($1,'cliente',$2)`, [consB.partyId, String(cod)]);
    await adm.unsafe(`insert into public.legado_remessas (numero, emissao, vencimento, status) values ($1, now()::date - 40, now()::date - 3, 'aberta') on conflict (numero) do nothing`, [rem]);
    await adm.unsafe(`insert into public.legado_maletas (remessa, codcli, kit, emissao, pecas_enviadas, valor_enviado_cents) values ($1,$2,1, now()::date - 40, 30, 300000)`, [rem, cod]);
    const m = await rpc<{ fonte: string; remessa: number; vencida: boolean; pre_baixa: string; consultora: string }[]>(rep, "rep_maletas_carteira", { _rep: rep.partyId });
    expect(m.erro).toBeNull();
    expect(m.dados.find((x) => x.fonte === "smalldata" && x.remessa === rem)).toMatchObject({ vencida: true, pre_baixa: "smalldata" });
    expect((await rpc<unknown[]>(rep2, "rep_maletas_carteira", { _rep: rep2.partyId })).dados.some((x) => (x as { remessa: number }).remessa === rem)).toBe(false);
    await adm.unsafe(`delete from public.legado_maletas where remessa=$1`, [rem]);
    await adm.unsafe(`delete from public.legado_remessas where numero=$1`, [rem]);
  });
});
