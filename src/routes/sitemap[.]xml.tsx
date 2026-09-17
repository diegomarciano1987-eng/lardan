import { createFileRoute } from "@tanstack/react-router";
import { CABECALHOS_XML, contarArquivosProdutos, xmlIndex } from "@/lib/sitemap";

/** Índice de sitemaps: páginas + catálogo paginado (escala para milhares de peças). */
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const arquivos = await contarArquivosProdutos();
        const caminhos = ["/sitemap-pages.xml"];
        for (let i = 1; i <= arquivos; i += 1) caminhos.push(`/sitemap-products/${i}.xml`);
        return new Response(xmlIndex(caminhos), { headers: CABECALHOS_XML });
      },
    },
  },
});
