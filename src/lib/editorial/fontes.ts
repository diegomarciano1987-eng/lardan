/**
 * Fontes externas usadas nos guias. Somente referências reais e verificáveis.
 * Nenhum volume de busca é publicado (não foi confirmado por exportação oficial).
 */

export interface Fonte {
  chave: string;
  instituicao: string;
  titulo: string;
  ano: string;
  url: string;
}

export const FONTES: Record<string, Fonte> = {
  ibge_conta_propria: {
    chave: "ibge_conta_propria",
    instituicao: "IBGE",
    titulo: "Desocupação cai para 5,1% em dezembro e 2025 tem melhores resultados da série histórica",
    ano: "2025",
    url: "https://agenciadenoticias.ibge.gov.br/agencia-noticias/2012-agencia-de-noticias/noticias/45761-desocupacao-cai-para-5-1-em-dezembro-e-2025-tem-melhores-resultados-da-serie-historica",
  },
  ibge_mulheres: {
    chave: "ibge_mulheres",
    instituicao: "IBGE",
    titulo:
      "Em 2025, vinte unidades da federação registram a menor taxa de desocupação da série",
    ano: "2025",
    url: "https://agenciadenoticias.ibge.gov.br/agencia-noticias/2012-agencia-de-noticias/noticias/45923-em-2025-vinte-unidades-da-federacao-registram-a-menor-taxa-de-desocupacao-da-serie",
  },
  datareportal: {
    chave: "datareportal",
    instituicao: "DataReportal",
    titulo: "Digital 2026: Brazil",
    ano: "2026",
    url: "https://datareportal.com/reports/digital-2026-brazil",
  },
  portal_empreendedor: {
    chave: "portal_empreendedor",
    instituicao: "Governo Federal",
    titulo: "Portal do Empreendedor (MEI): orientações oficiais de formalização",
    ano: "2026",
    url: "https://www.gov.br/empresas-e-negocios/pt-br/empreendedor",
  },
  lardan_institucional: {
    chave: "lardan_institucional",
    instituicao: "Lardan",
    titulo: "A Lardan: história, fundadores, qualidade e garantia",
    ano: "2026",
    url: "/a-lardan",
  },
  lardan_seja: {
    chave: "lardan_seja",
    instituicao: "Lardan",
    titulo: "Seja Lardan: como funciona ser Consultora Lardan",
    ano: "2026",
    url: "/seja-lardan",
  },
};

export function fontesDe(chaves: string[]): Fonte[] {
  return chaves.map((c) => FONTES[c]).filter((f): f is Fonte => Boolean(f));
}
