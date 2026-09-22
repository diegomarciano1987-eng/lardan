/**
 * LARDAN — ligar/desligar o aviso de nova candidatura no aparelho de quem está logado.
 *
 * Cada pessoa só mexe nos próprios aparelhos: as regras do banco garantem isso
 * mesmo que alguém tente chamar estas rotinas por fora da tela.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Inscricao = z.object({
  endpoint: z.string().url().max(600),
  p256dh: z.string().min(10).max(200),
  auth: z.string().min(5).max(100),
  user_agent: z.string().max(300).optional(),
});

export const salvarInscricaoPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Inscricao.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("push_subscriptions").upsert(
      {
        user_id: context.userId,
        endpoint: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        user_agent: data.user_agent ?? null,
        last_used_at: null,
      },
      { onConflict: "endpoint" },
    );
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const removerInscricaoPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ endpoint: z.string().max(600) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", data.endpoint)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const contarAparelhosPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { count, error } = await context.supabase
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { aparelhos: count ?? 0 };
  });

/** Envia um aviso de teste para os aparelhos da própria pessoa. */
export const testarAvisoPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { enviarAvisoPush } = await import("./notificar.server");
    const r = await enviarAvisoPush(
      {
        titulo: "Lardan · teste de aviso",
        corpo: "Funcionou. Você será avisada assim que cair uma nova candidatura.",
        url: "/admin/candidaturas",
        tag: "lardan-teste",
      },
      context.userId,
    );
    return r;
  });
