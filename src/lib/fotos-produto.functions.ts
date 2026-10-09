import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Capas das peças (foto de posição 0) para qualquer usuário logado,
 * inclusive consultoras: recebe ids de produto ou variante e devolve
 * URL assinada de 1 h. Nunca devolve mais nada além da foto.
 */
export const capasDasPecas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        produtos: z.array(z.string().uuid()).max(300).default([]),
        variantes: z.array(z.string().uuid()).max(300).default([]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const resultado: Record<string, string> = {};
    const varParaProd: Record<string, string> = {};
    if (data.variantes.length) {
      const { data: vs } = await supabaseAdmin
        .from("product_variants")
        .select("id, product_id")
        .in("id", data.variantes);
      (vs ?? []).forEach((v) => (varParaProd[v.id] = v.product_id));
    }
    const prods = Array.from(new Set([...data.produtos, ...Object.values(varParaProd)]));
    if (!prods.length) return resultado;
    const { data: pm } = await supabaseAdmin
      .from("product_media")
      .select("product_id, position, media_assets(storage_path)")
      .in("product_id", prods)
      .order("position", { ascending: true });
    const capa: Record<string, string> = {};
    (pm ?? []).forEach((r) => {
      const ma = r.media_assets as unknown as { storage_path: string } | null;
      if (ma?.storage_path && !capa[r.product_id]) capa[r.product_id] = ma.storage_path;
    });
    const caminhos = Array.from(new Set(Object.values(capa)));
    if (!caminhos.length) return resultado;
    const { data: urls } = await supabaseAdmin.storage.from("media").createSignedUrls(caminhos, 3600);
    const porCaminho: Record<string, string> = {};
    (urls ?? []).forEach((u, i) => {
      if (u.signedUrl) porCaminho[caminhos[i]] = u.signedUrl;
    });
    for (const [p, c] of Object.entries(capa)) if (porCaminho[c]) resultado[p] = porCaminho[c];
    for (const [v, p] of Object.entries(varParaProd)) if (resultado[p]) resultado[v] = resultado[p];
    return resultado;
  });
