import type { Guia } from "./tipos";
import { GUIA_RENDA_EXTRA } from "./guia-renda-extra";
import { GUIA_COMECAR_VENDER } from "./guia-comecar-vender";
import { GUIA_CONSIGNADO } from "./guia-consignado";
import { GUIA_WHATSAPP } from "./guia-whatsapp";

export * from "./tipos";
export * from "./fontes";
export * from "./imagens";
export * from "./rotas";

export const GUIAS: Guia[] = [
  GUIA_RENDA_EXTRA,
  GUIA_COMECAR_VENDER,
  GUIA_CONSIGNADO,
  GUIA_WHATSAPP,
];

export { GUIA_RENDA_EXTRA, GUIA_COMECAR_VENDER, GUIA_CONSIGNADO, GUIA_WHATSAPP };

/** Resumo usado em rodapé, Seja Lardan e Home. */
export const GUIAS_RESUMO = GUIAS.map((g) => ({
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
