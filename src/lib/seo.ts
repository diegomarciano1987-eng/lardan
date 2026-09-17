// Imagem oficial de compartilhamento (1200x630) com a logo LARDAN.
import ogAsset from "@/assets/lardan-og.jpg.asset.json";
// Logo oficial da identidade (não é fotografia editorial) — usada em Organization.logo.
import logoAsset from "@/assets/lardan-logo-completa.png.asset.json";
import { INSTAGRAM_URL } from "@/lib/brand";
import { DANIEL, EMPRESA, ENDERECO, LARISSA } from "@/lib/institucional";

/**
 * Configuração central de URL do site — FONTE ÚNICA DE VERDADE.
 * robots.txt, llms.txt, sitemap, canonicals e schemas derivam daqui.
 */
export const SITE_URL = "https://www.lardan.com.br";

export const SITE_NAME = "LARDAN";

/** Imagem social padrão, nas dimensões reais do ativo. */
export const OG_IMAGE = {
  url: `${SITE_URL}${ogAsset.url}`,
  width: 1200,
  height: 630,
  alt: "LARDAN — semijoias brasileiras",
} as const;

/** Logo oficial da marca (identidade), separada da imagem social. */
export const LOGO_URL = `${SITE_URL}${logoAsset.url}`;

/** Converte um caminho interno em URL absoluta canônica. */
export function abs(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export interface ImagemSocial {
  url: string;
  width?: number | undefined;
  height?: number | undefined;
  alt?: string | undefined;
}

/**
 * Tags de imagem social. Dimensões só são publicadas quando conhecidas de
 * verdade — nunca 1200x630 "por padrão" sobre uma imagem de outro tamanho.
 */
export function ogImageMeta(imagem?: string | ImagemSocial | null) {
  const bruto: ImagemSocial =
    typeof imagem === "string" ? { url: imagem } : (imagem ?? OG_IMAGE);
  const usarPadrao = !bruto.url || !/^https?:\/\//.test(bruto.url);
  const img: ImagemSocial = usarPadrao ? OG_IMAGE : bruto;

  const tags: { property?: string; name?: string; content: string }[] = [
    { property: "og:image", content: img.url },
  ];
  if (img.width && img.height) {
    tags.push({ property: "og:image:width", content: String(img.width) });
    tags.push({ property: "og:image:height", content: String(img.height) });
  }
  if (img.alt) tags.push({ property: "og:image:alt", content: img.alt });
  tags.push({ name: "twitter:image", content: img.url });
  if (img.alt) tags.push({ name: "twitter:image:alt", content: img.alt });
  return tags;
}

/** Bloco completo de metadados de uma página pública. */
export function pageMeta(opts: {
  title: string;
  description: string;
  path: string;
  type?: string;
  image?: string | ImagemSocial | null;
}) {
  const url = abs(opts.path);
  return [
    { title: opts.title },
    { name: "description", content: opts.description },
    { property: "og:title", content: opts.title },
    { property: "og:description", content: opts.description },
    { property: "og:type", content: opts.type ?? "website" },
    { property: "og:url", content: url },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:locale", content: "pt_BR" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: opts.title },
    { name: "twitter:description", content: opts.description },
    ...ogImageMeta(opts.image ?? null),
  ];
}

/** Link canônico absoluto (usar somente em rotas folha). */
export function canonical(path: string) {
  return [{ rel: "canonical", href: abs(path) }];
}

type Json = Record<string, unknown>;

export function jsonLdScript(data: Json | Json[]) {
  return { type: "application/ld+json", children: JSON.stringify(data) };
}

/**
 * Organization com apenas informações confirmadas.
 * sameAs lista somente a rede oficial da marca.
 * TODO (dados reais do cliente): telefone/e-mail de contato — não preencher
 * com suposições.
 */
export function organizationLd(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: "Lardan",
    alternateName: "Lardan Semijoias",
    legalName: EMPRESA.razaoSocial,
    taxID: EMPRESA.cnpj,
    url: SITE_URL,
    logo: LOGO_URL,
    image: OG_IMAGE.url,
    sameAs: [INSTAGRAM_URL],
    foundingDate: EMPRESA.anoFundacao,
    address: {
      "@type": "PostalAddress",
      streetAddress: ENDERECO.logradouro,
      addressLocality: ENDERECO.cidade,
      addressRegion: ENDERECO.uf,
      postalCode: ENDERECO.cep,
      addressCountry: "BR",
    },
    areaServed: [
      { "@type": "State", name: "Paraná" },
      { "@type": "State", name: "São Paulo" },
    ],
    founder: [{ "@id": `${SITE_URL}/#daniel` }, { "@id": `${SITE_URL}/#larissa` }],
    description:
      "Marca brasileira de semijoias que conecta produtos, clientes, consultoras e tecnologia em um ecossistema comercial próprio.",
  };
}

