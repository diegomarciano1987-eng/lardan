import { Link } from "@tanstack/react-router";
import { BRAND } from "@/lib/brand";
import {
  useScrollProgress,
  useDeviceTier,
  phase,
  ease,
  easeOut,
} from "@/hooks/use-scroll-progress";
import sessao2Asset from "@/assets/lardan-sessao2.png.asset.json";
import sessao2MobileAsset from "@/assets/lardan-mobile-sessao2.png.asset.json";

/**
 * Segunda sessão (V/4.2) — revelação em lâminas de vidro.
 * A imagem entra atrás de lâminas verticais marfim que se retraem do centro
 * para as bordas, em cascata, enquanto a própria imagem recua do zoom.
 * Depois, o texto sobe linha a linha.
 */
export function SessaoSemijoias() {
  const { ref, progress, reduced } = useScrollProgress<HTMLDivElement>();
  const tier = useDeviceTier();
  const leve = tier === "leve";
  const slats = leve ? 8 : 18;
  const p = reduced ? 1 : progress;

  const reveal = phase(p, 0.02, 0.55);
  const imgScale = 1.28 - 0.28 * ease(phase(p, 0, 0.7));
  // Desfoque da foto que se dissolve conforme as lâminas se retraem (só desktop).
  const imgBlur = leve ? 0 : Math.round((1 - ease(phase(p, 0, 0.5))) * 8);
  const line = (start: number) => easeOut(phase(p, start, start + 0.16));
  const lines = [line(0.42), line(0.48), line(0.54), line(0.6), line(0.66)] as const;
  const emMovimento = reveal > 0.001 && reveal < 0.999;
  // Continuidade com o hero: a sessão começa na mesma penumbra em que o
  // quadro anterior terminou e ganha luz conforme as lâminas abrem.
  const penumbra = reduced ? 0 : 1 - ease(phase(p, 0, 0.42));

  return (
    <div ref={ref} className="relative h-[260vh]">
      <section className="sticky top-0 h-screen overflow-hidden bg-background">
        <picture>
          <source
            media="(max-width: 767px)"
            srcSet="/img/lardan-mobile-sessao2.webp"
            type="image/webp"
          />
          <source media="(max-width: 767px)" srcSet={sessao2MobileAsset.url} />
          <source srcSet="/img/lardan-sessao2.webp" type="image/webp" />
          <img
            src={sessao2Asset.url}
            alt="Mulher usando colar, brincos e pulseira Lardan sobre ondas de vidro"
            className="gpu-layer absolute inset-0 h-full w-full object-cover"
            style={{
              transform: `scale(${imgScale}) translateZ(0)`,
              filter: imgBlur > 0 ? `blur(${imgBlur}px)` : undefined,
            }}
            loading="lazy"
            decoding="async"
            width={1664}
            height={928}
          />
        </picture>

        {/* Lâminas de vidro que se retraem em cascata do centro para as bordas.
            No desktop ganham borda esfumaçada e fio de luz no topo; em
            aparelhos fracos, só transform/opacidade para não travar a rolagem. */}
        {reveal < 0.999 && (
          <div aria-hidden className="pointer-events-none absolute inset-0 flex">
            {Array.from({ length: slats }).map((_, i) => {
              const fromCenter = Math.abs(i - (slats - 1) / 2) / ((slats - 1) / 2);
              const start = 0.06 * (1 - fromCenter);
              const t = easeOut(phase(reveal, start, start + 0.9));
              const lead = 1 - t;
              const fio = Math.max(0, lead * (1 - lead)) * 4; // brilho na frente de recolhimento
              return (
                <div
                  key={i}
                  className="-mx-px h-full flex-1 origin-top"
                  style={{
                    background:
                      "linear-gradient(180deg, oklch(0.13 0.014 25 / 0.98) 0%, oklch(0.09 0.01 25 / 0.99) 100%)",
                    transform: `scaleY(${lead}) translate3d(0, ${t * -6}%, 0) translateZ(0)`,
                    opacity: 1 - t * 0.15,
                    filter: !leve && emMovimento ? `blur(${(lead * 6).toFixed(1)}px)` : undefined,
                    boxShadow:
                      !leve && fio > 0.02
                        ? `0 -14px 40px -12px oklch(0.05 0.01 25 / ${(0.6 * fio).toFixed(2)}), inset 0 -1px 0 oklch(0.92 0.05 45 / ${(0.5 * fio).toFixed(2)})`
                        : undefined,
                    willChange: emMovimento ? "transform" : "auto",
                  }}
                />
              );
            })}
          </div>
        )}

        {/* Sombra única que acompanha a frente de abertura (uma camada, não uma por lâmina) */}
        {emMovimento && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[26vh]"
            style={{
              background: "linear-gradient(180deg, oklch(0.32 0.02 30 / 0.3) 0%, transparent 100%)",
              opacity: reveal * (1 - reveal) * 4,
              transform: `translate3d(0, ${(1 - reveal) * 30}vh, 0)`,
            }}
          />
        )}

        {/* Penumbra herdada do hero, que se dissipa com a abertura */}
        {penumbra > 0.01 && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              opacity: penumbra,
              background:
                "radial-gradient(120% 90% at 50% 50%, oklch(0.16 0.015 25 / 0.5) 0%, oklch(0.1 0.012 25 / 0.9) 65%, oklch(0.08 0.01 25 / 0.97) 100%)",
            }}
          />
        )}

        {/* Leitura do texto sobre a imagem — desktop: véu marfim */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 hidden md:block"
          style={{
            background:
              "linear-gradient(90deg, oklch(0.985 0.006 80 / 0.7) 0%, oklch(0.985 0.006 80 / 0.32) 30%, transparent 52%)",
            opacity: lines[0],
          }}
        />
        {/* Mobile: véu escuro suave atrás do texto (sem backdrop-filter, que
            derruba o desempenho no Safari do iPhone) */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 md:hidden"
          style={{
            background:
              "linear-gradient(90deg, oklch(0.18 0.01 30 / 0.5) 0%, oklch(0.18 0.01 30 / 0.24) 32%, transparent 56%)",
            opacity: lines[0],
          }}
        />

        <div className="relative flex h-full max-w-6xl flex-col justify-center px-6 md:px-10 lg:mx-auto">
          <div className="max-w-xl">
            <p
              className="brand-eyebrow mb-4 max-md:!text-background/80"
              style={{ opacity: lines[0], transform: `translateY(${(1 - lines[0]) * 18}px)` }}
            >
              Semijoias
            </p>
            <h2
              className="text-4xl leading-tight text-foreground max-md:!text-background md:text-6xl"
              style={{ opacity: lines[1], transform: `translateY(${(1 - lines[1]) * 22}px)` }}
            >
              {BRAND.tagline}
            </h2>
            <div
              className="rose-rule mt-6 w-20"
              style={{ transform: `scaleX(${lines[2]})`, transformOrigin: "left" }}
            />
            <p
              className="mt-6 max-w-md text-base text-muted-foreground max-md:!text-background/85 md:text-lg"
              style={{ opacity: lines[3], transform: `translateY(${(1 - lines[3]) * 18}px)` }}
            >
              {BRAND.subline}
            </p>
            <Link
              to="/semijoias"
              className="btn-premium mt-10"
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
