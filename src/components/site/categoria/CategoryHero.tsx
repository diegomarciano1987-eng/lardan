import { Link } from "@tanstack/react-router";
import { mediaUrl, type CategoriaDetalhe } from "@/lib/storefront";
import { personalidade } from "./personalidade";
import { cn } from "@/lib/utils";

export function CategoryHero({ categoria }: { categoria: CategoriaDetalhe }) {
  const p = personalidade(categoria.slug);
  const imagem = mediaUrl(categoria.hero_media_id) ?? mediaUrl(categoria.fallback_media_id);

  return (
    <header className="relative overflow-hidden">
      <div className="mx-auto grid max-w-[88rem] items-center gap-12 px-6 pb-16 pt-32 md:min-h-[78vh] md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:gap-20 md:pb-24 md:pt-44">
        <div className="max-w-xl">
          <nav aria-label="Trilha de navegação" className="mb-8">
            <ol className="flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.28em] text-muted-foreground">
              <li>
                <Link to="/" className="transition-colors hover:text-foreground">
                  Lardan
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <Link to="/semijoias" className="transition-colors hover:text-foreground">
                  Semijoias
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-foreground">
                {categoria.name}
              </li>
            </ol>
          </nav>

          <h1 className="font-display text-5xl leading-[1.05] text-foreground md:text-7xl">
            {categoria.name}
          </h1>
          <p className="mt-6 font-display text-2xl leading-snug text-foreground/70 md:text-3xl">
            {p.frase}
          </p>
          {categoria.description ? (
            <p className="mt-6 max-w-prose text-base leading-relaxed text-muted-foreground">
              {categoria.description}
            </p>
          ) : null}
          <div className="rose-rule mt-10 w-24" />
          <p className="mt-6 text-[0.7rem] uppercase tracking-[0.3em] text-muted-foreground">
            {categoria.total === 1 ? "1 peça publicada" : `${categoria.total} peças publicadas`}
          </p>
        </div>

        <div className="relative">
          <div
            className={cn(
              "relative overflow-hidden bg-[color-mix(in_oklab,var(--muted)_50%,transparent)]",
              p.moldura === "rounded-full" ? "rounded-[3rem]" : p.moldura,
            )}
            style={{ aspectRatio: p.proporcaoDestaque }}
          >
            {imagem ? (
              <img
                src={imagem}
                alt={
                  categoria.hero_alt?.trim() || `Semijoias Lardan da categoria ${categoria.name}`
                }
                loading="eager"
                fetchPriority="high"
                decoding="sync"
                sizes="(max-width: 768px) 92vw, 60vw"
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center text-[0.65rem] uppercase tracking-[0.3em] text-muted-foreground">
                Nova composição em breve
              </div>
            )}
            <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-[color-mix(in_oklab,var(--rose)_18%,transparent)]" />
          </div>
        </div>
      </div>

      <p className="mx-auto max-w-[88rem] px-6 pb-10 text-[0.65rem] uppercase tracking-[0.34em] text-muted-foreground">
        {p.nota}
      </p>
    </header>
  );
}