/** Fundadores. Somente atributos confirmados oficialmente. */
export function foundersLd(): Json[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Person",
      "@id": `${SITE_URL}/#daniel`,
      name: DANIEL.nome,
      jobTitle: DANIEL.cargo,
      worksFor: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@context": "https://schema.org",
      "@type": "Person",
      "@id": `${SITE_URL}/#larissa`,
      name: LARISSA.nome,
      jobTitle: LARISSA.cargo,
      worksFor: { "@id": `${SITE_URL}/#organization` },
    },
  ];
}

export function webSiteLd(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: SITE_URL,
    inLanguage: "pt-BR",
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

export function webPageLd(opts: { path: string; name: string; description: string }): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${abs(opts.path)}#webpage`,
    url: abs(opts.path),
    name: opts.name,
    description: opts.description,
    inLanguage: "pt-BR",
    isPartOf: { "@id": `${SITE_URL}/#website` },
    about: { "@id": `${SITE_URL}/#organization` },
  };
}

export function breadcrumbLd(items: { name: string; path: string }[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: abs(item.path),
    })),
  };
}

export function faqLd(perguntas: { pergunta: string; resposta: string }[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: perguntas.map((p) => ({
      "@type": "Question",
      name: p.pergunta,
      acceptedAnswer: { "@type": "Answer", text: p.resposta },
    })),
  };
}

/** Article de um guia editorial. Autor sempre referencia o mesmo @id do Daniel. */
export function articleLd(opts: {
  path: string;
  headline: string;
  description: string;
  datePublished: string;
  dateModified: string;
  image?: string | null;
  section?: string;
  citations?: string[];
}): Json {
  const url = abs(opts.path);
  const data: Json = {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${url}#article`,
    headline: opts.headline,
    description: opts.description,
    url,
    mainEntityOfPage: { "@id": `${url}#webpage` },
    datePublished: opts.datePublished,
    dateModified: opts.dateModified,
    inLanguage: "pt-BR",
    author: { "@id": `${SITE_URL}/#daniel` },
    publisher: { "@id": `${SITE_URL}/#organization` },
    about: { "@id": `${SITE_URL}/#organization` },
    image: opts.image && /^https?:\/\//.test(opts.image) ? opts.image : OG_IMAGE.url,
  };
  if (opts.section) data["articleSection"] = opts.section;
  const externas = (opts.citations ?? []).filter((u) => /^https?:\/\//.test(u));
  if (externas.length > 0) data["citation"] = externas;
  return data;
}

/** CollectionPage de uma categoria pública. */
export function collectionPageLd(opts: {
  path: string;
  name: string;
  description: string;
  itemListId?: string;
}): Json {
  const url = abs(opts.path);
  const data: Json = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#webpage`,
    url,
    name: opts.name,
    description: opts.description,
    inLanguage: "pt-BR",
    isPartOf: { "@id": `${SITE_URL}/#website` },
    about: { "@id": `${SITE_URL}/#organization` },
  };
  if (opts.itemListId) data["mainEntity"] = { "@id": opts.itemListId };
  return data;
}

/** ItemList com URLs SEMPRE absolutas. */
export function itemListLd(opts: {
  path: string;
  name: string;
  itens: { name: string; path: string; image?: string | null }[];
}): Json {
  const url = abs(opts.path);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${url}#itemlist`,
    name: opts.name,
    numberOfItems: opts.itens.length,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    itemListElement: opts.itens.map((item, i) => {
      const produto: Json = {
        "@type": "Product",
        name: item.name,
        url: abs(item.path),
      };
      if (item.image) produto["image"] = abs(item.image);
      return { "@type": "ListItem", position: i + 1, item: produto };
    }),
  };
}

/**
 * Product de uma peça publicada. Somente dados reais.
 * Nunca emite rating, review, GTIN, MPN, SKU ou availability inventados.
 */
export function productLd(opts: {
  path: string;
  name: string;
  description?: string | null;
  images?: string[];
  material?: string | null;
  color?: string | null;
  priceCents?: number | null;
}): Json {
  const url = abs(opts.path);
  const data: Json = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    name: opts.name,
    url,
    brand: { "@type": "Brand", name: "Lardan" },
  };
  const desc = opts.description?.trim();
  if (desc) data["description"] = desc;
  const imgs = (opts.images ?? []).filter(Boolean).map((i) => abs(i));
  if (imgs.length > 0) data["image"] = imgs;
  if (opts.material?.trim()) data["material"] = opts.material.trim();
  if (opts.color?.trim()) data["color"] = opts.color.trim();
  if (opts.priceCents != null && opts.priceCents > 0) {
    data["offers"] = {
      "@type": "Offer",
      price: (opts.priceCents / 100).toFixed(2),
      priceCurrency: "BRL",
      url,
      seller: { "@id": `${SITE_URL}/#organization` },
    };
  }
  return data;
}
