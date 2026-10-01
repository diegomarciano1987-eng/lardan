import { createFileRoute } from "@tanstack/react-router";

/**
 * Imagens publicadas das vitrines das consultoras. O armazenamento é privado:
 * só sai daqui o arquivo citado na versão publicada de uma vitrine no ar.
 */
export const Route = createFileRoute("/api/public/vitrine-img/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const path = params._splat ?? "";
        if (!/^[0-9a-f-]{36}\/pub\/[0-9a-f-]{36}(-\d{3,4})?\.(webp|jpg|jpeg|png)$/.test(path)) {
          return new Response("Not found", { status: 404 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: ok } = await supabaseAdmin.rpc("showcase_public_file_ok" as never, { _path: path } as never);
        if (!ok) return new Response("Not found", { status: 404 });

        const etag = `"${path.split("/").pop()}"`;
        if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
        const { data: arquivo, error } = await supabaseAdmin.storage.from("vitrine-originais").download(path);
        if (error || !arquivo) return new Response("Not found", { status: 404 });
        const ext = path.split(".").pop();
        return new Response(await arquivo.arrayBuffer(), {
          headers: {
            "content-type": ext === "webp" ? "image/webp" : ext === "png" ? "image/png" : "image/jpeg",
            etag,
            // Retirada do ar precisa valer em minutos: cache curto, sem servir versão velha.
            "cache-control": "public, max-age=60, s-maxage=60, must-revalidate",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
