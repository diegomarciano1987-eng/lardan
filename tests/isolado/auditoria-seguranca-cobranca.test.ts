/**
 * Auditoria 16/10/2026 — correções de segurança e cobrança (migração 0084). Banco ISOLADO, dados sintéticos.
 *  1. Representante não vê contato/endereço de consultora de outra carteira; bloqueada/desligada nem abre.
 *  2. Cobrança do representante não reativa bloqueada/desligada.
 *  3. Consultora não cobra no CPF de cadastro interno nem com nome que não confere.
 *  4. Sem login não lê consultora pela maleta; custo do estoque só para quem vê custo.
 *  5. Baixa automática: juros/multa do Asaas explicados; cartão via conta "Cartão a receber".
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, VISITANTE, type Conta } from "./base";

let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const oficial = async <T>(sql: string, p: unknown[] = []) =>
  (await adm.begin(async (tx) => {
    await tx.unsafe(`select set_config('lardann.asaas_link','on',true)`);
    return (await tx.unsafe(sql, p)) as T[];
  }))[0]!;
const partyDe = async (c: Conta) => (await um<{ p: string }>(`select party_id p from public.profiles where id=$1`, [c.uid])).p;

/** CPF válido a partir de 9 dígitos (base aleatória para não colidir com outras baterias). */
const base9 = () => String(100000000 + Math.floor(Math.random() * 899999999)).slice(0, 9);
function cpf(base9: string) {
  const d = base9.split("").map(Number);
  const dv = (arr: number[]) => {
    const s = arr.reduce((t, x, i) => t + x * (arr.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(d);
  const d2 = dv([...d, d1]);
  return base9 + d1 + d2;
}

async function rpcServico<T = unknown>(fn: string, args: Record<string, unknown>) {
  const [k, v] = Object.entries(args)[0]!;
  const c = await adm.reserve();
  try {
    await c.unsafe(`set role service_role`);
    await c.unsafe(`select set_config('lardan.test_role','service_role',false), set_config('lardan.test_uid','',false)`);
    const r = (await c.unsafe(`select public.${fn}(${k} => $1) as r`, [v])) as { r: T }[];
    return { dados: r[0]!.r, erro: null as string | null };
  } catch (e) {
    return { dados: null as T, erro: (e as Error).message };
  } finally {
    try { await c.unsafe(`reset role`); await c.unsafe(`select set_config('lardan.test_role','',false)`); } catch { /* */ }
    c.release();
  }
}

let master: Conta, repA: Conta, repB: Conta, consultora: Conta, outraConsultora: Conta;
let repAParty: string, repBParty: string;

beforeAll(async () => {
  master = await criarConta({ nome: "master-aud", papeis: ["master"], comParty: true });
  repA = await criarConta({ nome: "rep-a-aud", papeis: ["representante"], comParty: true });
  repB = await criarConta({ nome: "rep-b-aud", papeis: ["representante"], comParty: true });
  consultora = await criarConta({ nome: "cons-aud", papeis: ["consultora"], comParty: true });
  outraConsultora = await criarConta({ nome: "cons2-aud", papeis: ["consultora"], comParty: true });
  repAParty = await partyDe(repA);
  repBParty = await partyDe(repB);
});

async function consultoraDaCarteiraB(status: string) {
  const id = (await um<{ id: string }>(
    `insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,$2) returning id`,
    [`ISO Cons B ${marca()}`, status])).id;
  await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id) values ($1,$2)`, [id, repBParty]);
  await adm.unsafe(`insert into public.party_addresses (party_id, street, street_number, city, uf, postal_code) values ($1,'Rua Secreta','1','Londrina','PR','86000000')`, [id]);
  await adm.unsafe(`insert into public.contact_points (party_id, kind, value) values ($1,'whatsapp','43999990000')`, [id]);
  return id;
}

describe("1. privacidade do representante", () => {
  test("inativa de outra carteira: abre a ficha, mas sem contato, endereço, cheques e maletas", async () => {
    const id = await consultoraDaCarteiraB("inativo");
    const r = await rpc<{ restrito: boolean; contatos: unknown[]; endereco: unknown; na_carteira: boolean }>(
      repA, "rep_consultora_ficha_rep", { _party: id, _rep: repAParty });
    expect(r.erro).toBeNull();
    expect(r.dados.restrito).toBe(true);
    expect(r.dados.contatos).toEqual([]);
    expect(r.dados.endereco).toBeNull();
    expect(r.dados.na_carteira).toBe(false);
  });

  test("dono da carteira continua vendo tudo", async () => {
    const id = await consultoraDaCarteiraB("inativo");
    const r = await rpc<{ restrito: boolean; contatos: unknown[] }>(repB, "rep_consultora_ficha_rep", { _party: id, _rep: repBParty });
    expect(r.erro).toBeNull();
    expect(r.dados.restrito).toBe(false);
    expect(r.dados.contatos.length).toBe(1);
  });

  test("bloqueada ou desligada de outra carteira: não abre nem pode ser assumida", async () => {
    for (const s of ["bloqueado", "desligado"]) {
      const id = await consultoraDaCarteiraB(s);
      const r = await rpc(repA, "rep_consultora_ficha_rep", { _party: id, _rep: repAParty });
      expect(r.ok).toBe(false);
      const a = await rpc(repA, "rep_consultora_assumir", { _party: id, _rep: repAParty });
      expect(a.ok).toBe(false);
    }
  });
});

describe("2. reativação só de inativa", () => {
  test("bloqueada continua bloqueada e fica registrado", async () => {
    const id = await consultoraDaCarteiraB("bloqueado");
    const r = await um<{ r: boolean }>(`select public.rep_reativar_interno($1,$2,'teste') r`, [id, repB.uid]);
    expect(r.r).toBe(false);
    expect((await um<{ s: string }>(`select status::text s from public.parties where id=$1`, [id])).s).toBe("bloqueado");
    const a = await um<{ c: number }>(`select count(*)::int c from public.audit_logs where entity_id=$1 and action='consultora.reativacao_recusada'`, [id]);
    expect(a.c).toBe(1);
  });

  test("inativa volta a ativa", async () => {
    const id = await consultoraDaCarteiraB("inativo");
    const r = await um<{ r: boolean }>(`select public.rep_reativar_interno($1,$2,'teste') r`, [id, repB.uid]);
    expect(r.r).toBe(true);
    expect((await um<{ s: string }>(`select status::text s from public.parties where id=$1`, [id])).s).toBe("ativo");
  });
});

describe("3. CPF na cobrança da consultora", () => {
  let pedido: string;
  beforeAll(async () => {
    const eu = await partyDe(consultora);
    const fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`ISO ${marca()}`])).id;
    const emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`ISO Emp ${marca()}`])).id;
    await adm.unsafe(`delete from public.consultora_cobranca_config`);
    await adm.unsafe(`insert into public.consultora_cobranca_config (id, ator_user_id, business_entity_id, financial_account_id) values (true,$1,$2,$3)`, [master.uid, emp, fin]);
    pedido = (await um<{ id: string }>(
      `insert into public.sales_orders (consultora_party_id, customer_name, subtotal_cents, status) values ($1,'Ana Paula',15000,'aguardando_pagamento') returning id`,
      [eu])).id;
  });

  test("CPF de outra consultora é recusado e nada é criado", async () => {
    const doc = cpf(base9());
    await adm.unsafe(`update public.parties set doc=$2, doc_digits=$2 where id=$1`, [await partyDe(outraConsultora), doc]);
    await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [await partyDe(outraConsultora)]);
    const r = await rpc(consultora, "consultora_pagamento_titulo", { _order: pedido, _forma: "pix", _doc: doc, _venc: null });
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("não pode ser usado");
    const o = await um<{ t: string | null }>(`select pay_title_id t from public.sales_orders where id=$1`, [pedido]);
    expect(o.t).toBeNull();
  });

  test("CPF de cliente com outro nome é recusado", async () => {
    const doc = cpf(base9());
    const cli = (await um<{ id: string }>(
      `insert into public.parties (kind, display_name, legal_name, doc, doc_digits, status) values ('pessoa','Joana Lima','Joana Lima',$1,$1,'ativo') returning id`, [doc])).id;
    await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'cliente')`, [cli]);
    const r = await rpc(consultora, "consultora_pagamento_titulo", { _order: pedido, _forma: "pix", _doc: doc, _venc: null });
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("outro nome");
  });

  test("o próprio CPF da consultora é recusado", async () => {
    const doc = cpf(base9());
    await adm.unsafe(`update public.parties set doc=$2, doc_digits=$2 where id=$1`, [await partyDe(consultora), doc]);
    const r = await rpc(consultora, "consultora_pagamento_titulo", { _order: pedido, _forma: "pix", _doc: doc, _venc: null });
    expect(r.ok).toBe(false);
  });
});

