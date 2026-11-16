/**
 * 0329 (Diego, 16/11/2026) — link de cartão no parcelamento escolhido pela consultora.
 * Regra: 1x a 3x sem juros; 4x a 12x a cliente paga a taxa do Asaas (3,49% 2–6x, 3,99% 7–12x, + R$ 0,49).
 * Banco ISOLADO e transporte SIMULADO; nada sai para a rede.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, ler, rpc, rpcServico, type Conta } from "./base";
import type { BancoAsaas } from "../../src/lib/asaas/banco";
import { SimuladorAsaas } from "../../src/lib/asaas/simulador";
import { gerarLinkDeCobranca } from "../../src/lib/asaas/cobranca";
import { acrescimoCartaoCents, simularParcelas } from "../../src/lib/cartao-parcelas";

let financeiro: Conta, master: Conta;
let empresa: string, conta: string, party: string, fin: string;
let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const banco = (c: Conta): BancoAsaas => ({ async rpc<T>(fn: string, a: Record<string, unknown>) { const r = await rpc<T>(c, fn, a); if (!r.ok) throw new Error(r.erro ?? "falhou"); return r.dados; } });
const servico: BancoAsaas = { async rpc<T>(fn: string, a: Record<string, unknown>) { const r = await rpcServico<T>(fn, a); if (!r.ok) throw new Error(r.erro ?? "falhou"); return r.dados; } };

async function parcelaAberta(valor: number) {
  const r = await rpc<string>(master, "fin_title_create", { _payload: {
    direction: "receivable", business_entity_id: empresa, party_id: party, descricao: `ISO cartão ${marca()}`, valor_cents: valor,
    emissao: "2026-11-16", origem: "manual", status: "ativo", parcelas: [{ vencimento: "2026-11-16", valor_cents: valor }] } });
  if (!r.ok) throw new Error(r.erro!);
  await rpc(master, "fin_title_approve", { _title: r.dados, _motivo: "ISO" });
  return (await um<{ id: string }>(`select id from public.financial_installments where title_id=$1`, [r.dados])).id;
}
const cobrancas = (inst: string) => adm.unsafe(
  `select id, external_id, value_cents::int v, acrescimo_cartao_cents::int a, installment_number as parcela_numero, installment_external_id as parcelamento_externo from public.asaas_charges where installment_id=$1 order by installment_number nulls first`, [inst]) as Promise<{ id: string; external_id: string; v: number; a: number; parcela_numero: number | null; parcelamento_externo: string | null }[]>;
const saldo = async (inst: string) => Number((await rpcServico<number>("fin_installment_saldo", { _installment: inst })).dados);
const gerar = (sim: SimuladorAsaas, inst: string, parcelas?: number) =>
  gerarLinkDeCobranca(banco(financeiro), servico, sim, { installmentId: inst, billingType: "CREDIT_CARD", ...(parcelas ? { parcelasCartao: parcelas } : {}) }, { actor: financeiro.uid });

beforeAll(async () => {
  financeiro = await criarConta({ nome: "fin-0329", papeis: ["financeiro"], comParty: true });
  master = await criarConta({ nome: "master-0329", papeis: ["master"], comParty: true });
  empresa = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`ISO Emp 0329 ${marca()}`])).id;
  fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`ISO Asaas 0329 ${marca()}`])).id;
  conta = (await um<{ id: string }>(
    `insert into public.asaas_accounts (label, environment, state, owner_entity_id, opening_balance_strategy, external_account_id, financial_account_id)
     values ($1,'sandbox','simulada',$2,'ignorar_anteriores',$3,$4) returning id`, [`ISO 0329 ${marca()}`, empresa, `acc_${marca()}`, fin])).id;
  party = (await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO Cliente 0329 ${marca()}`])).id;
  await adm.unsafe(`insert into public.asaas_customers (account_id, external_id, name, party_id, match_status) values ($1,$2,'ISO',$3,'vinculado')`, [conta, `cus_${marca()}`, party]);
});

describe("0329: taxa do cartão (mesma conta no app e no banco)", () => {
  test("1x a 3x sem juros; 4x a 12x a cliente paga a taxa do Asaas", async () => {
    expect(acrescimoCartaoCents(30000, 1)).toBe(0);
    expect(acrescimoCartaoCents(30000, 3)).toBe(0);
    // 4x: teto((300,00 + 0,49) / (1 − 3,49%)) = 311,36 → R$ 11,36 a mais
    expect(acrescimoCartaoCents(30000, 4)).toBe(1136);
    // 12x: teto((300,00 + 0,49) / (1 − 3,99%)) = 312,98 → R$ 12,98 a mais
    expect(acrescimoCartaoCents(30000, 12)).toBe(1298);
    expect(simularParcelas(30000, 4)).toMatchObject({ totalCents: 31136, parcelaCents: 7784, semJuros: false });
    for (const [base, p] of [[30000, 4], [30000, 6], [30000, 7], [30000, 12], [2490, 5], [123457, 9], [100, 4]] as const) {
      const r = await rpcServico<number>("asaas_cartao_acrescimo", { _base_cents: base, _parcelas: p });
      expect(Number(r.dados)).toBe(acrescimoCartaoCents(base, p));
    }
  });
});

describe("0329: link em parcelas", () => {
  test("4x: o Asaas recebe 4 parcelas com a taxa somada e as 4 ficam ligadas à mesma dívida", async () => {
    const sim = new SimuladorAsaas({ conta, semente: `p4-${marca()}` });
    const inst = await parcelaAberta(30000);
    const r = await gerar(sim, inst, 4);
    expect(r.state).toBe("criada");
    const cs = await cobrancas(inst);
    expect(cs.length).toBe(4);
    expect(cs.map((c) => c.parcela_numero)).toEqual([1, 2, 3, 4]);
    expect(new Set(cs.map((c) => c.parcelamento_externo)).size).toBe(1);
    expect(cs.reduce((s, c) => s + c.v, 0)).toBe(30000 + 1136);
    expect(cs.reduce((s, c) => s + c.a, 0)).toBe(1136);
    // o link devolvido é o da 1ª parcela
    expect(r.external_id).toBe(cs[0]!.external_id);
  });

  test("3x: sem juros — soma das parcelas é exatamente o valor da venda", async () => {
    const sim = new SimuladorAsaas({ conta, semente: `p3-${marca()}` });
    const inst = await parcelaAberta(30000);
    expect((await gerar(sim, inst, 3)).state).toBe("criada");
    const cs = await cobrancas(inst);
    expect(cs.length).toBe(3);
    expect(cs.reduce((s, c) => s + c.v, 0)).toBe(30000);
    expect(cs.every((c) => c.a === 0)).toBe(true);
  });

  test("pedido sem parcelas (equipe/Pix/boleto) continua igual: uma cobrança só", async () => {
    const sim = new SimuladorAsaas({ conta, semente: `p1-${marca()}` });
    const inst = await parcelaAberta(30000);
    expect((await gerar(sim, inst)).state).toBe("criada");
    const cs = await cobrancas(inst);
    expect(cs.length).toBe(1);
    expect(cs[0]!.v).toBe(30000);
    expect(cs[0]!.parcelamento_externo).toBeNull();
  });

  test("venda que já tem link em 1x não vira outra cobrança em 4x: avisa para cancelar antes", async () => {
    const sim = new SimuladorAsaas({ conta, semente: `troca-${marca()}` });
    const inst = await parcelaAberta(30000);
    expect((await gerar(sim, inst, 1)).state).toBe("criada");
    await expect(gerar(sim, inst, 4)).rejects.toThrow(/já tem um link de cartão em 1x/);
    expect((await cobrancas(inst)).length).toBe(1);
    // pedir de novo o mesmo 1x reaproveita o link (nada duplicado)
    expect((await gerar(sim, inst, 1)).reaproveitada).toBe(true);
  });
});

describe("0329: baixa de cada parcela do cartão", () => {
  test("cada pay_ baixa só a sua parte com a taxa como juros; o saldo fecha em zero e nada é reemitido no meio", async () => {
    const sim = new SimuladorAsaas({ conta, semente: `bx-${marca()}` });
    const inst = await parcelaAberta(30000);
    await gerar(sim, inst, 4);
    const cs = await cobrancas(inst);
    let restante = 30000;
    for (const c of cs) {
      await adm.begin(async (tx) => {
        await tx.unsafe(`select set_config('lardann.asaas_link','on',true)`);
        await tx.unsafe(`update public.asaas_charges set external_status='RECEIVED', received_cents=value_cents, fee_cents=0, payment_date='2026-11-16' where id=$1`, [c.id]);
      });
      const b = await rpcServico<{ baixa: boolean; juros_cents: number; valor_cents: number }>("asaas_baixa_automatica", { _charge: c.id });
      expect(b.erro).toBeNull();
      expect(b.dados.baixa).toBe(true);
      expect(Number(b.dados.juros_cents)).toBe(c.a);
      restante -= c.v - c.a;
      expect(await saldo(inst)).toBe(restante);
      // o que segue aberto no Asaas (sem a taxa) bate com o saldo do Lardan: nada a cancelar/reemitir
      const plano = await rpcServico<{ acao: string }>("asaas_saldo_plano", { _inst: inst, _forcar: false });
      expect(plano.dados.acao).toBe("nada");
    }
    expect(await saldo(inst)).toBe(0);
    const j = await um<{ s: string }>(`select coalesce(sum(valor_cents),0) s from public.financial_adjustments where installment_id=$1 and kind='juros'`, [inst]);
    expect(Number(j.s)).toBe(1136);
    // um pay_ = um lançamento
    for (const c of cs) {
      const k = await um<{ c: number }>(`select count(*)::int c from public.financial_settlements where idempotency_key=$1`, [`asaas:baixa:${conta}:${c.external_id}`]);
      expect(k.c).toBe(1);
    }
  });

  test("varredura de saldo não marca o parcelamento como cobrança a mais", async () => {
    const sim = new SimuladorAsaas({ conta, semente: `var-${marca()}` });
    const inst = await parcelaAberta(50000);
    await gerar(sim, inst, 10);
    await rpcServico("asaas_saldo_varrer", {});
    const q = await ler<{ c: number }>(master, `select count(*)::int c from public.asaas_saldo_sync where installment_id=$1 and estado in ('pendente','processando','excecao')`, [inst]);
    expect(q.linhas[0]?.c ?? 0).toBe(0);
  });
});
