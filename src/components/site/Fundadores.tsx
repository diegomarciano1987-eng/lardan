import { Link } from "@tanstack/react-router";
import { DANIEL, LARISSA } from "@/lib/institucional";
import { RetratoOficial } from "./RetratoOficial";
import { danielPortrait, larissaPortrait } from "./retratos";

/**
 * Seção institucional "Por trás da Lardan" (Home).
 *
 * Texto oficial da marca, sem reescrita. Composição editorial: fotografia
 * grande + texto e, na sequência, inversão (texto + fotografia).
 * As fotos individuais entram pelos slots em ./retratos.ts.
 */

function Citacao({ texto }: { texto: string }) {
  return (
    <figure className="mt-10 border-l border-primary/50 pl-6">
      <blockquote className="text-xl leading-snug text-foreground md:text-2xl">
        “{texto}”
      </blockquote>
    </figure>
  );
}

export function Fundadores() {
  return (
    <section
      aria-labelledby="por-tras-da-lardan"
      className="border-t border-border bg-background"
    >
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <header className="max-w-3xl">
          <p className="brand-eyebrow mb-4">Por trás da Lardan</p>
          <h2
            id="por-tras-da-lardan"
            className="text-3xl leading-tight text-foreground md:text-5xl"
          >
            Uma história que começou pela família e se transformou em propósito.
          </h2>
          <div className="rose-rule mt-8 w-20" />
        </header>

        {/* ------------------------------ Daniel ------------------------------ */}
        <article
          aria-labelledby="fundador-daniel"
          className="mt-20 grid gap-10 md:mt-28 md:grid-cols-2 md:gap-16"
        >
          <div className="md:sticky md:top-28 md:self-start">
            <RetratoOficial retrato={danielPortrait} rotulo="Foto oficial de Daniel" />
          </div>

          <div className="max-w-prose">
            <h3 id="fundador-daniel" className="text-2xl text-foreground md:text-3xl">
              {DANIEL.nome}
            </h3>
            <p className="brand-eyebrow mt-3 text-muted-foreground">{DANIEL.cargoCurto}</p>
            <div className="mt-8 space-y-5 text-base leading-relaxed text-muted-foreground">
              {DANIEL.paragrafos.map((p) => (
                <p key={p.slice(0, 32)}>{p}</p>
              ))}
            </div>
            <Citacao texto={DANIEL.citacao} />
          </div>
        </article>

        {/* ----------------------------- Larissa ------------------------------ */}
        <article
          aria-labelledby="cofundadora-larissa"
          className="mt-24 grid gap-10 md:mt-32 md:grid-cols-2 md:gap-16"
        >
          <div className="max-w-prose md:order-2 md:sticky md:top-28 md:self-start">
            <RetratoOficial retrato={larissaPortrait} rotulo="Foto oficial de Larissa" />
          </div>

          <div className="max-w-prose md:order-1">
            <h3 id="cofundadora-larissa" className="text-2xl text-foreground md:text-3xl">
              {LARISSA.nome}
            </h3>
            <p className="brand-eyebrow mt-3 text-muted-foreground">{LARISSA.cargoCurto}</p>
            <div className="mt-8 space-y-5 text-base leading-relaxed text-muted-foreground">
              {LARISSA.paragrafos.map((p) => (
                <p key={p.slice(0, 32)}>{p}</p>
              ))}
            </div>
            <Citacao texto={LARISSA.citacao} />
          </div>
        </article>
      </div>
    </section>
  );
}
