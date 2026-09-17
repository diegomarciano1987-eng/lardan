import type { Retrato } from "./RetratoOficial";
import { ALT_CASAL, DANIEL, LARISSA } from "@/lib/institucional";
import fotoCasal from "@/assets/lardan-daniel-larissa.webp.asset.json";

/**
 * SLOTS DE FOTOGRAFIA OFICIAL.
 *
 * Quando a marca enviar as fotos, basta trocar `src` (e width/height) aqui.
 * Nenhum componente precisa ser alterado.
 */

/** Retrato individual de Daniel. Pendente de foto oficial. */
export const danielPortrait: Retrato = {
  src: null,
  alt: DANIEL.alt,
};

/** Retrato individual de Larissa. Pendente de foto oficial. */
export const larissaPortrait: Retrato = {
  src: null,
  alt: LARISSA.alt,
};

/** Fotografia do casal (já fornecida pela marca). */
export const danielLarissaPortrait: Retrato = {
  src: fotoCasal.url,
  alt: ALT_CASAL,
  width: 1200,
  height: 1292,
};
