import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { SejaLardanForm } from "@/components/site/SejaLardanForm";
import {
  SejaAcademy,
  SejaDefinicao,
  SejaEmocional,
  SejaFaq,
  SejaFerramentas,
  SejaHero,
  SejaPerfil,
  SejaProcesso,
  SejaProduto,
  SejaVidaReal,
} from "@/components/site/seja/SecoesSejaLardan";
import { SejaHistoria } from "@/components/site/seja/SejaHistoria";
import { SejaGuias } from "@/components/site/seja/SejaGuias";
import { CinematicTitle } from "@/components/site/seja/CinematicTitle";
import { DepoimentoBrigida } from "@/components/site/seja/DepoimentoBrigida";
import { AvaliacoesGoogle } from "@/components/site/AvaliacoesGoogle";
import { FAQ } from "@/lib/seja-lardan-conteudo";
import {
  breadcrumbLd,
  canonical,
  faqLd,
  jsonLdScript,
  pageMeta,
  webPageLd,
} from "@/lib/seo";

const TITLE = "Seja Consultora Lardan | Venda Semijoias com Tecnologia e Suporte";
const DESCRIPTION =
  "Conheça a oportunidade de ser Consultora Lardan e conte com semijoias, CRM, ferramentas de vendas, organização financeira, treinamento e suporte para desenvolver seu negócio.";

export const Route = createFileRoute("/seja-lardan")({
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

function SejaLardanPage() {
  useEffect(() => {
    if (window.location.hash !== "#inicio") return;

    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <SiteLayout>
      <SejaHero />
      <DepoimentoBrigida />
      <SejaEmocional />
      <SejaHistoria />
      <SejaDefinicao />
      <SejaFerramentas />
      <AvaliacoesGoogle unica />
      <SejaAcademy />
      <SejaProduto />
      <SejaVidaReal />
      <SejaPerfil />
      <SejaProcesso />
      <SejaGuias />

      <section
        id="candidatura"
        aria-labelledby="candidatura-titulo"
        className="scroll-mt-24 border-t border-border"
      >
        <div className="mx-auto max-w-3xl px-6 pt-20 text-center md:pt-24">
          <p className="brand-eyebrow mb-4">Candidatura</p>
          <CinematicTitle id="candidatura-titulo" className="text-3xl leading-tight text-foreground md:text-5xl">
            Conte um pouco sobre você
          </CinematicTitle>
          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
            A candidatura é registrada com um número de protocolo e analisada pela equipe Lardan.
            Não há promessa de aprovação, prazo ou renda.
          </p>
        </div>
        <div className="px-6 py-16">
          <SejaLardanForm />
        </div>
      </section>

      <SejaFaq />
    </SiteLayout>
  );
}