describe("4. leituras protegidas", () => {
  test("papel anônimo não executa kit_consultora_info, pracas_resumo nem pdv_membros_pin_status", async () => {
    for (const f of ["public.kit_consultora_info(uuid)", "public.pracas_resumo()", "public.pdv_membros_pin_status(uuid)"]) {
      const r = await um<{ pode: boolean }>(`select has_function_privilege('anon', $1, 'EXECUTE') pode`, [f]);
      expect(r.pode).toBe(false);
    }
  });

  test("outra consultora não lê dados pela maleta alheia; a dona e a equipe leem nem a lista de praças", async () => {
    const eu = await partyDe(consultora);
    const k = (await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [`ISO ${marca()}`])).id;
    const cy = (await um<{ id: string }>(`insert into public.kit_cycles (kit_id, cycle_no, consultora_party_id) values ($1,1,$2) returning id`, [k, eu])).id;
    const r = await rpc(outraConsultora, "kit_consultora_info", { _cycle: cy });
    expect(r.dados).toBeNull();
    const propria = await rpc(consultora, "kit_consultora_info", { _cycle: cy });
    expect(propria.dados).not.toBeNull();
    const m = await rpc(master, "kit_consultora_info", { _cycle: cy });
    expect(m.dados).not.toBeNull();
    const p = await rpc<unknown[]>(VISITANTE, "pracas_resumo", {});
    expect(p.dados ?? []).toEqual([]);
  });

  test("consultora não vê o custo do estoque; master vê", async () => {
    const c = await rpc<{ custo_cents: number | null }>(consultora, "catalog_street_value", {});
    expect(c.erro).toBeNull();
    expect(c.dados.custo_cents).toBeNull();
    const m = await rpc<{ custo_cents: number | null }>(master, "catalog_street_value", {});
    expect(typeof m.dados.custo_cents).toBe("number");
  });
});

