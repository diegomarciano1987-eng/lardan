/**
 * Ações do painel que passam pelo ADAPTADOR (hoje, só o simulador).
 *
 * Só funcionam quando o SERVIDOR está em modo de simulação E marcado como
 * ambiente isolado de demonstração (LARDAN_DEMO_ISOLADO=1). Em qualquer outro
 * servidor — inclusive a pré-visualização e o site publicado — respondem que a
 * demonstração não está disponível. O navegador não escolhe o transporte.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BancoAsaas } from "./banco";
import type { SimuladorAsaas } from "./simulador";

type Ctx = { supabase: { rpc: (fn: never, args: never) => PromiseLike<{ data: unknown; error: { message: string } | null }> } };

function bancoDe(ctx: Ctx): BancoAsaas {
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>) {
      const { data, error } = await ctx.supabase.rpc(fn as never, args as never);
      if (error) throw new Error(error.message);
      return data as T;
    },
  };
}

const G = globalThis as { __lardanSimulador?: SimuladorAsaas };

async function simulador(): Promise<SimuladorAsaas> {
  const { ambienteDoServidor, SimuladorAsaas } = await import("./index");
  if (ambienteDoServidor() !== "simulacao" || process.env["LARDAN_DEMO_ISOLADO"] !== "1") {
    throw new Error("Demonstração do adaptador disponível somente no ambiente isolado de simulação.");
  }
  if (!G.__lardanSimulador) {
    const sim = new SimuladorAsaas({ semente: "demo" });
    sim.semearCliente({ id: "cus_demo_vinculado", name: "ISO Cliente Vinculado", cpfCnpj: null });
    sim.semearCliente({ id: "cus_demo_sem_vinculo", name: "ISO Cliente Sem Vínculo", cpfCnpj: null });
    for (let i = 0; i < 116; i++) {
      sim.semearCobranca({
        customer: "cus_demo_vinculado", customerName: "ISO Cliente Vinculado", valueCents: 5000 + i,
        dueDate: `2026-${String((i % 9) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
        billingType: "BOLETO", status: "PENDING", externalReference: null, dateCreated: "2026-01-02",
      });
    }
    // recebidas antes do sistema: histórico informativo, nunca caixa
    for (let i = 0; i < 3; i++) {
      sim.semearCobranca({
        customer: "cus_demo_vinculado", valueCents: 7000, valuePaidCents: 7000, dueDate: "2026-02-10",
        paymentDate: "2026-02-10", billingType: "PIX", status: "RECEIVED", externalReference: null,
      });
    }
    // cliente sem vínculo: exige revisão humana (nunca por nome)
    sim.semearCobranca({ customer: "cus_demo_sem_vinculo", customerName: "ISO Cliente Sem Vínculo", valueCents: 9900, dueDate: "2026-10-20", billingType: "PIX", status: "PENDING", externalReference: null });
    // mesmo valor e vencimento de um título lançado à mão: duplicidade suspeita
    sim.semearCobranca({ customer: "cus_demo_vinculado", valueCents: 12345, dueDate: "2026-10-15", billingType: "BOLETO", status: "PENDING", externalReference: null });
    G.__lardanSimulador = sim;
  }
  return G.__lardanSimulador;
}

export const demoImportar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string; maxPaginas?: number }) => d)
  .handler(async ({ data, context }) => {
    const sim = await simulador();
    const { abrirLote, buscarPaginas, gerarPrevia } = await import("./importacao");
    const banco = bancoDe(context as unknown as Ctx);
    const pedido = { accountId: data.accountId, pageSize: 50, incluirEmAbertoAnteriores: true, ...(data.maxPaginas ? { maxPaginas: data.maxPaginas } : {}) };
    const lote = await abrirLote(banco, pedido);
    const busca = await buscarPaginas(banco, sim, lote, pedido);
    const previa = busca.hasMore ? null : await gerarPrevia(banco, lote.run_id);
    return { lote, busca, previa };
  });

export const demoGerarLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string; installmentId: string; billingType: "PIX" | "BOLETO"; perderResposta?: boolean }) => d)
  .handler(async ({ data, context }) => {
    const sim = await simulador();
    const { prepararIntencao, executarIntencao } = await import("./cobranca");
    const banco = bancoDe(context as unknown as Ctx);
    const it = await prepararIntencao(banco, { accountId: data.accountId, installmentId: data.installmentId, billingType: data.billingType });
    if (it.reaproveitada) return { state: "criada", invoice_url: it.invoice_url ?? null, external_id: it.external_id ?? null, reaproveitada: true };
    if (!it.id) throw new Error("Intenção não registrada.");
    // Repetição (duplo clique, outra aba): só quem registrou a intenção a executa.
    if (it.repetida) return { id: it.id, state: it.state ?? "preparada", invoice_url: it.invoice_url ?? null, external_id: it.external_id ?? null, reaproveitada: true };
    if (it.state && it.state !== "preparada") return { id: it.id, state: it.state, invoice_url: it.invoice_url ?? null, reaproveitada: true };
    if (data.perderResposta && it.internal_reference) sim.definirFalha(it.internal_reference, "perder_resposta");
    const r = await executarIntencao(banco, sim, it.id, {
      customerExternalId: it.customer_external_id ?? null, valueCents: it.valor_cents!, dueDate: it.due_date!,
      billingType: it.billing_type!, internalReference: it.internal_reference!, idempotencyKey: it.internal_reference!,
    }, `web-${crypto.randomUUID().slice(0, 8)}`);
    if (it.internal_reference) sim.definirFalha(it.internal_reference, "nenhuma");
    return { ...r, chamadas_criar: sim.chamadasCriar };
  });

export const demoRecuperar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { intentId: string }) => d)
  .handler(async ({ data, context }) => {
    const sim = await simulador();
    const { conciliarDesconhecida } = await import("./cobranca");
    const c = context as unknown as { supabase: { from: (t: string) => { select: (s: string) => { eq: (k: string, v: string) => { maybeSingle: () => PromiseLike<{ data: { id: string; internal_reference: string } | null }> } } } } };
    const { data: it } = await c.supabase.from("asaas_charge_intents").select("id, internal_reference").eq("id", data.intentId).maybeSingle();
    if (!it) throw new Error("Intenção não encontrada ou sem acesso.");
    const r = await conciliarDesconhecida(bancoDe(context as unknown as Ctx), sim, it);
    return { ...r, chamadas_criar: sim.chamadasCriar };
  });

export const demoEvento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string; chargeExternalId: string; pagoCents: number; tarifaCents: number; repetir?: boolean }) => d)
  .handler(async ({ data, context }) => {
    const sim = await simulador();
    const { drenarEventos } = await import("./eventos");
    sim.registrarRecebimento(data.chargeExternalId, { pagoCents: data.pagoCents, tarifaCents: data.tarifaCents, data: new Date().toISOString().slice(0, 10) });
    const banco = bancoDe(context as unknown as Ctx);
    const fila = await sim.receberEventos();
    const { registrarEvento, processarEvento } = await import("./eventos");
    const saida = [];
    for (const e of fila) {
      const vezes = data.repetir ? 2 : 1;
      for (let i = 0; i < vezes; i++) {
        const reg = await registrarEvento(banco, data.accountId, e);
        saida.push(reg.novo === false ? { ...reg, repetido: true } : await processarEvento(banco, reg.id));
      }
    }
    void drenarEventos;
    return saida;
  });
