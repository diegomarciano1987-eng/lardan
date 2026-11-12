/**
 * 0301/0302 — cancelar no Asaas pela ficha do título; reemissão pelo saldo depois de exclusão direta no Asaas;
 * CRM "Concluídos" (candidata com maleta sai do funil); cockpit com atalho para o título do pagamento.
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

let fin: Conta, master: Conta, cobr: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const oficial = async (sql: string, p: unknown[] = []) =>
  adm.begin(async (tx) => { await tx.unsafe(`select set_config('lardann.asaas_link','on',true)`); return tx.unsafe(sql, p); });

async function cenario(valor: number) {
  const e = await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`ISO Canc ${marca()}`]);
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
  const it = await prepararIntencao(banco(fin), { installmentId: inst, billingType: "BOLETO" });
  const r = await executarIntencao(servico, sim, it.id!, { actor: fin.uid, worker: "w-orig" });
  expect(r.state).toBe("criada");
  return { party: p.id, banco: conta.id, title: t.dados as unknown as string, inst, sim, chargeId: r.charge_id!, ext: r.external_id!, intent: it.id! };
}
const sync = (sim: TransporteAsaas) => sincronizarSaldos({ servico, transporteCobranca: async () => sim, transporteIntencao: async () => sim, limite: 100 });
async function baixar(c: { banco: string; inst: string }, valor: number) {
  const r = await rpc<{ id: string }>(master, "fin_settlement_create_ajustes", { _payload: {
    direction: "receivable", financial_account_id: c.banco, data: "2026-11-12", valor_cents: valor, idempotency_key: `iso-canc-${marca()}`,
    alocacoes: [{ installment_id: c.inst, valor_cents: valor }] } });
  if (!r.ok) throw new Error(r.erro ?? "");
  return r.dados.id;
}
const cobrancas = (inst: string) =>
  adm.unsafe(`select id, external_id, external_status, value_cents::int value_cents from public.asaas_charges where installment_id=$1 order by imported_at, updated_at`, [inst]) as Promise<
    { id: string; external_id: string; external_status: string; value_cents: number }[]>;

beforeAll(async () => {
  fin = await criarConta({ nome: "fin-canc", papeis: ["financeiro"], comParty: true });
  master = await criarConta({ nome: "master-canc", papeis: ["master"], comParty: true });
  cobr = await criarConta({ nome: "cons-canc", papeis: ["consultora"], comParty: true });
});

describe("0301 cancelar cobrança no Asaas (vencimento errado)", () => {
  test("cancelada: cobrança vira DELETED, intenção fechada, dívida continua aberta e dá para gerar outra", async () => {
    const c = await cenario(36094);
    const prep = await rpcServico<{ external_id: string }>("asaas_cobranca_cancelar_preparar", { _charge: c.chargeId, _actor: fin.uid });
    expect(prep.erro).toBeNull();
    expect(prep.dados.external_id).toBe(c.ext);
    const reg = await rpcServico("asaas_cobranca_cancelar_registrar", {
      _charge: c.chargeId, _actor: fin.uid, _motivo: "vencimento lançado errado", _resultado: "cancelada", _status_remoto: "PENDING", _erro: null });
    expect(reg.erro).toBeNull();
    expect((await cobrancas(c.inst)).map((x) => x.external_status)).toEqual(["DELETED"]);
    expect((await um<{ state: string }>(`select state from public.asaas_charge_intents where id=$1`, [c.intent])).state).toBe("cancelada");
    expect((await um<{ s: number }>(`select public.fin_installment_saldo($1)::int s`, [c.inst])).s).toBe(36094);
    expect((await um<{ n: number }>(`select count(*)::int n from public.asaas_divergencia_alertas where installment_id=$1`, [c.inst])).n).toBe(0);
    // gerar a nova cobrança com a data certa não esbarra em intenção "viva"
    const nova = await prepararIntencao(banco(fin), { installmentId: c.inst, billingType: "PIX" });
    expect(nova.id).toBeTruthy();
    expect(nova.id).not.toBe(c.intent);
  });

  test("paga no Asaas: nada é cancelado e a cobrança segue como estava", async () => {
    const c = await cenario(20000);
    await rpcServico("asaas_cobranca_cancelar_registrar", {
      _charge: c.chargeId, _actor: fin.uid, _motivo: "vencimento lançado errado", _resultado: "paga_no_asaas", _status_remoto: "RECEIVED", _erro: null });
    expect((await cobrancas(c.inst)).map((x) => x.external_status)).toEqual(["PENDING"]);
    expect((await um<{ state: string }>(`select state from public.asaas_charge_intents where id=$1`, [c.intent])).state).toBe("criada");
  });

  test("sem acesso ao financeiro, cobrança já recebida e motivo curto são recusados", async () => {
    const c = await cenario(15000);
    expect((await rpcServico("asaas_cobranca_cancelar_preparar", { _charge: c.chargeId, _actor: cobr.uid })).ok).toBe(false);
    expect((await rpcServico("asaas_cobranca_cancelar_registrar", {
      _charge: c.chargeId, _actor: fin.uid, _motivo: "x", _resultado: "cancelada", _status_remoto: null, _erro: null })).ok).toBe(false);
    await oficial(`update public.asaas_charges set external_status='RECEIVED' where id=$1`, [c.chargeId]);
    const r = await rpcServico("asaas_cobranca_cancelar_preparar", { _charge: c.chargeId, _actor: fin.uid });
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("aguardando pagamento ou vencida");
    // navegador não chama as rotinas de serviço
    expect((await rpc(fin, "asaas_cobranca_cancelar_registrar", {
      _charge: c.chargeId, _actor: fin.uid, _motivo: "vencimento errado", _resultado: "cancelada", _status_remoto: null, _erro: null })).ok).toBe(false);
  });
});

describe("0302 cobrança do saldo excluída direto no Asaas (caso Simone)", () => {
  test("reemite o saldo de R$ 60,94 em vez de travar com intenção viva", async () => {
    const c = await cenario(36094);
    await baixar(c, 30000);
    await sync(c.sim);
    let cs = await cobrancas(c.inst);
    expect(cs.map((x) => [x.external_status, x.value_cents])).toEqual([["DELETED", 36094], ["PENDING", 6094]]);
    // alguém exclui a cobrança de R$ 60,94 direto no Asaas
    await c.sim.cancelarCobranca!(cs[1]!.external_id);
    await oficial(`update public.asaas_charges set external_status='DELETED' where id=$1`, [cs[1]!.id]);
    await sync(c.sim);
    cs = await cobrancas(c.inst);
    expect(cs.map((x) => [x.external_status, x.value_cents])).toEqual([["DELETED", 36094], ["DELETED", 6094], ["PENDING", 6094]]);
    const ts = (await adm.unsafe(`select acao, estado, motivo from public.asaas_saldo_sync where installment_id=$1 order by created_at`, [c.inst])) as { acao: string; estado: string }[];
    expect(ts.map((t) => [t.acao, t.estado])).toEqual([["substituir", "concluida"], ["reabrir", "concluida"]]);
  });
});

describe("0301 CRM: quem já tem maleta vai para Concluídos", () => {
  test("lead com maleta só aparece em Concluídos; maleta cancelada não conta", async () => {
    const etapa = (await um<{ id: string }>(`select id from public.candidatura_stages order by sort_order limit 1`)).id;
    const pCom = await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO Com ${marca()}`]);
    const pCanc = await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO Canc ${marca()}`]);
    for (const [party, status] of [[pCom.id, "operacao"], [pCanc.id, "cancelada"]] as const) {
      const kit = await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [`ISO CRM ${marca()}`]);
      await adm.unsafe(`insert into public.kit_cycles (kit_id, cycle_no, status, consultora_party_id) values ($1,1,$2::kit_status,$3)`, [kit.id, status, party]);
    }
    const nome = `ISO CRM ${marca()}`;
    const mk = async (sufixo: string, party: string) => (await um<{ id: string }>(
      `insert into public.leads (full_name, whatsapp, city, uf, privacy_version, stage_id, party_id) values ($1,'43999990000','Ibaiti','PR','v1',$2,$3) returning id`,
      [`${nome} ${sufixo}`, etapa, party])).id;
    const comMaleta = await mk("com", pCom.id);
    const soCancelada = await mk("cancelada", pCanc.id);
    const funil = await rpc<{ itens: { id: string }[] }>(master, "crm_list", { _f: { q: nome }, _limit: 50, _offset: 0 });
    expect(funil.erro).toBeNull();
    expect(funil.dados.itens.map((x) => x.id)).toEqual([soCancelada]);
    const concl = await rpc<{ itens: { id: string; maleta: { situacao: string } | null }[] }>(master, "crm_list", { _f: { q: nome, concluidas: true }, _limit: 50, _offset: 0 });
    expect(concl.dados.itens.map((x) => x.id)).toEqual([comMaleta]);
    expect(concl.dados.itens[0]!.maleta!.situacao).toBe("operacao");
  });
});

describe("0301 cockpit: pagamento leva ao título", () => {
  test("recebimento traz o id do título para abrir a ficha", async () => {
    const c = await cenario(10000);
    await baixar(c, 4000);
    const ck = await rpc<{ recebimentos: { title_id: string; valor_cents: number }[] }>(master, "consultora_cockpit_financeiro", { _party: c.party });
    expect(ck.erro).toBeNull();
    expect(ck.dados.recebimentos.map((r) => [r.title_id, Number(r.valor_cents)])).toEqual([[c.title, 4000]]);
  });
});
