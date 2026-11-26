import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";

/**
 * Capas das peças (foto de posição 0) para quem tem papel no sistema (equipe,
 * consultora, representante) ou terminal do PDV: recebe ids de produto ou variante e devolve
 * URL assinada de 1 h. Nunca devolve mais nada além da foto.
 */
export const capasDasPecas = createServerFn({ method: "POST" })
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
    // Quem pode ver: usuário logado (gestão ou consultora) ou terminal do PDV com sessão válida.
    let autorizado = false;
    const bearer = getRequestHeader("authorization")?.replace(/^Bearer\s+/i, "");
    if (bearer) {
      const { data: u } = await supabaseAdmin.auth.getUser(bearer);
      // 0326: conta criada pelo site (/minha-conta) não tem papel no sistema e não vê foto de peça não publicada
      if (u?.user) {
        const { count } = await supabaseAdmin.from("user_roles").select("user_id", { count: "exact", head: true }).eq("user_id", u.user.id);
        autorizado = (count ?? 0) > 0;
        // Colaboradoras da Operação (entrada por código, 0130) não têm papel em user_roles.
        if (!autorizado) {
          const { data: ca } = await supabaseAdmin
            .from("colab_acessos")
            .select("user_id")
            .eq("user_id", u.user.id)
            .eq("ativo", true)
            .maybeSingle();
          autorizado = Boolean(ca);
        }
      }
    }
    if (!autorizado) {
      const t = getCookie("lardan_pdv");
      if (t) {
        const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
        const hash = Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
        const { data: sess } = await supabaseAdmin
          .from("pdv_sessoes")
          .select("id")
          .eq("token_hash", hash)
          .is("revogada_em", null)
          .gt("expira_em", new Date().toISOString())
          .maybeSingle();
        autorizado = Boolean(sess);
      }
    }
    if (!autorizado) throw new Error("Sem acesso.");
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
      .select("product_id, variant_id, position, media_assets(storage_path)")
      .in("product_id", prods)
      .order("position", { ascending: true });
    // Capa do produto = primeira foto; capa da variante = primeira foto ligada a ela (product_media.variant_id),
    // senão a do produto. Chave "v:<id>" separa variantes de produtos.
    const capa: Record<string, string> = {};
    (pm ?? []).forEach((r) => {
      const ma = r.media_assets as unknown as { storage_path: string } | null;
      if (!ma?.storage_path) return;
      if (!capa[r.product_id]) capa[r.product_id] = ma.storage_path;
      if (r.variant_id && varParaProd[r.variant_id] && !capa[`v:${r.variant_id}`]) capa[`v:${r.variant_id}`] = ma.storage_path;
    });
    const caminhos = Array.from(new Set(Object.values(capa)));
    if (!caminhos.length) return resultado;
    const { data: urls } = await supabaseAdmin.storage.from("media").createSignedUrls(caminhos, 3600);
    const porCaminho: Record<string, string> = {};
    (urls ?? []).forEach((u, i) => {
      const c = caminhos[i];
      if (c && u.signedUrl) porCaminho[c] = u.signedUrl;
    });
    for (const [p, c] of Object.entries(capa)) if (!p.startsWith("v:") && porCaminho[c]) resultado[p] = porCaminho[c];
    for (const [v, p] of Object.entries(varParaProd)) {
      const propria = capa[`v:${v}`];
      const url = (propria && porCaminho[propria]) || resultado[p];
      if (url) resultado[v] = url;
    }
    return resultado;
  });
