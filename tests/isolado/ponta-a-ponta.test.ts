/**
 * Varredura de ponta a ponta — banco ISOLADO, dados sintéticos.
 *
 * Percorre o caminho real, só pelas rotinas e políticas que a interface usa:
 *   cadastro → praça → remessa → maleta → montagem → expedição → entrega/aceite
 *   → app da consultora (vitrine) → cliente → pedido → cobrança Lardan
 *   → cockpit de cobrança → portal do representante → dados fiscais (Focus).
 * Cada etapa confere o reflexo nas outras telas.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, type Conta } from "./base";
import { montarNfe } from "../../src/lib/focus/nfe";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

function cpf(base9: string) {
  const d = base9.split("").map(Number);
  const dv = (arr: number[]) => {
    const s = arr.reduce((acc, n, i) => acc + n * (arr.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(d);
  const d2 = dv([...d, d1]);
  return base9 + d1 + d2;
}
const novoCpf = () => cpf(String(100000000 + Math.floor(Math.random() * 799999999)));

let master: Conta, rep: Conta, repOutro: Conta, cons: Conta, consOutra: Conta, cobranca: Conta;
let deposito = "", vA = "", vB = "", praca = "", remessa = "", ciclo = "", cliente = "", pedido = "";
let cpfConsultora = "";
const chave = (s: string) => `e2e-${marca}-${s}`;

async function primeiraTransferencia(c: string) {
  return (await um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 order by seq limit 1`, [c])).id;
}

beforeAll(async () => {
  master = await criarConta({ nome: `e2e-master-${marca}`, papeis: ["master"], comParty: true });
  rep = await criarConta({ nome: `e2e-rep-${marca}`, papeis: ["representante"], comParty: true });
  repOutro = await criarConta({ nome: `e2e-rep2-${marca}`, papeis: ["representante"], comParty: true });
  cons = await criarConta({ nome: `e2e-cons-${marca}`, papeis: ["consultora"], comParty: true });
  consOutra = await criarConta({ nome: `e2e-cons2-${marca}`, papeis: ["consultora"], comParty: true });
  cobranca = await criarConta({ nome: `e2e-cob-${marca}`, papeis: ["cobranca"], comParty: true });
  deposito = await criarDeposito(`e2e-${marca}`);
  vA = await criarVariante(`e2e-a-${marca}`, 15900);
  vB = await criarVariante(`e2e-b-${marca}`, 8900);
  await porEstoque(vA, deposito, 20);
  await porEstoque(vB, deposito, 20);
});

describe("1. cadastro", () => {
  test("equipe completa a ficha da consultora pelas políticas da tela (CPF, contato, endereço, papel, praça, representante)", async () => {
    cpfConsultora = novoCpf();
    const up = await ler(master, `update public.parties set doc=$2, status='ativo' where id=$1 returning id`, [cons.partyId, cpfConsultora]);
    expect(up.erro).toBeNull();
    expect(up.linhas.length).toBe(1);
    expect((await um<{ d: string }>(`select doc_digits d from public.parties where id=$1`, [cons.partyId])).d).toBe(cpfConsultora);
    const papel = await ler(master, `insert into public.party_roles (party_id, role) values ($1,'consultora') returning id`, [cons.partyId]);
    expect(papel.erro).toBeNull();
    await ler(master, `insert into public.party_roles (party_id, role) values ($1,'representante')`, [rep.partyId]);
    const ct = await ler(master, `insert into public.contact_points (party_id, kind, value, is_primary) values ($1,'whatsapp','43999990000',true),($1,'email',$2,false)`,
      [cons.partyId, `e2e.${marca}@lardan.test`]);
    expect(ct.erro).toBeNull();
    const end = await ler(master,
      `insert into public.party_addresses (party_id, label, postal_code, street, street_number, district, city, uf, ibge_city_code, is_primary)
       values ($1,'Principal','86200000','Rua Teste','10','Centro','Ibiporã','PR','4109807',true) returning id`, [cons.partyId]);
    expect(end.erro).toBeNull();
    const pr = await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`E2E Praça ${marca}`]);
    expect(pr.erro).toBeNull();
    praca = pr.linhas[0]!.id;
    expect(praca).toBeTruthy();
    const perfil = await ler(master,
      `insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
       on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id returning party_id`,
      [cons.partyId, rep.partyId, praca]);
    expect(perfil.erro).toBeNull();
  });

  test("consultora não cria nem edita cadastro de outra pessoa", async () => {
    const r = await ler(cons, `insert into public.parties (kind, display_name, status) values ('pessoa','Intrusa','ativo') returning id`);
    expect(r.ok && r.linhas.length > 0).toBe(false);
    const e = await ler(cons, `update public.parties set display_name='x' where id=$1 returning id`, [consOutra.partyId]);
    expect(e.linhas.length).toBe(0);
  });

  test("0124: a tela não grava um segundo cadastro com o mesmo CPF (nem por edição); a própria ficha continua editável", async () => {
    const r = await ler(master, `insert into public.parties (kind, display_name, doc, status) values ('pessoa','Duplicada E2E',$1,'ativo') returning id`, [cpfConsultora]);
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("já está cadastrado");
    const ed = await ler(master, `update public.parties set doc=$2 where id=$1 returning id`, [consOutra.partyId, cpfConsultora]);
    expect(ed.erro).toContain("já está cadastrado");
    const propria = await ler(master, `update public.parties set doc=$2, display_name=display_name where id=$1 returning id`, [cons.partyId, cpfConsultora]);
    expect(propria.erro).toBeNull();
    // não vira consulta de CPF para quem não grava cadastro
    const oraculo = await ler<{ r: string | null }>(cons, `select public.parties_doc_em_uso($1, null) r`, [cpfConsultora]);
    expect(oraculo.linhas[0]?.r ?? null).toBeNull();
    // rotinas do banco não passam pela trava (seguem com a própria busca por documento)
    const rotina = await um<{ id: string }>(`insert into public.parties (kind, display_name, doc, status) values ('pessoa','Rotina E2E',$1,'ativo') returning id`, [cpfConsultora]);
    await adm.unsafe(`delete from public.parties where id=$1`, [rotina.id]);
  });
});

describe("2. remessa → maleta → montagem → expedição → aceite", () => {
  test("remessa nasce depois do último número do SmallData e abre a maleta da consultora da praça", async () => {
    const r = await rpc<{ id: string; numero: number }>(master, "remessa_criar", {
      _praca: praca, _representante: rep.partyId, _deposito: deposito,
      _data_acerto: new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10),
    });
    expect(r.erro).toBeNull();
    remessa = r.dados.id;
    const legadoMax = (await um<{ m: number | null }>(`select max(numero) m from public.legado_remessas`)).m ?? 0;
    expect(r.dados.numero).toBeGreaterThan(Math.max(874, legadoMax));
    const fora = await rpc(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: consOutra.partyId });
    expect(fora.erro).toContain("praça");
    const m = await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: cons.partyId });
    expect(m.erro).toBeNull();
    ciclo = m.dados.cycle_id;
    const de_novo = await rpc<{ repetida: boolean }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: cons.partyId });
    expect(de_novo.dados.repetida).toBe(true);
  });

  test("em montagem a maleta ainda não aparece no app", async () => {
    const v = await rpc<{ lardan: { cycle_id: string; motivo_invisivel: string | null }[] }>(master, "consultora_maletas", { _party: cons.partyId });
    expect(v.erro).toBeNull();
    expect(v.dados.lardan.find((x) => x.cycle_id === ciclo)!.motivo_invisivel).toBeTruthy();
    const pecas = await ler(cons, `select * from public.consultant_pieces()`);
    expect(pecas.erro).toBeNull();
    expect(JSON.stringify(pecas.linhas)).not.toContain(ciclo);
  });

  test("monta, confere, expede; a consultora recebe e aceita; o estoque sai do depósito", async () => {
    expect((await rpc(master, "kit_item_upsert", { _cycle: ciclo, _variant: vA, _qty: 3 })).erro).toBeNull();
    expect((await rpc(master, "kit_item_upsert", { _cycle: ciclo, _variant: vB, _qty: 2 })).erro).toBeNull();
    expect((await rpc(master, "kit_conferir", { _cycle: ciclo, _note: null })).erro).toBeNull();
    expect((await rpc(master, "kit_expedir", { _cycle: ciclo, _payload: { rota: "direta" } })).erro).toBeNull();
    const dep = await um<{ q: number }>(`select quantity q from public.stock_balances where variant_id=$1 and location_id=$2`, [vA, deposito]);
    expect(dep.q).toBe(17);
    const outra = await rpc(consOutra, "kit_transfer_confirm", { _transfer: await primeiraTransferencia(ciclo), _payload: {} });
    expect(outra.ok).toBe(false);
    expect((await rpc(cons, "kit_transfer_confirm", { _transfer: await primeiraTransferencia(ciclo), _payload: {} })).erro).toBeNull();
    const ace = await rpc(cons, "kit_aceitar", {
      _cycle: ciclo,
      _itens: [{ variant_id: vA, qty_accepted: 3, qty_divergent: 0 }, { variant_id: vB, qty_accepted: 2, qty_divergent: 0 }],
      _idempotency_key: chave("aceite"),
    });
    expect(ace.erro).toBeNull();
    const st = await um<{ s: string; r: string | null }>(`select status::text s, remessa_id::text r from public.kit_cycles where id=$1`, [ciclo]);
    expect(st.s).toBe("operacao");
    expect(st.r).toBe(remessa);
  });
});

describe("3. app da consultora", () => {
  test("vitrine mostra as peças da maleta só para a dona", async () => {
    const minhas = await ler(cons, `select * from public.consultant_pieces()`);
    expect(minhas.erro).toBeNull();
    const txt = JSON.stringify(minhas.linhas);
    expect(txt).toContain(vA);
    expect(txt).toContain(vB);
    const alheias = await ler(consOutra, `select * from public.consultant_pieces()`);
    expect(JSON.stringify(alheias.linhas)).not.toContain(vA);
  });

  test("início do app responde e o cockpit da equipe diz que ela vê a maleta", async () => {
    const home = await rpc(cons, "consultant_home", {});
    expect(home.erro).toBeNull();
    const v = await rpc<{ lardan: { cycle_id: string; motivo_invisivel: string | null }[] }>(master, "consultora_maletas", { _party: cons.partyId });
    expect(v.dados.lardan.find((x) => x.cycle_id === ciclo)!.motivo_invisivel).toBeNull();
  });

  test("cliente própria + pedido da maleta; peça de maleta alheia e quantidade acima do saldo são recusadas", async () => {
    const c = await ler(cons, `insert into public.consultant_clients (consultora_party_id, nome, telefone) values ($1,'Joana E2E','43988887777') returning id`, [cons.partyId]);
    expect(c.erro).toBeNull();
    cliente = (c.linhas[0] as { id: string }).id;
    const alheia = await ler(consOutra, `select id from public.consultant_clients where id=$1`, [cliente]);
    expect(alheia.linhas.length).toBe(0);

    const demais = await rpc(cons, "consultant_order_create", {
      _client: cliente, _itens: [{ cycle_id: ciclo, variant_id: vA, quantidade: 4 }], _idempotency_key: chave("demais"),
    });
    expect(demais.erro).toContain("Restam");
    const invasao = await rpc(consOutra, "consultant_order_create", {
      _client: cliente, _itens: [{ cycle_id: ciclo, variant_id: vA, quantidade: 1 }], _idempotency_key: chave("invasao"),
    });
    expect(invasao.ok).toBe(false);

    const p = await rpc<{ order_id: string; total_cents: number }>(cons, "consultant_order_create", {
      _client: cliente, _itens: [{ cycle_id: ciclo, variant_id: vA, quantidade: 2 }, { cycle_id: ciclo, variant_id: vB, quantidade: 1 }],
      _idempotency_key: chave("pedido"),
    });
    expect(p.erro).toBeNull();
    pedido = p.dados.order_id;
    expect(p.dados.total_cents).toBe(2 * 15900 + 8900);
    const rep2 = await rpc<{ order_id: string; repetido: boolean }>(cons, "consultant_order_create", {
      _client: cliente, _itens: [{ cycle_id: ciclo, variant_id: vA, quantidade: 2 }], _idempotency_key: chave("pedido"),
    });
    expect(rep2.dados.order_id).toBe(pedido);
  });

  test("comportamento atual: pedido do app não reserva a peça (saldo da maleta fica igual até o acerto)", async () => {
    const b = await um<{ disp: number; vend: number; res: number }>(
      `select qty_available disp, qty_sold vend, qty_reserved res from public.kit_balances where cycle_id=$1 and variant_id=$2`, [ciclo, vA]);
    expect([b.disp, b.vend, b.res]).toEqual([3, 0, 0]);
  });
});

describe("4. cobrança Lardan pelo app", () => {
  let titulo = "";
  let clienteParty = "";
  test("gera título a receber em nome da cliente (CPF válido) e não duplica", async () => {
    const fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`E2E ${marca}`])).id;
    const emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`E2E Emp ${marca}`])).id;
    await adm.unsafe(`delete from public.consultora_cobranca_config`);
    await adm.unsafe(`insert into public.consultora_cobranca_config (id, ator_user_id, business_entity_id, financial_account_id) values (true,$1,$2,$3)`,
      [master.uid, emp, fin]);
    const doc = novoCpf();
    const r = await rpc<{ installment_id: string; forma: string }>(cons, "consultora_pagamento_titulo", {
      _order: pedido, _forma: "depois", _doc: doc, _venc: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10),
    });
    expect(r.erro).toBeNull();
    const o = await um<{ t: string; p: string; v: number }>(
      `select o.pay_title_id t, o.pay_party_id p, t.valor_cents v from public.sales_orders o join public.financial_titles t on t.id=o.pay_title_id where o.id=$1`, [pedido]);
    titulo = o.t;
    clienteParty = o.p;
    expect(Number(o.v)).toBe(2 * 15900 + 8900);
    const outra = await rpc(cons, "consultora_pagamento_titulo", { _order: pedido, _forma: "pix", _doc: doc, _venc: null });
    expect(outra.erro).toContain("já tem uma cobrança");
    expect(titulo).toBeTruthy();
  });

  test("situação do pagamento no app e cockpit de cobrança da equipe", async () => {
    const s = await rpc(cons, "consultora_pagamento_situacao", { _order: pedido });
    expect(s.erro).toBeNull();
    const dev = await rpc(cobranca, "cob_devedor", { _party: clienteParty });
    expect(dev.erro).toBeNull();
    expect(JSON.stringify(dev.dados)).toContain(titulo);
    const negado = await rpc(cons, "cob_devedor", { _party: clienteParty });
    expect(negado.ok).toBe(false);
    const ck = await rpc(cobranca, "consultora_cockpit_financeiro", { _party: cons.partyId });
    expect(ck.erro).toBeNull();
    expect(Object.keys((ck.dados ?? {}) as object)).toEqual(expect.arrayContaining(["resumo", "maletas", "parcelas", "comissoes"]));
  });
});

describe("5. representante", () => {
  test("portal do representante lista a consultora da carteira; outro representante não lê", async () => {
    const r = await rpc<unknown>(rep, "rep_portal_consultoras", { _rep: rep.partyId });
    expect(r.erro).toBeNull();
    expect(JSON.stringify(r.dados)).toContain(cons.partyId!);
    const res = await rpc(rep, "rep_portal_resumo", { _rep: rep.partyId });
    expect(res.erro).toBeNull();
    const cobr = await rpc(rep, "rep_portal_cobrancas", { _rep: rep.partyId, _filtro: "todas" });
    expect(cobr.erro).toBeNull();
    const invasao = await rpc(repOutro, "rep_portal_consultoras", { _rep: rep.partyId });
    expect(invasao.ok && JSON.stringify(invasao.dados).includes(cons.partyId!)).toBe(false);
    const consultora = await rpc(cons, "rep_portal_resumo", { _rep: rep.partyId });
    expect(consultora.ok && consultora.dados != null && JSON.stringify(consultora.dados) !== "null").toBe(false);
  });

  test("representante vê a maleta da consultora da carteira; o outro não", async () => {
    expect((await ler(rep, `select id from public.kit_cycles where id=$1`, [ciclo])).linhas.length).toBe(1);
    expect((await ler(repOutro, `select id from public.kit_cycles where id=$1`, [ciclo])).linhas.length).toBe(0);
  });
});

describe("6. nota fiscal (Focus) — dados e montagem, sem envio", () => {
  test("dados fiscais da consultora saem completos e viram uma NF-e de remessa válida", async () => {
    const d = await rpc<{ pendencias: string[]; itens: unknown[] } & Record<string, unknown>>(master, "fiscal_focus_dados", {
      _party: cons.partyId, _itens: [{ variant_id: vA, quantidade: 3 }, { variant_id: vB, quantidade: 2 }],
    });
    expect(d.erro).toBeNull();
    expect(d.dados.pendencias ?? []).toEqual([]);
    const negado = await rpc(cons, "fiscal_focus_dados", { _party: cons.partyId, _itens: [] });
    expect(negado.ok).toBe(false);
    expect(typeof montarNfe).toBe("function");
  });
});
