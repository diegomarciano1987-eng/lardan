import { createFileRoute, redirect } from "@tanstack/react-router";
import { SejaLardanPage } from "@/components/site/seja/SejaLardanPage";
import { FAQ } from "@/lib/seja-lardan-conteudo";
import {
  breadcrumbLd,
  canonical,
  faqLd,
  jsonLdScript,
  pageMeta,
  webPageLd,
} from "@/lib/seo";

const TITLE = "Seja revendedora Lardan Semijoias: como funciona";
const DESCRIPTION =
  "Conheça a oportunidade de ser Consultora Lardan e conte com semijoias, CRM, ferramentas de vendas, organização financeira, treinamento e suporte para desenvolver seu negócio.";

export const Route = createFileRoute("/seja-lardan")({
  // Links antigos de indicação (?indica=) vão para a página exclusiva de cadastro.
  beforeLoad: ({ location }) => {
    const c = (location.search as Record<string, unknown>)["indica"];
    if (typeof c === "string" && /^[a-z0-9]{4,20}$/i.test(c)) {
      throw redirect({ to: "/indicacao/$codigo", params: { codigo: c.toLowerCase() } });
    }
  },
  component: SejaLardanPage,
  head: () => ({
    meta: pageMeta({ title: TITLE, description: DESCRIPTION, path: "/seja-lardan" }),
    links: canonical("/seja-lardan"),
    scripts: [
      jsonLdScript([
        webPageLd({ path: "/seja-lardan", name: TITLE, description: DESCRIPTION }),
        breadcrumbLd([
          { name: "Início", path: "/" },
          { name: "Seja Lardan", path: "/seja-lardan" },
        ]),
        faqLd(FAQ),
      ]),
    ],
  }),
});

