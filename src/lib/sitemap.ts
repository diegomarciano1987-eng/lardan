/**
 * LARDAN — construção do sitemap a partir da MESMA fonte de verdade de domínio.
 *
 * Regras: URLs canônicas públicas; categorias publicadas entram mesmo sem peças.
 * <lastmod> só aparece quando existe data verdadeira.
 */
import { SITE_URL } from "@/lib/seo";
import { GUIAS } from "@/lib/editorial";
import { listPublicCategories, listPublicProducts } from "@/lib/storefront";

/** Limite do protocolo é 50.000; usamos 5.000 por arquivo para leveza. */
export const POR_SITEMAP = 5000;
/** Leitura paginada do catálogo: nunca uma consulta única gigantesca. */
const LOTE = 500;

export interface UrlSitemap {
  loc: string;
  lastmod?: string | undefined;
  changefreq?: string | undefined;
  priority?: string | undefined;
}

export function xmlUrlset(urls: UrlSitemap[]): string {
  const linhas = urls.map((u) => {
    const partes = [`    <loc>${SITE_URL}${u.loc}</loc>`];
    if (u.lastmod) partes.push(`    <lastmod>${u.lastmod}</lastmod>`);
    if (u.changefreq) partes.push(`    <changefreq>${u.changefreq}</changefreq>`);
    if (u.priority) partes.push(`    <priority>${u.priority}</priority>`);
    return `  <url>\n${partes.join("\n")}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${linhas.join("\n")}\n</urlset>\n`;
}

export function xmlIndex(caminhos: string[]): string {
  const linhas = caminhos.map((c) => `  <sitemap>\n    <loc>${SITE_URL}${c}</loc>\n  </sitemap>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${linhas.join("\n")}\n</sitemapindex>\n`;
}

export const CABECALHOS_XML = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=300, s-maxage=3600",
};

/** Páginas institucionais sempre publicadas. /colecoes fica fora: sem conteúdo real. */
const ESTATICAS: UrlSitemap[] = [
  { loc: "/" },
  { loc: "/seja-lardan" },
  { loc: "/a-lardan" },
  { loc: "/semijoias" },
  { loc: "/contato" },
  { loc: "/privacidade", lastmod: "2026-10-05" },
];

/** Páginas fixas + guias (com data editorial real) + todas as categorias publicadas. */
export async function urlsPaginas(): Promise<UrlSitemap[]> {
  const urls: UrlSitemap[] = [...ESTATICAS];

  for (const g of GUIAS) {
    urls.push({
      loc: g.path,
      lastmod: g.atualizadoEm,
    });
  }

  const categorias = await listPublicCategories();
  for (const c of categorias) {
    urls.push({ loc: `/semijoias/${c.slug}` });
  }

  return urls;
}

/** Lê TODOS os produtos publicados, em lotes — suporta milhares de peças. */
export async function slugsProdutos(): Promise<string[]> {
  const slugs: string[] = [];
  let pagina = 0;
  let total = Infinity;
  while (slugs.length < total) {
    const lote = await listPublicProducts({ pagina, porPagina: LOTE });
    total = lote.total;
    if (lote.rows.length === 0) {
      if (slugs.length < total) throw new Error("Catálogo incompleto no sitemap");
      break;
    }
    for (const p of lote.rows) if (p.slug) slugs.push(p.slug);
    pagina += 1;
    if (pagina > 200 && slugs.length < total) throw new Error("Limite de leitura do sitemap excedido");
  }
  return slugs;
}

export async function contarArquivosProdutos(): Promise<number> {
  const { total } = await listPublicProducts({ pagina: 0, porPagina: 1 });
  return Math.max(1, Math.ceil(total / POR_SITEMAP));
}
