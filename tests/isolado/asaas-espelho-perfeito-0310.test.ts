/**
 * 0309 — espelho sem furo: (1) a equipe do financeiro lê as tabelas do Asaas (antes "permission denied");
 * (2) cliente Asaas ligada pelo CPF deixa de ficar "pendente"; (3) baixa parcial com cliente sem vínculo:
 * o Asaas não continua cobrando o valor antigo (cancela e vira exceção para a equipe gerar a nova pela tela).
 * Banco ISOLADO + simulador do Asaas; nenhuma rede.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, ler, rpc, rpcServico, type Conta } from "./base";
import type { BancoAsaas } from "../../src/lib/asaas/banco";
import { SimuladorAsaas } from "../../src/lib/asaas/simulador";
import type { TransporteAsaas } from "../../src/lib/asaas/contrato";
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
const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/** Isola cada cenário: esvazia a fila das parcelas de outros testes (só tarefas pendentes deste arquivo existem). */
async function cenario(valor: number, billing: "BOLETO" | "PIX" | "UNDEFINED" = "BOLETO") {
  const e = await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`ISO 0309 ${marca()}`]);
  const a = await um<{ id: string }>(
    `insert into public.asaas_accounts (label, environment, state, owner_entity_id, opening_balance_strategy, external_account_id, is_active, billing_default)
     values ($1,'sandbox','simulada',$2,'ignorar_anteriores',$3,true,true) returning id`, [`ISO Conta ${marca()}`, e.id, `acc_${marca()}`]);
  const p = await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO Cliente ${marca()}`]);
  const conta = await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'conta_corrente') returning id`, [`ISO Banco ${marca()}`]);
  const t = await rpc<string>(master, "fin_title_create", { _payload: {
    direction: "receivable", business_entity_id: e.id, party_id: p.id, descricao: `ISO ${marca()}`,
    valor_cents: valor, emissao: "2026-10-10", origem: "manual", status: "ativo",
    parcelas: [{ vencimento: "2026-11-10", valor_cents: valor }] } });
  if (!t.ok) throw new Error(t.erro ?? "");
  await rpc(master, "fin_title_approve", { _title: t.dados, _motivo: "ISO" });
  const inst = (await um<{ id: string }>(`select id from public.financial_installments where title_id=$1`, [t.dados])).id;
  const sim = new SimuladorAsaas({ conta: a.id, semente: marca() });
  // cobrança original criada pelo caminho oficial do botão "Gerar link"
  const it = await prepararIntencao(banco(fin), { installmentId: inst, billingType: billing });
  const r = await executarIntencao(servico, sim, it.id!, { actor: fin.uid, worker: "w-orig" });
  expect(r.state).toBe("criada");
  return { empresa: e.id, conta: a.id, party: p.id, banco: conta.id, title: t.dados as unknown as string, inst, sim, chargeId: r.charge_id!, ext: r.external_id! };
}

const deps = (sim: TransporteAsaas) => ({ servico, transporteCobranca: async () => sim, transporteIntencao: async () => sim, limite: 100 });
const sync = (sim: TransporteAsaas) => sincronizarSaldos(deps(sim));

async function baixar(c: { banco: string; inst: string }, valor: number) {
  const r = await rpc<{ id: string }>(master, "fin_settlement_create_ajustes", { _payload: {
    direction: "receivable", financial_account_id: c.banco, data: "2026-11-12", valor_cents: valor, idempotency_key: `iso-0309-${marca()}`,
    alocacoes: [{ installment_id: c.inst, valor_cents: valor }] } });
  if (!r.ok) throw new Error(r.erro ?? "");
  return r.dados.id;
}
const cobrancas = (inst: string) =>
  adm.unsafe(`select id, external_id, external_status, value_cents::int value_cents, due_date::text due, billing_type from public.asaas_charges where installment_id=$1 order by imported_at, updated_at`, [inst]) as Promise<
    { id: string; external_id: string; external_status: string; value_cents: number; due: string; billing_type: string }[]>;
const tarefas = (inst: string) =>
  adm.unsafe(`select * from public.asaas_saldo_sync where installment_id=$1 order by created_at`, [inst]) as Promise<Record<string, unknown>[]>;
const dinheiro = async (inst: string) =>
  (await um<{ s: number }>(`select coalesce(sum(valor_cents),0)::int s from public.financial_allocations where installment_id=$1`, [inst])).s;

