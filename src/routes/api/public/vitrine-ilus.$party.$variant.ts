import { createFileRoute } from "@tanstack/react-router";

/**
 * Imagens ilustrativas da vitrine de uma consultora (peças sem foto real).
 * Só sai a imagem cadastrada para aquela consultora e aquela peça.
 */
export const Route = createFileRoute("/api/public/vitrine-ilus/$party/$variant")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const uuid = /^[0-9a-f-]{36}$/i;
        if (!uuid.test(params.party) || !uuid.test(params.variant)) {
          return new Response("Not found", { status: 404 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row } = await supabaseAdmin
          .from("showcase_illustrations" as never)
          .select("storage_path")
          .eq("party_id", params.party)
          .eq("variant_id", params.variant)
          .maybeSingle();
        const path = (row as { storage_path?: string } | null)?.storage_path;
        if (!path) return new Response("Not found", { status: 404 });
        const etag = `"ilus-${params.variant}"`;
        if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
        const { data: arquivo, error } = await supabaseAdmin.storage.from("vitrine-originais").download(path);
        if (error || !arquivo) return new Response("Not found", { status: 404 });
        return new Response(await arquivo.arrayBuffer(), {
          headers: {
            "content-type": "image/webp",
            etag,
            "cache-control": "public, max-age=300, s-maxage=3600",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
