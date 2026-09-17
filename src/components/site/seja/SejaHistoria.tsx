import { Link } from "@tanstack/react-router";
import { HISTORIA_RESUMO } from "@/lib/institucional";
import { RetratoOficial } from "@/components/site/RetratoOficial";
import { danielLarissaPortrait } from "@/components/site/retratos";

/**
 * /seja-lardan — resumo emocional da origem da Lardan.
 *
 * Deriva exclusivamente dos fatos oficiais. Não repete as biografias completas
 * (isso vive na Home e em /a-lardan) para não duplicar conteúdo.
 * Layout intencionalmente diferente do da Home: mais humano, foto do casal.
 */
export function SejaHistoria() {
  return (
    <section
      id="nossa-historia"
      aria-labelledby="seja-historia-titulo"
      className="scroll-mt-24 border-t border-border"
    >
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-24 md:grid-cols-[0.9fr_1.1fr] md:gap-16 md:py-32">
        <RetratoOficial
          retrato={danielLarissaPortrait}
          rotulo="Foto oficial de Daniel e Larissa"
        />

        <div className="max-w-prose">
          <p className="brand-eyebrow mb-4">Nossa origem</p>
          <h2 id="seja-historia-titulo" className="text-3xl leading-tight text-foreground md:text-5xl">
            {HISTORIA_RESUMO.titulo}
          </h2>
          <div className="rose-rule mt-8 w-20" />
          <div className="mt-8 space-y-5 text-base leading-relaxed text-muted-foreground">
            {HISTORIA_RESUMO.paragrafos.map((p) => (
              <p key={p.slice(0, 32)}>{p}</p>
            ))}
          </div>
          <Link to="/a-lardan" className="btn-premium mt-10">
            {HISTORIA_RESUMO.cta}
          </Link>
        </div>
      </div>

      {/* Transição para a estrutura já existente da página. */}
      <div className="mx-auto max-w-3xl px-6 pb-20 text-center md:pb-24">
        <p className="text-xl leading-snug text-foreground md:text-2xl">
          A história começou com pessoas. A estrutura cresceu com tecnologia.
        </p>
      </div>
    </section>
  );
}
