import type { Guia } from "./tipos";
import { GUIA_RENDA_EXTRA } from "./guia-renda-extra";
import { GUIA_COMECAR_VENDER } from "./guia-comecar-vender";
import { GUIA_CONSIGNADO } from "./guia-consignado";
import { GUIA_WHATSAPP } from "./guia-whatsapp";
import { GUIA_PERGUNTAS_REVENDA } from "./guia-perguntas-revenda";
import { GUIA_CUIDADOS } from "./guia-cuidados";
import { GUIA_SEMIJOIA_BIJUTERIA } from "./guia-semijoia-folheado-bijuteria";

export * from "./tipos";
export * from "./fontes";
export * from "./imagens";
export * from "./rotas";

/** Guias para quem quer revender (os 4 originais). */
const GUIAS_CONSULTORA: Guia[] = [
  GUIA_RENDA_EXTRA,
  GUIA_COMECAR_VENDER,
  GUIA_CONSIGNADO,
  GUIA_WHATSAPP,
];

/** Todos os guias publicados (sitemap e llms.txt). */
export const GUIAS: Guia[] = [
  ...GUIAS_CONSULTORA,
  GUIA_PERGUNTAS_REVENDA,
  GUIA_CUIDADOS,
  GUIA_SEMIJOIA_BIJUTERIA,
];

export {
  GUIA_RENDA_EXTRA,
  GUIA_COMECAR_VENDER,
  GUIA_CONSIGNADO,
  GUIA_WHATSAPP,
  GUIA_PERGUNTAS_REVENDA,
  GUIA_CUIDADOS,
  GUIA_SEMIJOIA_BIJUTERIA,
};

/**
 * Resumo usado na Seja Lardan e no painel de candidaturas.
 * Continua restrito aos 4 guias de consultora: a seção da Seja Lardan não muda.
 */
export const GUIAS_RESUMO = GUIAS_CONSULTORA.map((g) => ({
  path: g.path,
  titulo: g.h1,
  rotulo: g.slug === "renda-extra-com-vendas"
    ? "Renda extra com vendas"
    : g.slug === "como-comecar-a-vender-semijoias"
      ? "Como começar a vender semijoias"
      : g.slug === "semijoias-consignadas-para-revenda"
        ? "Semijoias consignadas"
        : "Vendas pelo WhatsApp",
  description: g.description,
}));
