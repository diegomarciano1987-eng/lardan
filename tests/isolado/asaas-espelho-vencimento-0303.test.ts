/**
 * 0303 — Vencimento/valor mudou no Lardan → a MESMA cobrança do Asaas acompanha (caso Thais 2026-027046).
 * Confere no Asaas antes e depois; paga/excluída/vencimento no passado viram exceção; trabalhador antigo não recebe
 * a tarefa; nada lança dinheiro. Banco ISOLADO + simulador do Asaas; nenhuma rede.
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
const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const dia = (mais: number) => {
  const d = new Date(`${hojeSP()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + mais);
  return d.toISOString().slice(0, 10);
};

async function cenario(valor: number, vencimento = dia(5)) {
  const e = await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`ISO Venc ${marca()}`]);
  const a = await um<{ id: string }>(
    `insert into public.asaas_accounts (label, environment, state, owner_entity_id, opening_balance_strategy, external_account_id, is_active, billing_default)
     values ($1,'sandbox','simulada',$2,'ignorar_anteriores',$3,true,true) returning id`, [`ISO Conta ${marca()}`, e.id, `acc_${marca()}`]);
  const p = await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO Cliente ${marca()}`]);
  const conta = await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'conta_corrente') returning id`, [`ISO Banco ${marca()}`]);
  const t = await rpc<string>(master, "fin_title_create", { _payload: {
    direction: "receivable", business_entity_id: e.id, party_id: p.id, descricao: `ISO ${marca()}`,
    valor_cents: valor, emissao: "2026-10-10", origem: "manual", status: "ativo",
    parcelas: [{ vencimento, valor_cents: valor }] } });
  if (!t.ok) throw new Error(t.erro ?? "");
  await rpc(master, "fin_title_approve", { _title: t.dados, _motivo: "ISO" });
  const inst = (await um<{ id: string }>(`select id from public.financial_installments where title_id=$1`, [t.dados])).id;
  const sim = new SimuladorAsaas({ conta: a.id, semente: marca() });
  const it = await prepararIntencao(banco(fin), { installmentId: inst, billingType: "UNDEFINED" });
  const r = await executarIntencao(servico, sim, it.id!, { actor: fin.uid, worker: "w-orig" });
  expect(r.state).toBe("criada");
  return { party: p.id, banco: conta.id, title: t.dados as unknown as string, inst, sim, chargeId: r.charge_id!, ext: r.external_id! };
}
const sync = (sim: TransporteAsaas, worker?: string) =>
  sincronizarSaldos({ servico, transporteCobranca: async () => sim, transporteIntencao: async () => sim, limite: 100, worker });
const editar = (inst: string, venc: string, valor: number, quem: Conta = fin) =>
  rpc(quem, "fin_installment_editar", { _installment: inst, _vencimento: venc, _valor_cents: valor, _motivo: "ISO vencimento lançado errado" });
const cobrancas = (inst: string) =>
  adm.unsafe(`select id, external_id, external_status, value_cents::int value_cents, due_date::text due from public.asaas_charges where installment_id=$1 order by imported_at, updated_at`, [inst]) as Promise<
    { id: string; external_id: string; external_status: string; value_cents: number; due: string }[]>;
const tarefas = (inst: string) =>
  adm.unsafe(`select id, acao, motivo, estado, erro from public.asaas_saldo_sync where installment_id=$1 order by created_at`, [inst]) as Promise<
    { id: string; acao: string; motivo: string; estado: string; erro: string | null }[]>;
const dinheiro = async (inst: string) =>
  (await um<{ s: number }>(`select coalesce(sum(valor_cents),0)::int s from public.financial_allocations where installment_id=$1`, [inst])).s;
const alertas = async (inst: string) =>
  (await um<{ n: number }>(`select count(*)::int n from public.asaas_divergencia_alertas where installment_id=$1`, [inst])).n;

beforeAll(async () => {
  fin = await criarConta({ nome: "fin-venc", papeis: ["financeiro"], comParty: true });
  master = await criarConta({ nome: "master-venc", papeis: ["master"], comParty: true });
  consultora = await criarConta({ nome: "cons-venc", papeis: ["consultora"], comParty: true });
});

describe("0303 vencimento/valor do Lardan → mesma cobrança no Asaas", () => {
  test("caso Thais: vencimento mudado no Lardan muda a MESMA cobrança no Asaas, sem cobrança nova nem dinheiro", async () => {
    const c = await cenario(8018, dia(0));
    const criadas = c.sim.chamadasCriar;
    expect((await editar(c.inst, dia(8), 8018)).erro).toBeNull();
    const r = await sync(c.sim);
    expect(r.resultados.map((x) => x.estado)).toEqual(["concluida"]);
    const cs = await cobrancas(c.inst);
    expect(cs.map((x) => [x.external_id, x.external_status, x.value_cents, x.due])).toEqual([[c.ext, "PENDING", 8018, dia(8)]]);
    expect((await c.sim.consultarCobranca(c.ext))!.dueDate).toBe(dia(8));
    expect(c.sim.chamadasCriar).toBe(criadas);
    expect(c.sim.chamadasAtualizar).toBe(1);
    const [t] = await tarefas(c.inst);
    expect([t!.acao, t!.motivo, t!.estado]).toEqual(["alterar", "vencimento_alterado", "concluida"]);
    expect(await dinheiro(c.inst)).toBe(0);
    expect(await alertas(c.inst)).toBe(0); // a troca é nossa: não é "alterada no Asaas"
    const pe = await um<{ resultado: string; atendido: boolean }>(`select resultado, atendido_em is not null atendido from public.asaas_espelho_pedidos where installment_id=$1`, [c.inst]);
    expect([pe.resultado, pe.atendido]).toEqual(["concluida", true]);
  });

  test("rodar de novo não chama o Asaas outra vez", async () => {
    const c = await cenario(12000);
    await editar(c.inst, dia(9), 12000);
    await sync(c.sim);
    await sync(c.sim);
    await sync(c.sim);
    expect(c.sim.chamadasAtualizar).toBe(1);
    expect((await tarefas(c.inst)).length).toBe(1);
  });

  test("valor da parcela aumentado no Lardan (antes recusado com cobrança aberta) sobe na mesma cobrança", async () => {
    const c = await cenario(11018);
    expect((await editar(c.inst, dia(5), 15000)).erro).toBeNull();
    await sync(c.sim);
    expect((await cobrancas(c.inst)).map((x) => [x.external_id, x.external_status, x.value_cents])).toEqual([[c.ext, "PENDING", 15000]]);
    expect((await tarefas(c.inst))[0]!.motivo).toBe("valor_alterado");
  });

  test("valor diminuído no Lardan: a mesma cobrança desce (não cancela nem cria outra)", async () => {
    const c = await cenario(20000);
    const criadas = c.sim.chamadasCriar;
    expect((await editar(c.inst, dia(5), 15000)).erro).toBeNull();
    await sync(c.sim);
    expect((await cobrancas(c.inst)).map((x) => [x.external_id, x.external_status, x.value_cents])).toEqual([[c.ext, "PENDING", 15000]]);
    expect(c.sim.chamadasCriar).toBe(criadas);
  });

  test("vencimento no passado: o Asaas não aceita → exceção para decidir, nada muda lá", async () => {
    const c = await cenario(9000);
    await editar(c.inst, dia(-3), 9000);
    await sync(c.sim);
    const [t] = await tarefas(c.inst);
    expect([t!.estado, t!.motivo]).toEqual(["excecao", "vencimento_no_passado"]);
    expect(c.sim.chamadasAtualizar).toBe(0);
    expect((await c.sim.consultarCobranca(c.ext))!.dueDate).toBe(dia(5));
  });

  test("cliente pagou no Asaas antes da alteração: não mexe, vira exceção", async () => {
    const c = await cenario(30000);
    c.sim.registrarRecebimento(c.ext, { pagoCents: 30000, tarifaCents: 199, data: hojeSP() });
    await editar(c.inst, dia(10), 30000);
    await sync(c.sim);
    const [t] = await tarefas(c.inst);
    expect([t!.estado, t!.motivo]).toEqual(["excecao", "pago_no_asaas"]);
    expect(c.sim.chamadasAtualizar).toBe(0);
    expect((await c.sim.consultarCobranca(c.ext))!.status).toBe("RECEIVED");
  });

  test("excluída direto no Asaas antes da alteração: exceção e alerta de cobrança excluída", async () => {
    const c = await cenario(25000);
    await c.sim.cancelarCobranca!(c.ext);
    await editar(c.inst, dia(10), 25000);
    await sync(c.sim);
    const [t] = await tarefas(c.inst);
    expect([t!.estado, t!.motivo]).toEqual(["excecao", "excluida_no_asaas"]);
    expect((await cobrancas(c.inst))[0]!.external_status).toBe("DELETED");
    expect(await alertas(c.inst)).toBe(1);
  });

  test("trabalhador antigo (antes de publicar) não recebe a alteração: ela espera o novo, sem cancelar nada", async () => {
    const c = await cenario(14100);
    await editar(c.inst, dia(12), 14100);
    const velho = await sync(c.sim, "saldo-velho1");
    expect(velho.resultados.length).toBe(0);
    expect((await c.sim.consultarCobranca(c.ext))!.status).toBe("PENDING");
    expect((await tarefas(c.inst)).map((t) => [t.acao, t.estado])).toEqual([["alterar", "pendente"]]);
    // a reserva antiga nem consegue registrar cancelamento numa alteração
    const [t] = await tarefas(c.inst);
    await adm.unsafe(`update public.asaas_saldo_sync set estado='processando', worker='saldo-velho1' where id=$1`, [t!.id]);
    expect((await rpcServico("asaas_saldo_cancelamento", { _job: t!.id, _worker: "saldo-velho1", _charge: c.chargeId, _resultado: "cancelada", _status_remoto: "PENDING", _erro: null })).ok).toBe(false);
    await adm.unsafe(`update public.asaas_saldo_sync set estado='pendente', worker=null where id=$1`, [t!.id]);
    await sync(c.sim);
    expect((await cobrancas(c.inst)).map((x) => [x.external_id, x.due])).toEqual([[c.ext, dia(12)]]);
  });

  test("baixa parcial depois do vencimento mudado: a cobrança nova do saldo nasce com o vencimento do Lardan", async () => {
    const c = await cenario(70777);
    await sync(c.sim);
    await editar(c.inst, dia(15), 70777);
    await sync(c.sim);
    const r = await rpc<{ id: string }>(master, "fin_settlement_create_ajustes", { _payload: {
      direction: "receivable", financial_account_id: c.banco, data: hojeSP(), valor_cents: 49135, idempotency_key: `iso-venc-${marca()}`,
      alocacoes: [{ installment_id: c.inst, valor_cents: 49135 }] } });
    expect(r.erro).toBeNull();
    await sync(c.sim);
    const abertas = (await cobrancas(c.inst)).filter((x) => x.external_status === "PENDING");
    expect(abertas.map((x) => [x.value_cents, x.due])).toEqual([[21642, dia(15)]]);
  });

  test("lista de diferenças avisa e o botão 'Levar ao Asaas' só para o financeiro", async () => {
    const c = await cenario(10000, dia(20));
    // diferença criada fora do Lardan (ex.: data mudada direto no Asaas e espelhada na cópia local)
    await adm.begin(async (tx) => {
      await tx.unsafe(`select set_config('lardann.asaas_link','on',true)`);
      await tx.unsafe(`update public.asaas_charges set due_date=$2 where id=$1`, [c.chargeId, dia(25)]);
    });
    const l = await rpc<{ installment_id: string; vencimento_diferente: boolean; pode_levar: boolean }[]>(fin, "asaas_espelho_diferencas", { _limite: 500 });
    expect(l.erro).toBeNull();
    const minha = l.dados.find((x) => x.installment_id === c.inst)!;
    expect([minha.vencimento_diferente, minha.pode_levar]).toEqual([true, true]);
    expect((await rpc(consultora, "asaas_espelho_diferencas", {})).ok).toBe(false);
    expect((await rpc(consultora, "asaas_espelho_pedir", { _inst: c.inst, _motivo: "tentativa indevida" })).ok).toBe(false);
    expect((await rpc(fin, "asaas_espelho_pedir", { _inst: c.inst, _motivo: "x" })).ok).toBe(false);
    expect((await rpc(fin, "asaas_espelho_pedir", { _inst: c.inst, _motivo: "Asaas igual ao Lardan" })).erro).toBeNull();
    // o "Asaas" simulado também estava com a data diferente
    await c.sim.atualizarCobranca(c.ext, { valueCents: 10000, dueDate: dia(25), billingType: "UNDEFINED" });
    await sync(c.sim);
    expect((await c.sim.consultarCobranca(c.ext))!.dueDate).toBe(dia(20));
    const depois = await rpc<{ installment_id: string }[]>(fin, "asaas_espelho_diferencas", { _limite: 500 });
    expect(depois.dados.some((x) => x.installment_id === c.inst)).toBe(false);
  });

  test("rotinas internas fechadas para o navegador", async () => {
    for (const f of [["asaas_saldo_alteracao", { _job: crypto.randomUUID(), _worker: "x", _resultado: "alterada", _status_remoto: null, _erro: null }]] as const) {
      expect((await rpc(fin, f[0], f[1])).ok).toBe(false);
    }
  });
});
