import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { SITE_URL } from "@/lib/seo";
import { slugsProdutos, urlsPaginas } from "@/lib/sitemap";

/** Chave pública do IndexNow; o arquivo /<chave>.txt fica em public/. */
export const INDEXNOW_KEY = "02d1652c9da241aa97843ebc4020c9f6";

/**
 * POST /api/public/indexnow — envia URLs ao IndexNow (Bing, Yandex etc.).
 * Corpo opcional: { "urls": ["/caminho", ...] }. Sem corpo, envia o sitemap inteiro.
 * Protegido pelo segredo interno (Bearer); nunca aberto ao público.
 */
export const Route = createFileRoute("/api/public/indexnow")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const negado = await authenticateCronRequest(request);
        if (negado) return negado;

        let pedidas: string[] = [];
        try {
          const corpo = (await request.json()) as { urls?: unknown };
          if (Array.isArray(corpo.urls)) {
            pedidas = corpo.urls.filter((u): u is string => typeof u === "string");
          }
        } catch {
          /* sem corpo: envia tudo */
        }

        if (pedidas.length === 0) {
          const paginas = (await urlsPaginas()).map((u) => u.loc);
          const produtos = (await slugsProdutos()).map((s) => `/produto/${s}`);
          pedidas = [...paginas, ...produtos];
        }

        const host = new URL(SITE_URL).host;
        const urlList = [
          ...new Set(
            pedidas
              .map((u) => (u.startsWith("http") ? u : `${SITE_URL}${u.startsWith("/") ? u : `/${u}`}`))
              .filter((u) => new URL(u).host === host),
          ),
        ].slice(0, 10000);

        if (urlList.length === 0) return Response.json({ enviadas: 0 }, { status: 400 });

        const resp = await fetch("https://api.indexnow.org/indexnow", {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({
            host,
            key: INDEXNOW_KEY,
            keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
            urlList,
          }),
        });
        const texto = await resp.text();
        return Response.json(
          { enviadas: urlList.length, status: resp.status, resposta: texto.slice(0, 500) },
          { status: resp.ok ? 200 : 502 },
        );
      },
    },
  },
});
