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

  const reveal = easeOut(phase(p, 0.01, 0.34));
  const imgScale = 1.28 - 0.28 * ease(phase(p, 0, 0.7));
  // Desfoque da foto que se dissolve conforme as lâminas se retraem (só desktop).
  const imgBlur = leve ? 0 : Math.round((1 - ease(phase(p, 0, 0.5))) * 8);
  const line = (start: number) => easeOut(phase(p, start, start + 0.16));
  const lines = [line(0.42), line(0.48), line(0.54), line(0.6), line(0.66)] as const;
  const emMovimento = reveal > 0.001 && reveal < 0.999;
  return (
    <div ref={ref} className="relative -mt-[100vh] h-[270vh]">
      <section className="sticky top-0 h-screen overflow-hidden bg-transparent">
        <div
          className="absolute inset-0 overflow-hidden bg-background"
          style={{
            clipPath: `inset(0 0 0 ${(1 - reveal) * 100}%)`,
            willChange: emMovimento ? "clip-path" : "auto",
          }}
        >
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
        </div>

        {/* Frente da guilhotina: vidro e sombra percorrem a tela da direita
            para a esquerda, sem contaminar o brilho da fotografia revelada. */}
        {emMovimento && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-[clamp(28px,5vw,74px)]"
            style={{
              left: `calc(${(1 - reveal) * 100}% - clamp(14px, 2.5vw, 37px))`,
              opacity: Math.min(1, reveal * 8) * (1 - reveal),
              background:
                "linear-gradient(90deg, transparent 0%, oklch(0.99 0.01 80 / 0.5) 48%, oklch(1 0 0 / 0.82) 58%, transparent 100%)",
              filter: leve ? "blur(5px)" : "blur(9px)",
              boxShadow: leve ? undefined : "18px 0 42px -16px oklch(0.18 0.015 30 / 0.48)",
            }}
          />
        )}
      </section>
    </div>
  );
}
