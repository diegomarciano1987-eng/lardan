import type { Retrato } from "./RetratoOficial";
import { ALT_CASAL, DANIEL, LARISSA } from "@/lib/institucional";
import fotoFamilia from "@/assets/lardan-familia.webp.asset.json";
import fotoDaniel1 from "@/assets/lardan-daniel-1.webp.asset.json";
import fotoDaniel2 from "@/assets/lardan-daniel-2.webp.asset.json";
import fotoLarissa1 from "@/assets/lardan-larissa-1.webp.asset.json";
import fotoLarissa2 from "@/assets/lardan-larissa-2.webp.asset.json";

/**
 * SLOTS DE FOTOGRAFIA OFICIAL.
 *
 * Fotos enviadas pela marca. Para trocar, basta atualizar `src`
 * (e width/height) aqui: nenhum componente precisa ser alterado.
 */

const RETRATO = { width: 1122, height: 1402 } as const;

/** Retrato de Daniel usado na página inicial. */
export const danielPortrait: Retrato = {
  src: fotoDaniel1.url,
  alt: DANIEL.alt,
  ...RETRATO,
};

/** Retrato de Daniel usado na página institucional. */
export const danielPortraitInstitucional: Retrato = {
  src: fotoDaniel2.url,
  alt: DANIEL.alt,
  ...RETRATO,
};

/** Retrato de Larissa usado na página inicial. */
export const larissaPortrait: Retrato = {
  src: fotoLarissa1.url,
  alt: LARISSA.alt,
  ...RETRATO,
};

/** Retrato de Larissa usado em Seja Lardan e na página institucional. */
export const larissaPortraitSeja: Retrato = {
  src: fotoLarissa2.url,
  alt: LARISSA.alt,
  ...RETRATO,
};

/** Fotografia oficial da família, fornecida pela marca. */
export const danielLarissaPortrait: Retrato = {
  src: fotoFamilia.url,
  alt: `${ALT_CASAL}, com os filhos`,
  width: 1600,
  height: 1066,
};
