import { paginasLocais, type PaginaLocal } from "@/lib/revenda-local";
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
import { DepoimentoDenise } from "@/components/site/seja/DepoimentoDenise";
import { DepoimentoGrazi } from "@/components/site/seja/DepoimentoGrazi";
import { AvaliacoesGoogle } from "@/components/site/AvaliacoesGoogle";

export function SejaLardanPage({ local }: { local?: PaginaLocal | undefined }) {
  useEffect(() => {
    if (window.location.hash !== "#inicio") return;

    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <SiteLayout>
      <SejaHero local={local} />
      <DepoimentoDenise />
      <DepoimentoGrazi />
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
      {!local && (
        <nav aria-label="Revenda por cidade" className="mx-auto max-w-6xl px-6 py-12">
          <h2 className="mb-4 font-display text-2xl">Onde revender com a Lardan</h2>
          <ul className="flex flex-wrap gap-x-6 gap-y-3">
            {paginasLocais.map((pagina) => (
              <li key={pagina.path}><a href={pagina.path} className="underline">{pagina.heading}</a></li>
            ))}
          </ul>
        </nav>
      )}
    </SiteLayout>
  );
}
