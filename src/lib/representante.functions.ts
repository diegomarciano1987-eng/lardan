/**
 * Cobrança gerada pelo representante para uma parcela da própria carteira.
 * O banco confere a carteira (rep_parcela_cobravel) com a sessão do representante;
 * a cobrança sai pelo motor oficial do Asaas em nome da Lardan (ator técnico) e a baixa
 * vem só pelo aviso do Asaas. Idempotente: parcela com cobrança viva é reaproveitada.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Forma = "PIX" | "BOLETO" | "CREDIT_CARD";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as {
    rpc: (f: string, a: object) => PromiseLike<{ data: any; error: { message: string } | null }>;
    from: (t: string) => any;
  };
}

export const repCobrar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { installmentId: string; forma: Forma }) => {
    if (!d?.installmentId || !/^[0-9a-f-]{36}$/i.test(d.installmentId)) throw new Error("Parcela inválida.");
    if (!["PIX", "BOLETO", "CREDIT_CARD"].includes(d.forma)) throw new Error("Forma inválida.");
    return { installmentId: d.installmentId, forma: d.forma };
  })
  .handler(async ({ data, context }) => {
    const { data: ok, error } = await (context.supabase as any).rpc("rep_parcela_cobravel", { _inst: data.installmentId });
    if (error) throw new Error(error.message);
    const repUser = (ok as { user: string }).user;
    const adm = await admin();

    // Já existe cobrança viva? Reaproveita, nunca duplica.
    const { data: viva } = await adm.from("asaas_charges")
      .select("id, external_id, external_status, billing_type, invoice_url")
      .eq("installment_id", data.installmentId).not("external_status", "in", "(DELETED,REFUNDED,RECEIVED,CONFIRMED,RECEIVED_IN_CASH)")
      .order("imported_at", { ascending: false }).limit(1).maybeSingle();

    let externalId: string | null = viva?.external_id ?? null;
    let url: string | null = viva?.invoice_url ?? null;
    let reaproveitada = !!viva;
    let simulado = false;

    if (!viva) {
      const { data: cfg } = await adm.from("consultora_cobranca_config").select("ator_user_id").limit(1).maybeSingle();
      const actor = cfg?.ator_user_id as string | undefined;
      if (!actor) throw new Error("Cobrança indisponível: configuração da Lardan ausente.");
      const { data: inst } = await adm.from("financial_installments").select("vencimento").eq("id", data.installmentId).maybeSingle();
      const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
      const venc = inst?.vencimento && inst.vencimento >= hoje ? inst.vencimento : hoje;
      const { solicitarCobranca } = await import("./asaas/operacoes");
      const { bancoExecutor } = await import("./asaas/servidor.server");
      const { envDoServidor } = await import("./asaas/configuracao.server");
      const usuario = {
        rpc: async <T,>(_f: string, a: Record<string, unknown>) => {
          const { data: d, error: e } = await adm.rpc("rep_asaas_preparar", { _actor: actor, _rep_user: repUser, _payload: a["_payload"] });
          if (e) throw new Error(e.message);
          return d as T;
        },
      };
      const r = await solicitarCobranca(usuario as never, await bancoExecutor(), actor,
        { installmentId: data.installmentId, billingType: data.forma as never, dueDate: venc } as never, { env: envDoServidor() });
      const rr = r as { state: string; aviso?: string; external_id?: string | null; invoice_url?: string | null; simulado?: boolean; reaproveitada?: boolean; erro?: string | null };
      if (rr.state === "indisponivel") throw new Error(rr.aviso || "Cobrança indisponível no momento.");
      externalId = rr.external_id ?? null; url = rr.invoice_url ?? null; simulado = !!rr.simulado; reaproveitada = !!rr.reaproveitada;
      if (!url && rr.erro) throw new Error(rr.erro);
    }

    let copia: string | null = null; let qr: string | null = null;
    if (data.forma === "PIX" && externalId && !simulado) {
      try {
        const { resolverPorParcela } = await import("./asaas/servidor.server");
        const { transporteDaResolucao } = await import("./asaas/configuracao.server");
        const { data: cfg } = await adm.from("consultora_cobranca_config").select("ator_user_id").limit(1).maybeSingle();
        const tr = (await transporteDaResolucao(await resolverPorParcela(data.installmentId, cfg?.ator_user_id))) as unknown as {
          pixQrCode?: (id: string) => Promise<{ payload: string | null; encodedImage: string | null }>;
        };
        const px = await tr.pixQrCode?.(externalId);
        copia = px?.payload ?? null; qr = px?.encodedImage ? `data:image/png;base64,${px.encodedImage}` : null;
      } catch (e) { console.error("pix qrcode representante", (e as Error).message); }
    }
    return { url, copia, qr, reaproveitada };
  });
