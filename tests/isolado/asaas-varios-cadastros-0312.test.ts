/**
 * 0312 — clientes com vários cadastros no Asaas: mesmo CPF = mesma pessoa. Todos os cadastros ficam ligados, um principal
 * (escolhido sozinho) recebe cobranças novas e reemissões, o espelho do cadastro vai para todos e nenhum boleto é mexido.
 * Banco ISOLADO + simulador do Asaas; nenhuma rede.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, rpcServico, type Conta } from "./base";
import type { BancoAsaas } from "../../src/lib/asaas/banco";
import { SimuladorAsaas } from "../../src/lib/asaas/simulador";
import { executarIntencao, prepararIntencao } from "../../src/lib/asaas/cobranca";
import { sincronizarSaldos } from "../../src/lib/asaas/saldo.server";

const banco = (c: Conta): BancoAsaas => ({
  async rpc<T>(fn: string, a: Record<string, unknown>) {
    const r = await rpc<T>(c, fn, a);
    if (!r.ok) throw new Error(r.erro ?? "falhou");
    return r.dados;
  },
});
const servico: BancoAsaas = {
  async rpc<T>(fn: string, a: Record<string, unknown>) {
    const r = await rpcServico<T>(fn, a);
    if (!r.ok) throw new Error(r.erro ?? "falhou");
    return r.dados;
  },
};

let fin: Conta, master: Conta, consultora: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const oficial = async (sql: string, p: unknown[] = []) =>
  adm.begin(async (tx) => { await tx.unsafe(`select set_config('lardann.asaas_link','on',true)`); return tx.unsafe(sql, p); });
const cpf = () => {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  for (const k of [9, 10]) { const s = d.reduce((a, x, i) => a + x * (k + 1 - i), 0); d.push(((s * 10) % 11) % 10); }
  return d.join("");
};

async function empresaConta() {
  const e = await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`ISO 0312 ${marca()}`]);
  const a = await um<{ id: string }>(
    `insert into public.asaas_accounts (label, environment, state, owner_entity_id, opening_balance_strategy, external_account_id, is_active, billing_default)
     values ($1,'sandbox','simulada',$2,'ignorar_anteriores',$3,true,true) returning id`, [`ISO Conta ${marca()}`, e.id, `acc_${marca()}`]);
  return { empresa: e.id, conta: a.id };
}
async function pessoa(doc: string) {
  return (await um<{ id: string }>(
    `insert into public.parties (kind, display_name, legal_name, status, doc, doc_digits) values ('pessoa',$1,$1,'ativo',$2,$2) returning id`,
    [`ISO Cliente ${marca()}`, doc])).id;
}
async function titulo(empresa: string, party: string, valor: number) {
  const t = await rpc<string>(master, "fin_title_create", { _payload: {
    direction: "receivable", business_entity_id: empresa, party_id: party, descricao: `ISO ${marca()}`,
    valor_cents: valor, emissao: "2026-10-10", origem: "manual", status: "ativo",
    parcelas: [{ vencimento: "2026-11-10", valor_cents: valor }] } });
  if (!t.ok) throw new Error(t.erro ?? "");
  await rpc(master, "fin_title_approve", { _title: t.dados, _motivo: "ISO" });
  return (await um<{ id: string }>(`select id from public.financial_installments where title_id=$1`, [t.dados])).id;
}
/** cadastro Asaas já existente (como o criado fora do Lardan): no simulador e no espelho local */
async function cadastroAsaas(sim: SimuladorAsaas, conta: string, doc: string, status: string, party: string | null, criado: string) {
  const c = sim.semearCliente({ name: "ISO", cpfCnpj: doc, email: null, dateCreated: criado });
  await oficial(
    `insert into public.asaas_customers (account_id, external_id, name, doc, party_id, match_status, raw) values ($1,$2,'ISO',$3,$4,$5,$6::jsonb)`,
    [conta, c.id, doc, party, status, JSON.stringify({ id: c.id, dateCreated: criado })]);
  return c.id;
}
async function boletoAberto(conta: string, cus: string, party: string) {
  await oficial(
    `insert into public.asaas_charges (account_id, external_id, customer_external_id, value_cents, due_date, billing_type, external_status, party_id, raw)
     values ($1,$2,$3,1000,'2026-12-10','BOLETO','PENDING',$4,'{}'::jsonb)`, [conta, `pay_${marca()}`, cus, party]);
}
const cadastros = (party: string) =>
  adm.unsafe(`select external_id, match_status, principal from public.asaas_customers where party_id=$1 order by external_id`, [party]) as Promise<
    { external_id: string; match_status: string; principal: boolean }[]>;

beforeAll(async () => {
  fin = await criarConta({ nome: "fin-0312", papeis: ["financeiro"], comParty: true });
  master = await criarConta({ nome: "master-0312", papeis: ["master"], comParty: true });
  consultora = await criarConta({ nome: "cons-0312", papeis: ["consultora"], comParty: true });
});