describe("5. baixa automática do Asaas", () => {
  const DIA = "2024-02-14"; // data exclusiva desta bateria (não contamina DREs de outras baterias)
  let plano: string;
  beforeAll(async () => {
    plano = (await um<{ id: string }>(`insert into public.chart_of_accounts (codigo, nome, natureza) values ($1,$1,'receita') returning id`, [`ISO-R-${marca()}`])).id;
  });

  async function cenario(valor: number, billing: string, comCartao: boolean) {
    const fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`ISO Asaas ${marca()}`])).id;
    const cartao = comCartao ? (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'compensacao') returning id`, [`ISO Cartão ${marca()}`])).id : null;
    const emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`ISO Emp ${marca()}`])).id;
    const acc = (await um<{ id: string }>(
      `insert into public.asaas_accounts (label, environment, financial_account_id, owner_entity_id, is_active, conta_cartao_receber_id) values ($1,'sandbox',$2,$3,true,$4) returning id`,
      [`ISO ${marca()}`, fin, emp, cartao])).id;
    const p = await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO P ${marca()}`]);
    const r = await rpc<string>(master, "fin_title_create", { _payload: { direction: "receivable", party_id: p.id, descricao: `ISO ${marca()}`,
      valor_cents: valor, emissao: DIA, competencia: DIA, business_entity_id: emp, chart_account_id: plano, parcelas: [{ vencimento: DIA, valor_cents: valor }] } });
    if (!r.ok) throw new Error(r.erro!);
    const inst = (await um<{ id: string }>(`select id from public.financial_installments where title_id=$1`, [r.dados])).id;
    const ext = `pay_${marca()}`;
    const ch = (await oficial<{ id: string }>(
      `insert into public.asaas_charges (account_id, external_id, value_cents, due_date, billing_type, external_status, installment_id, title_id, party_id)
       values ($1,$2,$3,$4,$5,'PENDING',$6,$7,$8) returning id`, [acc, ext, valor, DIA, billing, inst, r.dados, p.id])).id;
    return { fin, cartao, acc, inst, ext, ch };
  }
  const saldo = async (i: string) => Number((await um<{ s: string }>(`select public.fin_installment_saldo($1) s`, [i])).s);
  const razao = async (acc: string) =>
    ((await adm.unsafe(`select valor_cents::int v from public.financial_account_movements where financial_account_id=$1 order by valor_cents desc`, [acc])) as { v: number }[]).map((x) => x.v);

  test("pago com juros/multa do Asaas: baixa o saldo e lança os juros", async () => {
    const c = await cenario(10000, "BOLETO", false);
    await oficial(`update public.asaas_charges set external_status='RECEIVED', received_cents=10300, payment_date=$2,
                   raw='{"interestValue": 3.00, "originalValue": 100.00}'::jsonb where id=$1 returning id`, [c.ch, DIA]);
    const r = await rpcServico<{ baixa: boolean; juros_cents: number }>("asaas_baixa_automatica", { _charge: c.ch });
    expect(r.erro).toBeNull();
    expect(r.dados.baixa).toBe(true);
    expect(r.dados.juros_cents).toBe(300);
    expect(await saldo(c.inst)).toBe(0);
    const j = await um<{ v: number }>(`select coalesce(sum(valor_cents),0)::int v from public.financial_adjustments where installment_id=$1 and kind='juros'`, [c.inst]);
    expect(j.v).toBe(300);
  });

  test("pago a mais sem explicação continua na revisão", async () => {
    const c = await cenario(10000, "BOLETO", false);
    await oficial(`update public.asaas_charges set external_status='RECEIVED', received_cents=10600, payment_date=$2 where id=$1 returning id`, [c.ch, DIA]);
    const r = await rpcServico<{ baixa: boolean; motivo: string }>("asaas_baixa_automatica", { _charge: c.ch });
    expect(r.dados.baixa).toBe(false);
    expect(r.dados.motivo).toBe("valor_pago_maior_que_saldo");
    expect(await saldo(c.inst)).toBe(10000);
  });

  test("cartão com conta 'Cartão a receber': baixa na data do pagamento, crédito vira transferência uma vez só", async () => {
    const c = await cenario(10000, "CREDIT_CARD", true);
    await oficial(`update public.asaas_charges set external_status='CONFIRMED', received_cents=10000, net_value_cents=9500, payment_date=$2 where id=$1 returning id`, [c.ch, DIA]);
    const r1 = await rpcServico<{ baixa: boolean; conta: string }>("asaas_baixa_automatica", { _charge: c.ch });
    expect(r1.dados.baixa).toBe(true);
    expect(r1.dados.conta).toBe(c.cartao);
    expect(await saldo(c.inst)).toBe(0);
    expect(await razao(c.fin)).toEqual([]);               // nada na conta Asaas antes do crédito
    expect(await razao(c.cartao!)).toEqual([10000, -500]); // bruto e tarifa na conta cartão
    await oficial(`update public.asaas_charges set external_status='RECEIVED', credit_date='2024-03-15' where id=$1 returning id`, [c.ch]);
    const r2 = await rpcServico<{ motivo: string; credito_cartao: { transferido: boolean } }>("asaas_baixa_automatica", { _charge: c.ch });
    expect(r2.dados.motivo).toBe("ja_baixada_pelo_asaas");
    expect(r2.dados.credito_cartao.transferido).toBe(true);
    await rpcServico("asaas_baixa_automatica", { _charge: c.ch }); // repetir não duplica
    expect(await razao(c.fin)).toEqual([9500]);
    expect(await razao(c.cartao!)).toEqual([10000, -500, -9500]);
  });

  test("cartão sem a conta configurada: comportamento anterior (baixa direto na conta Asaas)", async () => {
    const c = await cenario(10000, "CREDIT_CARD", false);
    await oficial(`update public.asaas_charges set external_status='CONFIRMED', received_cents=10000, net_value_cents=9500, payment_date=$2 where id=$1 returning id`, [c.ch, DIA]);
    const r = await rpcServico<{ baixa: boolean }>("asaas_baixa_automatica", { _charge: c.ch });
    expect(r.dados.baixa).toBe(true);
    expect(await razao(c.fin)).toEqual([10000, -500]);
  });
});
