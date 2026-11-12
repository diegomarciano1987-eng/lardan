/**
 * 0299 — Baixa no Lardan espelhada no Asaas: baixa parcial cancela a cobrança antiga e cria outra pelo saldo;
 * quitação/título cancelado só cancela; estorno reabre pelo saldo cheio; paga no Asaas vira exceção; nada lança dinheiro.
 * Banco ISOLADO + simulador do Asaas; nenhuma rede.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, rpcServico, type Conta } from "./base";
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
  const e = await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`ISO Saldo ${marca()}`]);
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
    direction: "receivable", financial_account_id: c.banco, data: "2026-11-12", valor_cents: valor, idempotency_key: `iso-saldo-${marca()}`,
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
  fin = await criarConta({ nome: "fin-saldo", papeis: ["financeiro"], comParty: true });
  master = await criarConta({ nome: "master-saldo", papeis: ["master"], comParty: true });
  consultora = await criarConta({ nome: "cons-saldo", papeis: ["consultora"], comParty: true });
});

describe("0299 baixa no Lardan → Asaas", () => {
  test("baixa parcial (caso Rosemeire): cancela R$ 707,77 e cria R$ 216,42 hoje, mesma forma, sem lançar dinheiro", async () => {
    const c = await cenario(70777, "UNDEFINED");
    await baixar(c, 49135);
    const antesDinheiro = await dinheiro(c.inst);
    const r = await sync(c.sim);
    expect(r.resultados.find((x) => x.estado === "concluida")).toBeTruthy();
    const cs = await cobrancas(c.inst);
    expect(cs.length).toBe(2);
    expect(cs[0]!.external_id).toBe(c.ext);
    expect(cs[0]!.external_status).toBe("DELETED");
    expect(cs[1]!.external_status).toBe("PENDING");
    expect(cs[1]!.value_cents).toBe(21642);
    expect(cs[1]!.due).toBe(hojeSP() > "2026-11-10" ? hojeSP() : "2026-11-10");
    expect(cs[1]!.billing_type).toBe("UNDEFINED");
    // no "Asaas" simulado: antiga excluída, nova aberta pelo saldo
    expect((await c.sim.consultarCobranca(c.ext))!.status).toBe("DELETED");
    expect((await c.sim.consultarCobranca(cs[1]!.external_id))!.valueCents).toBe(21642);
    const [t] = await tarefas(c.inst);
    expect(t!["estado"]).toBe("concluida");
    expect(t!["acao"]).toBe("substituir");
    expect(t!["motivo"]).toBe("baixa_parcial");
    expect(t!["nova_charge_id"]).toBe(cs[1]!.id);
    // nada de dinheiro novo, nenhum alerta de "excluída no Asaas" (a troca é nossa)
    expect(await dinheiro(c.inst)).toBe(antesDinheiro);
    expect((await um<{ n: number }>(`select count(*)::int n from public.asaas_divergencia_alertas where installment_id=$1`, [c.inst])).n).toBe(0);
  });

  test("rodar de novo não faz nada: nenhuma criação nem exclusão a mais", async () => {
    const c = await cenario(50000);
    await baixar(c, 20000);
    await sync(c.sim);
    const criadas = c.sim.chamadasCriar;
    await sync(c.sim);
    await sync(c.sim);
    expect(c.sim.chamadasCriar).toBe(criadas);
    expect((await tarefas(c.inst)).length).toBe(1);
    expect((await cobrancas(c.inst)).filter((x) => x.external_status === "PENDING").map((x) => x.value_cents)).toEqual([30000]);
  });

  test("quitada no Lardan (caso Aparecida/Jenyffer): só cancela no Asaas, sem cobrança nova", async () => {
    const c = await cenario(25000);
    await baixar(c, 25000);
    const criadas = c.sim.chamadasCriar;
    await sync(c.sim);
    const cs = await cobrancas(c.inst);
    expect(cs.map((x) => x.external_status)).toEqual(["DELETED"]);
    expect(c.sim.chamadasCriar).toBe(criadas);
    const [t] = await tarefas(c.inst);
    expect([t!["acao"], t!["motivo"], t!["estado"]]).toEqual(["cancelar", "quitada", "concluida"]);
  });

  test("título cancelado no Lardan (vendas de teste do PDV): cancela a cobrança no Asaas", async () => {
    const c = await cenario(12990);
    const x = await rpc(master, "fin_title_cancel", { _title: c.title, _motivo: "Venda de teste do PDV" });
    expect(x.erro).toBeNull();
    await sync(c.sim);
    expect((await cobrancas(c.inst)).map((x) => x.external_status)).toEqual(["DELETED"]);
    expect((await tarefas(c.inst))[0]!["motivo"]).toBe("titulo_cancelado");
  });

  test("estorno da baixa parcial: cancela a cobrança do saldo e cria outra pelo valor cheio", async () => {
    const c = await cenario(70777);
    const baixa = await baixar(c, 49135);
    await sync(c.sim);
    const e = await rpc(master, "fin_settlement_reverse", { _settlement: baixa, _motivo: "ISO estorno da baixa parcial" });
    expect(e.erro).toBeNull();
    await sync(c.sim);
    const cs = await cobrancas(c.inst);
    expect(cs.map((x) => [x.external_status, x.value_cents])).toEqual([["DELETED", 70777], ["DELETED", 21642], ["PENDING", 70777]]);
    const ts = await tarefas(c.inst);
    expect(ts.map((t) => t["acao"])).toEqual(["substituir", "reabrir"]);
    expect(ts[1]!["motivo"]).toBe("estorno");
  });

  test("cliente pagou no Asaas antes do cancelamento: não exclui, vira exceção e não cria nada", async () => {
    const c = await cenario(30000);
    await baixar(c, 10000);
    c.sim.registrarRecebimento(c.ext, { pagoCents: 30000, tarifaCents: 199, data: "2026-11-12" });
    const criadas = c.sim.chamadasCriar;
    await sync(c.sim);
    expect((await c.sim.consultarCobranca(c.ext))!.status).toBe("RECEIVED");
    expect(c.sim.chamadasCriar).toBe(criadas);
    const [t] = await tarefas(c.inst);
    expect([t!["estado"], t!["motivo"]]).toEqual(["excecao", "pago_no_asaas"]);
  });

  test("falha de rede no cancelamento: tenta de novo depois e reconhece a exclusão já feita", async () => {
    const c = await cenario(40000);
    await baixar(c, 15000);
    const quebrado = Object.create(c.sim) as TransporteAsaas;
    quebrado.cancelarCobranca = async (id: string) => { await c.sim.cancelarCobranca(id); throw new Error("resposta perdida"); };
    await sync(quebrado);
    let [t] = await tarefas(c.inst);
    expect(t!["estado"]).toBe("falhou");
    await adm.unsafe(`update public.asaas_saldo_sync set proxima_em = now() - interval '1 minute' where id=$1`, [t!["id"]]);
    await sync(c.sim);
    [t] = await tarefas(c.inst);
    expect(t!["estado"]).toBe("concluida");
    const cs = await cobrancas(c.inst);
    expect(cs.map((x) => [x.external_status, x.value_cents])).toEqual([["DELETED", 40000], ["PENDING", 25000]]);
    expect((t!["cobrancas"] as { resultado: string }[])[0]!.resultado).toBe("ja_excluida");
  });

  test("saldo abaixo de R$ 5,00: cancela a antiga e não cria nova (cobrar por fora)", async () => {
    const c = await cenario(10000);
    await baixar(c, 9700);
    const criadas = c.sim.chamadasCriar;
    await sync(c.sim);
    expect((await cobrancas(c.inst)).map((x) => x.external_status)).toEqual(["DELETED"]);
    expect(c.sim.chamadasCriar).toBe(criadas);
    expect((await tarefas(c.inst))[0]!["motivo"]).toBe("saldo_abaixo_minimo");
  });

  test("várias cobranças na mesma parcela: exceção; o financeiro decide substituir pelo saldo", async () => {
    const c = await cenario(30000);
    // segunda cobrança importada do Asaas e ligada à mesma parcela (parcelamento feito lá)
    const cli = (await um<{ e: string }>(`select external_id e from public.asaas_customers where account_id=$1 and party_id=$2`, [c.conta, c.party])).e;
    const seg = c.sim.semearCobranca({ customer: cli, valueCents: 15000, dueDate: "2026-12-10", billingType: "PIX", status: "PENDING", description: null, externalReference: null, dateCreated: "2026-11-01" });
    await oficial(`insert into public.asaas_charges (account_id, external_id, customer_external_id, value_cents, due_date, billing_type, external_status, party_id, title_id, installment_id, reconcile_status, raw)
                   values ($1,$2,$3,15000,'2026-12-10','PIX','PENDING',$4,$5,$6,'vinculado','{}'::jsonb)`, [c.conta, seg.id, cli, c.party, c.title, c.inst]);
    await baixar(c, 10000);
    await sync(c.sim);
    const [t] = await tarefas(c.inst);
    expect([t!["estado"], t!["motivo"]]).toEqual(["excecao", "varias_cobrancas"]);
    expect((await cobrancas(c.inst)).filter((x) => x.external_status === "PENDING").length).toBe(2);
    // consultora não decide; financeiro decide com motivo
    expect((await rpc(consultora, "asaas_saldo_decidir", { _job: t!["id"], _decisao: "substituir", _motivo: "tentativa indevida" })).ok).toBe(false);
    expect((await rpc(fin, "asaas_saldo_decidir", { _job: t!["id"], _decisao: "substituir", _motivo: "x" })).ok).toBe(false);
    const d = await rpc(fin, "asaas_saldo_decidir", { _job: t!["id"], _decisao: "substituir", _motivo: "Juntar o saldo numa cobrança só" });
    expect(d.erro).toBeNull();
    await sync(c.sim);
    const abertas = (await cobrancas(c.inst)).filter((x) => x.external_status === "PENDING");
    expect(abertas.map((x) => x.value_cents)).toEqual([20000]);
  });

  test("parcelamento no Asaas com uma parte já paga lá: o resto aberto bate com o saldo e nada muda", async () => {
    const c = await cenario(15000);
    const cli = (await um<{ e: string }>(`select external_id e from public.asaas_customers where account_id=$1 and party_id=$2`, [c.conta, c.party])).e;
    // aumenta a parcela para 30000 com uma segunda cobrança de 15000 já recebida no Asaas e baixada
    const t2 = await rpc<string>(master, "fin_title_create", { _payload: {
      direction: "receivable", business_entity_id: c.empresa, party_id: c.party, descricao: `ISO parc ${marca()}`,
      valor_cents: 30000, emissao: "2026-10-10", origem: "manual", status: "ativo", parcelas: [{ vencimento: "2026-11-10", valor_cents: 30000 }] } });
    await rpc(master, "fin_title_approve", { _title: t2.dados, _motivo: "ISO" });
    const inst = (await um<{ id: string }>(`select id from public.financial_installments where title_id=$1`, [t2.dados])).id;
    const a = c.sim.semearCobranca({ customer: cli, valueCents: 15000, dueDate: "2026-10-10", billingType: "PIX", status: "RECEIVED", description: null, externalReference: null, dateCreated: "2026-10-01" });
    const b = c.sim.semearCobranca({ customer: cli, valueCents: 15000, dueDate: "2026-11-10", billingType: "PIX", status: "PENDING", description: null, externalReference: null, dateCreated: "2026-10-01" });
    for (const [x, st] of [[a, "RECEIVED"], [b, "PENDING"]] as const) {
      await oficial(`insert into public.asaas_charges (account_id, external_id, customer_external_id, value_cents, due_date, billing_type, external_status, party_id, title_id, installment_id, reconcile_status, raw)
                     values ($1,$2,$3,15000,$7,'PIX',$4,$5,$6,$8,'vinculado','{}'::jsonb)`, [c.conta, x.id, cli, st, c.party, t2.dados, x.dueDate, inst]);
    }
    await baixar({ banco: c.banco, inst }, 15000);
    const criadas = c.sim.chamadasCriar;
    await sync(c.sim);
    expect((await tarefas(inst)).length).toBe(0);
    expect(c.sim.chamadasCriar).toBe(criadas);
    expect((await c.sim.consultarCobranca(b.id))!.status).toBe("PENDING");
  });

  test("parcela dentro de acordo: nunca troca sozinha", async () => {
    const c = await cenario(30000);
    await adm.unsafe(`insert into public.cob_simulacoes (party_id, installment_ids, data_base, multa_pct, juros_mes_pct, principal_cents, encargos_cents, total_cents, status)
                      values ($1, array[$2]::uuid[], '2026-11-01', 2, 1, 30000, 0, 30000, 'efetivada')`, [c.party, c.inst]);
    await baixar(c, 10000);
    await sync(c.sim);
    const [t] = await tarefas(c.inst);
    expect([t!["estado"], t!["motivo"]]).toEqual(["excecao", "parcela_em_acordo"]);
    expect((await rpc(fin, "asaas_saldo_decidir", { _job: t!["id"], _decisao: "substituir", _motivo: "Forçar troca no acordo" })).ok).toBe(false);
    expect((await cobrancas(c.inst)).map((x) => x.external_status)).toEqual(["PENDING"]);
  });

  test("sem baixa nada acontece; botão Gerar link continua reaproveitando a cobrança viva", async () => {
    const c = await cenario(20000);
    await sync(c.sim);
    expect((await tarefas(c.inst)).length).toBe(0);
    const de_novo = await prepararIntencao(banco(fin), { installmentId: c.inst, billingType: "BOLETO" });
    expect(de_novo.reaproveitada).toBe(true);
  });

  test("permissões: rotinas internas fechadas; painel só para o financeiro", async () => {
    for (const f of [["asaas_saldo_reservar", { _worker: "x", _limite: 1 }], ["asaas_saldo_varrer", {}], ["asaas_saldo_plano", { _inst: crypto.randomUUID() }],
      ["asaas_cobranca_preparar_nucleo", { _payload: {}, _actor: null, _saldo: true }]] as const) {
      expect((await rpc(fin, f[0], f[1])).ok).toBe(false);
    }
    expect((await rpc(consultora, "asaas_saldo_painel", { _limite: 10 })).ok).toBe(false);
    const p = await rpc<{ resumo: { concluidas: number } }>(fin, "asaas_saldo_painel", { _limite: 10 });
    expect(p.erro).toBeNull();
    expect(p.dados.resumo.concluidas).toBeGreaterThan(0);
    const leitura = await rpc(consultora, "asaas_saldo_painel", {});
    expect(leitura.ok).toBe(false);
  });
});
