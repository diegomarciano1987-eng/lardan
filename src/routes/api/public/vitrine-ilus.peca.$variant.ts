import { createFileRoute } from "@tanstack/react-router";

/** Imagem ilustrativa de uma peça sem foto real (miniatura nas telas de maleta). */
export const Route = createFileRoute("/api/public/vitrine-ilus/peca/$variant")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!/^[0-9a-f-]{36}$/i.test(params.variant)) return new Response("Not found", { status: 404 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: rows } = await supabaseAdmin
          .from("showcase_illustrations" as never)
          .select("storage_path")
          .eq("variant_id", params.variant)
          .order("created_at", { ascending: false })
          .limit(1);
        const path = (rows as { storage_path?: string }[] | null)?.[0]?.storage_path;
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
