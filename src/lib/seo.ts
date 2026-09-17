// Imagem oficial de compartilhamento (1200x630) com a logo LARDAN.
import ogAsset from "@/assets/lardan-og.jpg.asset.json";
import { INSTAGRAM_URL } from "@/lib/brand";
import { DANIEL, EMPRESA, ENDERECO, LARISSA } from "@/lib/institucional";

/**
 * Configuração central de URL do site.
 * Trocar aqui quando o domínio oficial entrar no ar — nenhuma URL deve ser
 * escrita à mão em outros arquivos.
 */
export const SITE_URL = "https://lardan.lovable.app";

export const SITE_NAME = "LARDAN";

export const OG_IMAGE = `${SITE_URL}${ogAsset.url}`;

/** Converte um caminho interno em URL absoluta canônica. */
export function abs(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Tags de imagem social; usa a imagem da página quando ela é absoluta. */
export function ogImageMeta(imagemAbsoluta?: string | null) {
  const url = imagemAbsoluta && /^https?:\/\//.test(imagemAbsoluta) ? imagemAbsoluta : OG_IMAGE;
  return [
    { property: "og:image", content: url },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { name: "twitter:image", content: url },
  ];
}

/** Bloco completo de metadados de uma página pública. */
export function pageMeta(opts: {
  title: string;
  description: string;
  path: string;
  type?: string;
  image?: string | null;
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
    url: SITE_URL,
    logo: OG_IMAGE,
    image: OG_IMAGE,
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
