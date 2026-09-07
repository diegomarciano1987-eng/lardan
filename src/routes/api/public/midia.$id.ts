import { createFileRoute } from "@tanstack/react-router";

/**
 * Entrega pública e estável das imagens de produtos publicados.
 * O balde continua privado: este endereço só serve arquivos ligados a um
 * produto publicado, sem link assinado que expira.
 */
export const Route = createFileRoute("/api/public/midia/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const id = params.id;
        if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: media } = await supabaseAdmin
          .from("media_assets")
          .select("id, storage_path, content_type, is_archived")
          .eq("id", id)
          .maybeSingle();

        if (!media || media.is_archived || !media.storage_path) {
          return new Response("Not found", { status: 404 });
        }

        // só imagens ligadas a algo publicado saem daqui
        const [vinculo, heroCategoria, heroColecao] = await Promise.all([
          supabaseAdmin
            .from("product_media")
            .select("product_id, products!inner(status)")
            .eq("media_id", id)
            .eq("products.status", "publicado")
            .limit(1),
          supabaseAdmin
            .from("categories")
            .select("id")
            .eq("hero_media_id", id)
            .eq("status", "publicado")
            .limit(1),
          supabaseAdmin
            .from("collections")
            .select("id")
            .eq("hero_media_id", id)
            .eq("status", "publicado")
            .limit(1),
        ]);

        const publicoAgora =
          (vinculo.data?.length ?? 0) > 0 ||
          (heroCategoria.data?.length ?? 0) > 0 ||
          (heroColecao.data?.length ?? 0) > 0;

        if (!publicoAgora) {
          return new Response("Not found", { status: 404 });
        }

        const { data: arquivo, error } = await supabaseAdmin.storage
          .from("media")
          .download(media.storage_path);
        if (error || !arquivo) return new Response("Not found", { status: 404 });

        return new Response(await arquivo.arrayBuffer(), {
          headers: {
            "content-type": media.content_type ?? "image/jpeg",
            // janela curta e honesta: sem revalidação obsoleta, a retirada do ar
            // vale em no máximo 60 segundos em qualquer cache.
            "cache-control": "public, max-age=60, s-maxage=60, must-revalidate",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
