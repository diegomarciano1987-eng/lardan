import { createFileRoute } from "@tanstack/react-router";
import { CABECALHOS_XML, POR_SITEMAP, slugsProdutos, xmlUrlset } from "@/lib/sitemap";

/** /sitemap-products/1.xml, /sitemap-products/2.xml, ... */
export const Route = createFileRoute("/sitemap-products/$pagina")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const n = Math.max(1, Number.parseInt(params.pagina.replace(/\.xml$/, ""), 10) || 1);
        const todos = await slugsProdutos();
        const fatia = todos.slice((n - 1) * POR_SITEMAP, n * POR_SITEMAP);
        if (fatia.length === 0 && n > 1) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(
          xmlUrlset(
            fatia.map((slug) => ({
              loc: `/produto/${slug}`,
              priority: "0.7",
              changefreq: "weekly",
            })),
          ),
          { headers: CABECALHOS_XML },
        );
      },
    },
  },
});
