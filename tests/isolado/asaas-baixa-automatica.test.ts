/**
 * Baixa automática do Asaas — banco ISOLADO, dados sintéticos.
 * PAYMENT_RECEIVED de cobrança ligada a parcela => baixa pelo motor oficial,
 * bruto na parcela, tarifa como saída separada, sem duplicar.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, rpcServico, type Conta } from "./base";

let master: Conta, semAcesso: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;
const oficial = async <T>(sql: string, p: unknown[] = []) =>
  (await adm.begin(async (tx) => {
    await tx.unsafe(`select set_config('lardann.asaas_link','on',true)`);
    return (await tx.unsafe(sql, p)) as T[];
  }))[0]!;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const DIA = "2026-09-15";
let plano: string;

async function cenario(valor = 10000, ligar: "direto" | "match" | "nenhum" = "direto") {
  const fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`ISO Asaas ${marca()}`])).id;
  const acc = (await um<{ id: string }>(
    `insert into public.asaas_accounts (label, environment, financial_account_id) values ($1,'sandbox',$2) returning id`, [`ISO ${marca()}`, fin])).id;
  const p = await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO P ${marca()}`]);
  const r = await rpc<string>(master, "fin_title_create", {
    _payload: { direction: "receivable", party_id: p.id, descricao: `ISO ${marca()}`, valor_cents: valor, emissao: DIA, competencia: DIA,
      chart_account_id: plano, parcelas: [{ vencimento: DIA, valor_cents: valor }] } });
  if (!r.ok) throw new Error(r.erro!);
  const inst = (await um<{ id: string }>(`select id from public.financial_installments where title_id=$1`, [r.dados])).id;
  const ext = `pay_${marca()}`;
  const ch = (await oficial<{ id: string }>(
    `insert into public.asaas_charges (account_id, external_id, value_cents, due_date, billing_type, external_status, installment_id, title_id, party_id)
     values ($1,$2,$3,$4,'PIX','PENDING',$5,$6,$7) returning id`, [acc, ext, valor, DIA, ligar === "direto" ? inst : null, ligar === "direto" ? r.dados : null, p.id])).id;
  if (ligar === "match") await adm.unsafe(
    `insert into public.asaas_charge_matches (charge_id, installment_id, title_id, regra, status) values ($1,$2,$3,'numero_fatura','confirmado')`, [ch, inst, r.dados]);
  return { fin, acc, inst, ext, ch };
}
async function evento(acc: string, ext: string, tipo: string, pago: number, tarifa: number) {
  return (await um<{ id: string }>(
    `insert into public.asaas_events (account_id, external_id, event, charge_external_id, event_at, payload)
     values ($1,$2,$3,$4,now(),$5::jsonb) returning id`,
    [acc, `evt_${marca()}`, tipo, ext, JSON.stringify({ valuePaidCents: pago, feeCents: tarifa, netValueCents: pago - tarifa, paymentDate: DIA })])).id;
}
const saldoParcela = async (i: string) => Number((await um<{ s: string }>(`select public.fin_installment_saldo($1) s`, [i])).s);
const razao = async (acc: string) =>
  ((await adm.unsafe(`select valor_cents::int v from public.financial_account_movements where financial_account_id=$1 order by valor_cents desc`, [acc])) as { v: number }[]).map((x) => x.v);

beforeAll(async () => {
  master = await criarConta({ nome: "master-baixa", papeis: ["master"], comParty: true });
  semAcesso = await criarConta({ nome: "cons-baixa", papeis: ["consultora"], comParty: true });
  plano = (await um<{ id: string }>(`insert into public.chart_of_accounts (codigo, nome, natureza) values ($1,$1,'receita') returning id`, [`ISO-R-${marca()}`])).id;
});

describe("baixa automática do Asaas", () => {
  test("pagou R$ 100,00 com tarifa R$ 1,99: parcela quitada, razão +100,00 e −1,99", async () => {
    const c = await cenario();
    const ev = await evento(c.acc, c.ext, "PAYMENT_RECEIVED", 10000, 199);
    const r = await rpcServico<{ baixa_criada: boolean; baixa: { data: string } }>("asaas_evento_processar", { _evento: ev });
    expect(r.erro).toBeNull();
    expect(r.dados.baixa_criada).toBe(true);
    expect(r.dados.baixa.data).toBe(DIA);
    expect(await saldoParcela(c.inst)).toBe(0);
    expect(await razao(c.fin)).toEqual([10000, -199]);
    const st = await um<{ settlement_status: string }>(`select settlement_status from public.financial_installments where id=$1`, [c.inst]);
    expect(st.settlement_status).toBe("liquidado");
    const e = await um<{ status: string; last_error: string | null }>(`select status, last_error from public.asaas_events where id=$1`, [ev]);
    expect(e).toEqual({ status: "processado", last_error: null });
  });

  test("aviso repetido e novo aviso da mesma cobrança não duplicam a baixa", async () => {
    const c = await cenario();
    const ev = await evento(c.acc, c.ext, "PAYMENT_RECEIVED", 10000, 199);
    await rpcServico("asaas_evento_processar", { _evento: ev });
    await rpcServico("asaas_evento_processar", { _evento: ev });
    const ev2 = await evento(c.acc, c.ext, "PAYMENT_RECEIVED", 10000, 199);
    await rpcServico("asaas_evento_processar", { _evento: ev2 });
    const q = await um<{ c: number }>(`select count(*)::int c from public.financial_settlements where idempotency_key=$1`, [`asaas:baixa:${c.acc}:${c.ext}`]);
    expect(q.c).toBe(1);
    expect(await razao(c.fin)).toEqual([10000, -199]);
  });

  test("vínculo pela conferência (sugestão confirmada) também dá baixa", async () => {
    const c = await cenario(5000, "match");
    const ev = await evento(c.acc, c.ext, "PAYMENT_RECEIVED", 5000, 0);
    const r = await rpcServico<{ baixa_criada: boolean }>("asaas_evento_processar", { _evento: ev });
    expect(r.dados.baixa_criada).toBe(true);
    expect(await saldoParcela(c.inst)).toBe(0);
  });

  test("cobrança sem título ligado: não inventa baixa e avisa", async () => {
    const c = await cenario(5000, "nenhum");
    const ev = await evento(c.acc, c.ext, "PAYMENT_RECEIVED", 5000, 0);
    const r = await rpcServico<{ baixa_criada: boolean }>("asaas_evento_processar", { _evento: ev });
    expect(r.dados.baixa_criada).toBe(false);
    expect(await saldoParcela(c.inst)).toBe(5000);
    const e = await um<{ status: string; last_error: string }>(`select status, last_error from public.asaas_events where id=$1`, [ev]);
    expect(e.status).toBe("na_fila");
    expect(e.last_error).toContain("não está ligada");
  });

  test("pago acima do saldo vai para revisão, sem baixa", async () => {
    const c = await cenario(5000);
    const ev = await evento(c.acc, c.ext, "PAYMENT_RECEIVED", 5600, 0);
    const r = await rpcServico<{ baixa_criada: boolean }>("asaas_evento_processar", { _evento: ev });
    expect(r.dados.baixa_criada).toBe(false);
    expect(await saldoParcela(c.inst)).toBe(5000);
  });

  test("recebimento em dinheiro e confirmação de cartão não geram baixa sozinhos", async () => {
    const c = await cenario(5000);
    for (const t of ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED_IN_CASH"]) {
      const ev = await evento(c.acc, c.ext, t, 5000, 0);
      const r = await rpcServico<{ baixa_criada: boolean }>("asaas_evento_processar", { _evento: ev });
      expect(r.dados.baixa_criada).toBe(false);
    }
    expect(await saldoParcela(c.inst)).toBe(5000);
  });

  test("parcela já baixada à mão: não baixa de novo", async () => {
    const c = await cenario(5000);
    const m = await rpc(master, "fin_settlement_create_ajustes", { _payload: {
      direction: "receivable", financial_account_id: c.fin, data: DIA, valor_cents: 5000, idempotency_key: marca(),
      alocacoes: [{ installment_id: c.inst, valor_cents: 5000 }] } });
    expect(m.erro).toBeNull();
    const ev = await evento(c.acc, c.ext, "PAYMENT_RECEIVED", 5000, 0);
    const r = await rpcServico<{ baixa_criada: boolean }>("asaas_evento_processar", { _evento: ev });
    expect(r.dados.baixa_criada).toBe(false);
    expect(await razao(c.fin)).toEqual([5000]);
  });

  test("ninguém de fora chama a baixa automática; o repasse exige permissão", async () => {
    const c = await cenario(5000);
    expect((await rpc(master, "asaas_baixa_automatica", { _charge: c.ch })).ok).toBe(false);
    expect((await rpc(semAcesso, "asaas_baixa_pendentes", { _executar: true })).ok).toBe(false);
    // sem o marcador interno, o motor continua recusando quem não tem permissão
    expect((await rpc(semAcesso, "fin_settlement_create", { _payload: {
      direction: "receivable", financial_account_id: c.fin, valor_cents: 5000, alocacoes: [{ installment_id: c.inst, valor_cents: 5000 }] } })).ok).toBe(false);
  });

  test("repasse de cobranças já pagas e ligadas depois", async () => {
    const c = await cenario(7000);
    await oficial(`update public.asaas_charges set external_status='RECEIVED', received_cents=7000, payment_date=$2 where id=$1`, [c.ch, DIA]);
    const previa = await rpc<{ encontradas: number }>(master, "asaas_baixa_pendentes", { _executar: false });
    expect(previa.erro).toBeNull();
    expect(previa.dados.encontradas).toBeGreaterThanOrEqual(1);
    expect(await saldoParcela(c.inst)).toBe(7000);
    const ex = await rpc<{ baixadas: number }>(master, "asaas_baixa_pendentes", { _executar: true });
    expect(ex.dados.baixadas).toBeGreaterThanOrEqual(1);
    expect(await saldoParcela(c.inst)).toBe(0);
  });
});
