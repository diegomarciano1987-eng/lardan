import { createFileRoute } from "@tanstack/react-router";
import { SITE_URL } from "@/lib/seo";

/** Rotas públicas estáticas indexáveis. Privadas (/acesso, /admin) ficam fora. */
const ESTATICAS = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
  { path: "/seja-lardan", priority: "0.9", changefreq: "weekly" },
  { path: "/a-lardan", priority: "0.7", changefreq: "monthly" },
  { path: "/semijoias", priority: "0.8", changefreq: "weekly" },
  { path: "/colecoes", priority: "0.7", changefreq: "monthly" },
  { path: "/contato", priority: "0.5", changefreq: "yearly" },
  // Hub editorial (guias assinados). Frequência honesta: atualização editorial.
  { path: "/renda-extra-com-vendas", priority: "0.8", changefreq: "monthly" },
  { path: "/como-comecar-a-vender-semijoias", priority: "0.8", changefreq: "monthly" },
  { path: "/semijoias-consignadas-para-revenda", priority: "0.8", changefreq: "monthly" },
  { path: "/como-vender-semijoias-pelo-whatsapp", priority: "0.8", changefreq: "monthly" },
];

function url(loc: string, priority: string, changefreq: string) {
  return `  <url>\n    <loc>${SITE_URL}${loc}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const linhas = ESTATICAS.map((r) => url(r.path, r.priority, r.changefreq));

        // Categorias e produtos publicados entram quando a leitura pública responde.
        try {
          const { listPublicCategories, listPublicProducts } = await import("@/lib/storefront");
          const [categorias, produtos] = await Promise.all([
            listPublicCategories(),
            listPublicProducts({ porPagina: 500 }),
          ]);
          for (const c of categorias) {
            linhas.push(url(`/semijoias/${c.slug}`, "0.8", "weekly"));
          }
          for (const p of produtos.rows) {
            if (p.slug) linhas.push(url(`/produto/${p.slug}`, "0.7", "weekly"));
          }
        } catch {
          // catálogo indisponível: o sitemap continua válido com as rotas fixas
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${linhas.join("\n")}\n</urlset>\n`;

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=300, s-maxage=3600",
          },
        });
      },
    },
  },
});
