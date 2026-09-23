/**
 * Demonstração do adaptador — SOMENTE no ambiente isolado.
 *
 * Exige: servidor em modo simulado + LARDAN_DEMO_ISOLADO=1 + conta em modo
 * simulado + capacidade específica do usuário. Em qualquer outro servidor
 * responde que a demonstração não está disponível. Cada conta tem o seu
 * simulador; dados exclusivamente sintéticos.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: never; userId: string };

async function simuladorDemo(accountId: string, ctx: Ctx, capacidade: string) {
  const { simuladorDaConta } = await import("./index");
  const { bancoDe, resolverPorConta } = await import("./servidor.server");
  const r = await resolverPorConta(accountId, ctx.userId, "finance.receivable.view");
  if (!r.executavel || r.situacao !== "simulada") {
    throw new Error("Demonstração do adaptador disponível somente no ambiente isolado de simulação.");
  }
  const pode = await bancoDe(ctx.supabase).rpc<boolean>("has_capability", { _user_id: ctx.userId, _cap: capacidade });
  if (!pode) throw new Error("Sem permissão para esta ação de demonstração.");
  const sim = await simuladorDaConta(accountId);
  if (sim.vazio) {
    sim.semearCliente({ name: "ISO Cliente Vinculado", cpfCnpj: null, id: `sim_cus_${accountId.slice(0, 8)}_vinc` });
    sim.semearCliente({ name: "ISO Cliente Sem Vínculo", cpfCnpj: null, id: `sim_cus_${accountId.slice(0, 8)}_semv` });
    const vinc = `sim_cus_${accountId.slice(0, 8)}_vinc`;
    for (let i = 0; i < 116; i++) {
      sim.semearCobranca(
        {
          customer: vinc, customerName: "ISO Cliente Vinculado", valueCents: 5000 + i,
          dueDate: `2026-${String((i % 9) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
          billingType: "BOLETO", status: "PENDING", externalReference: null, dateCreated: "2026-01-02",
        },
        // parte das importadas chega sem link: ele é obtido depois, pelo ID
        { semLinkNaListagem: i % 10 === 0 },
      );
    }
    for (let i = 0; i < 3; i++) {
      sim.semearCobranca({ customer: vinc, valueCents: 7000, valuePaidCents: 7000, dueDate: "2026-02-10", paymentDate: "2026-02-10", billingType: "PIX", status: "RECEIVED", externalReference: null });
    }
    sim.semearCobranca({ customer: `sim_cus_${accountId.slice(0, 8)}_semv`, customerName: "ISO Cliente Sem Vínculo", valueCents: 9900, dueDate: "2026-10-20", billingType: "PIX", status: "PENDING", externalReference: null });
    sim.semearCobranca({ customer: vinc, valueCents: 12345, dueDate: "2026-10-15", billingType: "BOLETO", status: "PENDING", externalReference: null });
  }
  return sim;
}

export const demoImportar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string; maxPaginas?: number }) => d)
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const sim = await simuladorDemo(data.accountId, c, "finance.import.run");
    const { abrirLote, buscarPaginas, gerarPrevia } = await import("./importacao");
    const { bancoDe } = await import("./servidor.server");
    const banco = bancoDe(c.supabase);
    const pedido = { accountId: data.accountId, pageSize: 50, incluirEmAbertoAnteriores: true, ...(data.maxPaginas ? { maxPaginas: data.maxPaginas } : {}) };
    const lote = await abrirLote(banco, pedido);
    const busca = await buscarPaginas(banco, sim, lote, pedido);
    const previa = busca.hasMore ? null : await gerarPrevia(banco, lote.run_id);
    return { lote, busca, previa };
  });

/** Programa a próxima criação desta parcela para perder a resposta (demonstração). */
export const demoPerderResposta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string; installmentId: string; billingType: "PIX" | "BOLETO" }) => d)
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const sim = await simuladorDemo(data.accountId, c, "finance.receivable.manage");
    const { prepararIntencao, executarIntencao } = await import("./cobranca");
    const { bancoDe, bancoExecutor } = await import("./servidor.server");
    const it = await prepararIntencao(bancoDe(c.supabase), data);
    if (!it.id || it.state !== "preparada") return { id: it.id, state: it.state ?? "criada", reaproveitada: true };
    sim.definirFalha(it.internal_reference!, "perder_resposta");
    const r = await executarIntencao(await bancoExecutor(), sim, it.id, { actor: c.userId });
    return { ...r, chamadas_criar: sim.chamadasCriar };
  });

export const demoEvento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string; chargeExternalId: string; pagoCents: number; tarifaCents: number; repetir?: boolean }) => d)
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const sim = await simuladorDemo(data.accountId, c, "finance.reconcile");
    sim.registrarRecebimento(data.chargeExternalId, { pagoCents: data.pagoCents, tarifaCents: data.tarifaCents, data: new Date().toISOString().slice(0, 10) });
    const { registrarEvento, processarEvento } = await import("./eventos");
    const { bancoDe, bancoExecutor } = await import("./servidor.server");
    const servico = await bancoExecutor();
    const usuario = bancoDe(c.supabase);
    const saida = [];
    for (const e of await sim.receberEventos()) {
      for (let i = 0; i < (data.repetir ? 2 : 1); i++) {
        const reg = await registrarEvento(servico, data.accountId, e, "simulacao", c.userId);
        saida.push(reg.novo === false ? { ...reg, repetido: true } : await processarEvento(usuario, reg.id));
      }
    }
    return saida;
  });