beforeAll(async () => {
  fin = await criarConta({ nome: "fin-0309", papeis: ["financeiro"], comParty: true });
  master = await criarConta({ nome: "master-0309", papeis: ["master"], comParty: true });
  consultora = await criarConta({ nome: "cons-0309", papeis: ["consultora"], comParty: true });
});

describe("0309 espelho Asaas × Lardan", () => {
  test("financeiro lê espelho de saldo, pedidos, cancelamentos e pago por outra forma; consultora não", async () => {
    for (const t of ["asaas_saldo_sync", "asaas_espelho_pedidos", "asaas_baixas_outra_forma", "asaas_cobranca_cancelamentos"]) {
      const r = await ler(t === "asaas_cobranca_cancelamentos" ? master : fin, `select count(*)::int n from public.${t}`);
      expect(r.erro).toBeNull();
    }
    const nega = await ler<{ n: number }>(consultora, `select count(*)::int n from public.asaas_saldo_sync`);
    expect(nega.erro).toBeNull();
    expect(nega.linhas[0]!.n).toBe(0);
  });

  test("baixa parcial com cliente Asaas 'pendente': cancela a antiga e deixa exceção; nada de cobrar o valor cheio", async () => {
    const c = await cenario(31782);
    await adm.unsafe(`update public.asaas_customers set match_status='pendente' where party_id=$1`, [c.party]);
    await baixar(c, 20000);
    await sync(c.sim);
    const cs = await cobrancas(c.inst);
    expect(cs.find((x) => x.external_id === c.ext)!.external_status).toBe("DELETED");
    expect(cs.filter((x) => ["PENDING", "OVERDUE"].includes(x.external_status)).length).toBe(0);
    expect((await c.sim.consultarCobranca(c.ext))!.status).toBe("DELETED");
    await sync(c.sim);
    const ts = await tarefas(c.inst);
    expect(ts.some((t) => t["motivo"] === "baixa_parcial_sem_reemissao" && t["estado"] === "concluida")).toBe(true);
    expect(ts.some((t) => t["estado"] === "excecao" && t["motivo"] === "cliente_sem_vinculo")).toBe(true);
  });

  test("cliente Asaas única ligada pelo CPF vira 'vinculado'; duas da mesma pessoa continuam 'pendente'", async () => {
    const c = await cenario(10000);
    const conta = c.conta;
    const cpf = () => { const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)); for (const n of [9, 10]) { const s = d.reduce((a, x, i) => a + x * (n + 1 - i), 0); d.push(((s * 10) % 11) % 10); } return d.join(""); };
    const cpf1 = cpf(), cpf2 = cpf();
    const p1 = (await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status, doc, doc_digits) values ('pessoa','ISO Um','ISO Um','ativo',$1,$1) returning id`, [cpf1])).id;
    const p2 = (await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status, doc, doc_digits) values ('pessoa','ISO Dois','ISO Dois','ativo',$1,$1) returning id`, [cpf2])).id;
    const ins = (ext: string, doc: string) => oficial(`insert into public.asaas_customers (account_id, external_id, name, doc, match_status) values ($1,$2,'ISO',$3,'pendente')`, [conta, ext, doc]);
    await ins(`cus_a${marca()}`, cpf1);
    await ins(`cus_b${marca()}`, cpf2);
    await ins(`cus_c${marca()}`, cpf2);
    const r = await rpc(master, "asaas_clientes_cadastrar", { _actor: master.uid });
    expect(r.erro).toBeNull();
    const st = async (p: string) => ((await adm.unsafe(`select match_status s from public.asaas_customers where party_id=$1 order by external_id`, [p])) as { s: string }[]).map((x) => x.s);
    expect(await st(p1)).toEqual(["vinculado"]);
    const dois = await st(p2);
    expect(dois.length).toBe(2);
    expect(dois.filter((s) => s === "vinculado").length).toBeLessThanOrEqual(1);
    // vínculo novo entra na fila do espelho como primeira conferência (não apaga contato que o Lardan não conhece)
    const m = await um<{ motivo: string }>(`select e.motivo from public.asaas_cliente_espelho e join public.asaas_customers c on c.id=e.customer_id where c.party_id=$1`, [p1]);
    expect(m.motivo.startsWith("primeira conferência")).toBe(true);
  });
});
