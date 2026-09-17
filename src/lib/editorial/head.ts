/** Metadados e JSON-LD de um guia editorial (fonte única para as quatro rotas). */
import {
  abs,
  articleLd,
  breadcrumbLd,
  canonical,
  faqLd,
  jsonLdScript,
  organizationLd,
  pageMeta,
  webPageLd,
} from "@/lib/seo";
import { foundersLd } from "@/lib/seo";
import { FONTES } from "./fontes";
import { IMAGENS_EDITORIAIS } from "./imagens";
import type { Guia } from "./tipos";

export function headDoGuia(guia: Guia) {
  const imagem = IMAGENS_EDITORIAIS[guia.imagem];
  const imagemAbsoluta = imagem ? abs(imagem.url) : null;
  const daniel = foundersLd()[0]!;

  return {
    meta: pageMeta({
      title: guia.title,
      description: guia.description,
      path: guia.path,
      type: "article",
      image: imagemAbsoluta,
    }),
    links: canonical(guia.path),
    scripts: [
      jsonLdScript([
        organizationLd(),
        daniel,
        webPageLd({ path: guia.path, name: guia.title, description: guia.description }),
        articleLd({
          path: guia.path,
          headline: guia.h1,
          description: guia.description,
          datePublished: guia.publicadoEm,
          dateModified: guia.atualizadoEm,
          image: imagemAbsoluta,
          section: "Guias Lardan",
          citations: guia.fontes
            .map((c) => FONTES[c]?.url)
            .filter((u): u is string => Boolean(u && u.startsWith("http"))),
        }),
        breadcrumbLd([
          { name: "Lardan", path: "/" },
          { name: guia.h1, path: guia.path },
        ]),
        faqLd(guia.faq),
      ]),
    ],
  };
}
