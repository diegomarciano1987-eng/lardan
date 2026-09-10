// Imagem oficial de compartilhamento (1200x630) com a logo LARDAN.
import ogAsset from "@/assets/lardan-og.jpg.asset.json";

export const SITE_URL = "https://lardan.lovable.app";

export const OG_IMAGE = `${SITE_URL}${ogAsset.url}`;

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
