/**
 * Ponte autenticada entre as telas da Inteligência da Rede e o servidor.
 * Malhas e geocodificação nunca acontecem no navegador.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const obterMalha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        nivel: z.enum(["brasil", "estado"]),
        codigoUf: z.string().regex(/^\d{2}$/).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { carregarMalha } = await import("./malhas.server");
    return carregarMalha(data.nivel, data.codigoUf);
  });

export const localizarEnderecos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ limite: z.number().int().min(1).max(200).default(40) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pode } = await supabaseAdmin.rpc("has_capability", {
      _user_id: context.userId!,
      _cap: "partners.manage",
    });
    if (!pode) throw new Error("Sem permissão para processar localizações.");
    const { processarLote } = await import("./geocode.server");
    return processarLote(context.userId ?? null, data.limite);
  });

export const situacaoDaLocalizacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pode } = await supabaseAdmin.rpc("has_capability", {
      _user_id: context.userId!,
      _cap: "partners.view",
    });
    if (!pode) throw new Error("Sem permissão para ver a rede.");
    const { situacaoLocalizacao } = await import("./geocode.server");
    return situacaoLocalizacao();
  });
