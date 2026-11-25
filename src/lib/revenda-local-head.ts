import type { PaginaLocal } from "./revenda-local";
import { FAQ } from "./seja-lardan-conteudo";
import { breadcrumbLd, canonical, faqLd, jsonLdScript, pageMeta, webPageLd } from "./seo";

export function localHead({ path, title, description, heading }: PaginaLocal) {
  return {
    meta: pageMeta({ path, title, description }),
    links: canonical(path),
    scripts: [jsonLdScript([
      webPageLd({ path, name: title, description }),
      breadcrumbLd([{ name: "Início", path: "/" }, { name: "Seja Lardan", path: "/seja-lardan" }, { name: heading, path }]),
      faqLd(FAQ),
    ])],
  };
}
