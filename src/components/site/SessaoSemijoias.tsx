import { Link } from "@tanstack/react-router";
import { BRAND } from "@/lib/brand";
import { useScrollProgress, phase, ease, easeOut } from "@/hooks/use-scroll-progress";
import sessao2Asset from "@/assets/lardan-sessao2.png.asset.json";

const SLATS = 14;

/**
 * Segunda sessão (V/4.2) — revelação em lâminas de vidro.
 * A imagem entra atrás de 14 lâminas verticais marfim que se retraem do centro
 * para as bordas, em cascata, enquanto a própria imagem recua do zoom.
 * Depois, o texto sobe linha a linha.
 */
export function SessaoSemijoias() {
  const { ref, progress, reduced } = useScrollProgress<HTMLDivElement>();
  const p = reduced ? 1 : progress;

  const reveal = phase(p, 0.02, 0.55);
  const imgScale = 1.28 - 0.28 * ease(phase(p, 0, 0.7));
  const lines = [0.42, 0.48, 0.54, 0.6, 0.66].map((start) =>
    easeOut(phase(p, start, start + 0.16)),
  );

  return (
    <div ref={ref} className="relative h-[260vh]">
      <section className="sticky top-0 h-screen overflow-hidden bg-background">
        <img
          src={sessao2Asset.url}
          alt="Mulher usando colar, brincos e pulseira Lardan sobre ondas de vidro"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ transform: `scale(${imgScale})` }}
          loading="lazy"
          width={1664}
          height={928}
        />

        {/* Lâminas de vidro que se retraem em cascata do centro para as bordas */}
        <div aria-hidden className="pointer-events-none absolute inset-0 flex">
          {Array.from({ length: SLATS }).map((_, i) => {
            const fromCenter = Math.abs(i - (SLATS - 1) / 2) / ((SLATS - 1) / 2);
            const start = 0.06 * (1 - fromCenter);
            const t = easeOut(phase(reveal, start, start + 0.9));
            return (
              <div
                key={i}
                className="h-full flex-1 origin-top bg-background"
                style={{
                  transform: `scaleY(${1 - t}) translateY(${t * -6}%)`,
                  opacity: 1 - t * 0.15,
                }}
              />
            );
          })}
        </div>

        {/* Leitura do texto sobre a imagem */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, oklch(0.985 0.006 80 / 0.92) 0%, oklch(0.985 0.006 80 / 0.6) 38%, transparent 62%)",
            opacity: lines[0],
          }}
        />

        <div className="relative flex h-full max-w-6xl flex-col justify-center px-6 md:px-10 lg:mx-auto">
          <div className="max-w-xl">
            <p
              className="brand-eyebrow mb-4"
              style={{ opacity: lines[0], transform: `translateY(${(1 - lines[0]) * 18}px)` }}
            >
              Semijoias
            </p>
            <h2
              className="text-4xl leading-tight text-foreground md:text-6xl"
              style={{ opacity: lines[1], transform: `translateY(${(1 - lines[1]) * 22}px)` }}
            >
              {BRAND.tagline}
            </h2>
            <div
              className="rose-rule mt-6 w-20"
              style={{ transform: `scaleX(${lines[2]})`, transformOrigin: "left" }}
            />
            <p
              className="mt-6 max-w-md text-base text-muted-foreground md:text-lg"
              style={{ opacity: lines[3], transform: `translateY(${(1 - lines[3]) * 18}px)` }}
            >
              {BRAND.subline}
            </p>
            <Link
              to="/semijoias"
              className="mt-10 inline-flex items-center border-b border-primary/50 pb-2 text-[0.75rem] tracking-[0.22em] uppercase text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              style={{ opacity: lines[4], transform: `translateY(${(1 - lines[4]) * 18}px)` }}
              tabIndex={lines[4] > 0.5 ? 0 : -1}
            >
              Conhecer semijoias
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