describe("0312 vários cadastros no Asaas", () => {
  test("prévia não muda nada; aplicar liga todos, escolhe 1 principal (mais recente com boleto aberto) e espelha em todos", async () => {
    const { conta } = await empresaConta();
    const doc = cpf();
    const p = await pessoa(doc);
    const sim = new SimuladorAsaas({ conta, semente: marca() });
    const velho = await cadastroAsaas(sim, conta, doc, "pendente", p, "2026-09-01");
    const meio = await cadastroAsaas(sim, conta, doc, "pendente", p, "2026-10-05");
    const novo = await cadastroAsaas(sim, conta, doc, "pendente", p, "2026-10-20"); // sem boleto em aberto
    await boletoAberto(conta, velho, p);
    await boletoAberto(conta, meio, p);
    const boletos = await adm.unsafe(`select external_id, external_status from public.asaas_charges where party_id=$1 order by 1`, [p]);

    const previa = await rpc<{ aplicado: boolean; pendentes_elegiveis: number }>(fin, "asaas_duplicados_ligar", { _aplicar: false, _party: p });
    expect(previa.erro).toBeNull();
    expect(previa.dados.aplicado).toBe(false);
    expect(previa.dados.pendentes_elegiveis).toBe(3);
    expect((await cadastros(p)).every((c) => c.match_status === "pendente" && !c.principal)).toBe(true);

    // financeiro sem Master não aplica; consultora nem vê
    expect((await rpc(fin, "asaas_duplicados_ligar", { _aplicar: true, _party: p })).ok).toBe(false);
    expect((await rpc(consultora, "asaas_duplicados_ligar", { _aplicar: false, _party: p })).ok).toBe(false);

    const ap = await rpc<{ ligados: number; principais_escolhidos: number }>(master, "asaas_duplicados_ligar", { _aplicar: true, _party: p });
    expect(ap.erro).toBeNull();
    expect(ap.dados.ligados).toBe(3);
    expect(ap.dados.principais_escolhidos).toBe(1);
    const cs = await cadastros(p);
    expect(cs.every((c) => c.match_status === "vinculado")).toBe(true);
    expect(cs.filter((c) => c.principal).map((c) => c.external_id)).toEqual([meio]);
    // espelho do cadastro (Lardan manda) pedido para os 3 cadastros
    const fila = await um<{ n: number }>(`select count(*)::int n from public.asaas_cliente_espelho where party_id=$1 and estado='pendente'`, [p]);
    expect(fila.n).toBe(3);
    // nenhum boleto mexido
    expect(await adm.unsafe(`select external_id, external_status from public.asaas_charges where party_id=$1 order by 1`, [p])).toEqual(boletos);
    // auditoria da escolha
    const log = await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='asaas.cliente.principal_escolhido' and entity_id=$1`, [p]);
    expect(log.n).toBe(1);
    // reaplicar não muda nada
    const de_novo = await rpc<{ ligados: number; principais_escolhidos: number }>(master, "asaas_duplicados_ligar", { _aplicar: true, _party: p });
    expect(de_novo.dados.ligados).toBe(0);
    expect(de_novo.dados.principais_escolhidos).toBe(0);
    expect(novo).toBeTruthy();
  });

  test("cobrança nova sai no principal, sem criar cliente; trocar principal exige motivo e muda o destino", async () => {
    const { empresa, conta } = await empresaConta();
    const doc = cpf();
    const p = await pessoa(doc);
    const sim = new SimuladorAsaas({ conta, semente: marca() });
    const a = await cadastroAsaas(sim, conta, doc, "vinculado", p, "2026-09-01");
    const b = await cadastroAsaas(sim, conta, doc, "vinculado", p, "2026-10-01");
    const antes = sim.chamadasCriarCliente;

    const i1 = await titulo(empresa, p, 5000);
    const it1 = await prepararIntencao(banco(fin), { installmentId: i1, billingType: "BOLETO" });
    const r1 = await executarIntencao(servico, sim, it1.id!, { actor: fin.uid, worker: "w-0312a" });
    expect(r1.state).toBe("criada");
    const principal1 = (await cadastros(p)).find((c) => c.principal)!.external_id;
    expect(principal1).toBe(b); // nenhum com boleto aberto: o criado por último
    expect((await sim.consultarCobranca(r1.external_id!))!.customer).toBe(b);
    expect(sim.chamadasCriarCliente).toBe(antes);

    const custA = await um<{ id: string }>(`select id from public.asaas_customers where external_id=$1`, [a]);
    expect((await rpc(fin, "asaas_cliente_principal_trocar", { _customer: custA.id, _motivo: "" })).ok).toBe(false);
    expect((await rpc(consultora, "asaas_cliente_principal_trocar", { _customer: custA.id, _motivo: "teste de troca" })).ok).toBe(false);
    const tr = await rpc<{ de: string; para: string }>(fin, "asaas_cliente_principal_trocar", { _customer: custA.id, _motivo: "cliente pediu este cadastro" });
    expect(tr.erro).toBeNull();
    expect(tr.dados).toMatchObject({ de: b, para: a });
    const log = await um<{ payload: { motivo: string } }>(`select payload from public.audit_logs where action='asaas.cliente.principal_trocado' and entity_id=$1`, [p]);
    expect(log.payload.motivo).toBe("cliente pediu este cadastro");

    const i2 = await titulo(empresa, p, 7000);
    const it2 = await prepararIntencao(banco(fin), { installmentId: i2, billingType: "BOLETO" });
    const r2 = await executarIntencao(servico, sim, it2.id!, { actor: fin.uid, worker: "w-0312b" });
    expect(r2.state).toBe("criada");
    expect((await sim.consultarCobranca(r2.external_id!))!.customer).toBe(a);
    expect((await cadastros(p)).filter((c) => c.principal).length).toBe(1);
  });

  test("baixa parcial com dois cadastros: reemite o saldo no principal (sem exceção 'dois cadastros')", async () => {
    const { empresa, conta } = await empresaConta();
    const doc = cpf();
    const p = await pessoa(doc);
    const sim = new SimuladorAsaas({ conta, semente: marca() });
    const inst = await titulo(empresa, p, 30000);
    const it = await prepararIntencao(banco(fin), { installmentId: inst, billingType: "BOLETO" });
    const r = await executarIntencao(servico, sim, it.id!, { actor: fin.uid, worker: "w-0312c" });
    expect(r.state).toBe("criada");
    const primeiro = (await cadastros(p))[0]!.external_id;
    // aparece um segundo cadastro do mesmo CPF (criado fora do Lardan) e a rotina liga sozinha
    const outro = await cadastroAsaas(sim, conta, doc, "pendente", null, "2026-11-01");
    await oficial(`update public.asaas_customers set doc = null where party_id is null and external_id <> $1`, [outro]);
    expect((await rpc(master, "asaas_clientes_cadastrar", { _actor: master.uid })).erro).toBeNull();
    const cs = await cadastros(p);
    expect(cs.length).toBe(2);
    expect(cs.every((c) => c.match_status === "vinculado")).toBe(true);
    expect(cs.filter((c) => c.principal).map((c) => c.external_id)).toEqual([primeiro]); // o que tem boleto aberto

    const banc = await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'conta_corrente') returning id`, [`ISO Banco ${marca()}`]);
    const b = await rpc(master, "fin_settlement_create_ajustes", { _payload: {
      direction: "receivable", financial_account_id: banc.id, data: "2026-11-12", valor_cents: 10000, idempotency_key: `iso-0312-${marca()}`,
      alocacoes: [{ installment_id: inst, valor_cents: 10000 }] } });
    expect(b.erro).toBeNull();
    const deps = { servico, transporteCobranca: async () => sim, transporteIntencao: async () => sim, limite: 100 };
    await sincronizarSaldos(deps);
    await sincronizarSaldos(deps);
    const abertas = (await adm.unsafe(
      `select external_id, value_cents::int v, customer_external_id cus from public.asaas_charges where installment_id=$1 and external_status in ('PENDING','OVERDUE')`, [inst])) as
      { external_id: string; v: number; cus: string }[];
    expect(abertas.length).toBe(1);
    expect(abertas[0]!.v).toBe(20000);
    expect(abertas[0]!.cus).toBe(primeiro);
    const exc = await um<{ n: number }>(`select count(*)::int n from public.asaas_saldo_sync where installment_id=$1 and motivo='cliente_duplicado'`, [inst]);
    expect(exc.n).toBe(0);
  });

  test("pessoa sem vínculo no Lardan, mas com cadastro no Asaas pelo CPF: aproveita, não cria outro", async () => {
    const { empresa, conta } = await empresaConta();
    const doc = cpf();
    const p = await pessoa(doc);
    const sim = new SimuladorAsaas({ conta, semente: marca() });
    const existente = sim.semearCliente({ name: "ISO fora do Lardan", cpfCnpj: doc, email: null, dateCreated: "2026-10-01" });
    const antes = sim.chamadasCriarCliente;
    const inst = await titulo(empresa, p, 4000);
    const it = await prepararIntencao(banco(fin), { installmentId: inst, billingType: "PIX" });
    const r = await executarIntencao(servico, sim, it.id!, { actor: fin.uid, worker: "w-0312d" });
    expect(r.state).toBe("criada");
    expect(sim.chamadasCriarCliente).toBe(antes);
    expect((await sim.consultarCobranca(r.external_id!))!.customer).toBe(existente.id);
    expect((await cadastros(p)).map((c) => [c.external_id, c.match_status])).toEqual([[existente.id, "vinculado"]]);
  });

  test("quadro 'vários cadastros' abre para o financeiro e não para a consultora", async () => {
    const ok = await rpc<unknown[]>(fin, "asaas_clientes_varios_cadastros", {});
    expect(ok.erro).toBeNull();
    expect(Array.isArray(ok.dados)).toBe(true);
    expect((await rpc(consultora, "asaas_clientes_varios_cadastros", {})).ok).toBe(false);
  });
});
