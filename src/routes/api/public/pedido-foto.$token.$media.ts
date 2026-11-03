import { createFileRoute } from "@tanstack/react-router";

/** Foto de uma peça de um pedido, só para quem tem o link secreto do pedido. */
export const Route = createFileRoute("/api/public/pedido-foto/$token/$media")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const uuid = /^[0-9a-f-]{36}$/i;
        if (!uuid.test(params.token) || !uuid.test(params.media)) return new Response("Not found", { status: 404 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: ok } = await supabaseAdmin.rpc("pedido_foto_ok", { _token: params.token, _media: params.media });
        if (!ok) return new Response("Not found", { status: 404 });
        const { data: media } = await supabaseAdmin.from("media_assets")
          .select("storage_path, content_type, is_archived").eq("id", params.media).maybeSingle();
        if (!media || media.is_archived || !media.storage_path) return new Response("Not found", { status: 404 });
        const { data: arquivo, error } = await supabaseAdmin.storage.from("media").download(media.storage_path);
        if (error || !arquivo) return new Response("Not found", { status: 404 });
        return new Response(await arquivo.arrayBuffer(), {
          headers: {
            "content-type": media.content_type ?? "image/jpeg",
            "cache-control": "public, max-age=300, s-maxage=3600",
            "x-content-type-options": "nosniff",
            "x-robots-tag": "noindex",
          },
        });
      },
    },
  },
});
