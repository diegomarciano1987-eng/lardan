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
 * Segunda sessão (V/5) — revelação triunfal em lâminas de vidro.
 * A imagem da mulher é desvelada devagar, da direita para a esquerda,
 * por uma guilhotina de vidro com bordas esfumaçadas e sombra de varredura.
 * A fotografia começa levemente ampliada e vai assentando enquanto o véu se abre;
 * só depois o texto sobe, linha a linha, para não roubar o momento da revelação.
 */
export function SessaoSemijoias() {
  const { ref, progress, reduced } = useScrollProgress<HTMLDivElement>();
  const tier = useDeviceTier();
  const leve = tier === "leve";
  const slats = leve ? 10 : 28;
  const p = reduced ? 1 : progress;

  // Entrada da sessão: enquanto o trilho sobe por trás do hero, a sessão
  // inteira permanece oculta; assim que ela trava no topo, uma guilhotina
  // a revela da direita para a esquerda — sem nenhum corte horizontal.
  const wipe = easeOut(phase(p, 0.01, 0.2));
  // A revelação em lâminas emenda na guilhotina: lenta e majestosa.
  const reveal = phase(p, 0.12, 0.6);
  // A foto começa mais próxima e recua suavemente à medida que o véu se abre.
  const imgScale = 1.3 - 0.3 * ease(phase(p, 0.04, 0.72));
  // Desfoque da foto que se dissolve conforme as lâminas se retraem (só desktop).
  const imgBlur = leve ? 0 : Math.round((1 - ease(phase(p, 0.04, 0.52))) * 8);

  const textIn = easeOut(phase(p, 0.42, 0.72));
  const ruleIn = easeOut(phase(p, 0.5, 0.78));
  const ctaIn = easeOut(phase(p, 0.58, 0.84));

  const emMovimento = reveal > 0.001 && reveal < 0.999;
  const dir = 1; // da direita para a esquerda

  return (
    <div ref={ref} className="relative -mt-[140vh] h-[280vh]">
      <section
        className="sticky top-0 h-screen overflow-hidden bg-background"
        style={{
          clipPath: wipe >= 0.999 ? undefined : `inset(-2% -2% -2% ${(1 - wipe) * 100}%)`,
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

        {/* Lâminas verticais que deslizam da direita para a esquerda, em cascata.
            Cada lâmina tem um gradiente de vidro fosco para que a imagem se
            desvele por trás de forma suave, nunca brusca. */}
        {reveal < 0.999 && (
          <div aria-hidden className="pointer-events-none absolute inset-0 flex">
            {Array.from({ length: slats }).map((_, i) => {
              const order = (slats - 1 - i) / (slats - 1);
              const start = 0.48 * order;
              const t = easeOut(phase(reveal, start, start + 0.52));
              const lead = 1 - t;
              const fio = Math.max(0, lead * (1 - lead)) * 4;
              return (
                <div
                  key={i}
                  className="-mx-px h-full flex-1"
                  style={{
                    background: leve
                      ? "linear-gradient(90deg, oklch(0.985 0.006 80 / 0.98) 0%, oklch(0.985 0.006 80 / 0.92) 48%, oklch(0.985 0.006 80 / 0.98) 100%)"
                      : "linear-gradient(90deg, oklch(0.985 0.006 80 / 0.62) 0%, oklch(0.985 0.006 80 / 0.5) 48%, oklch(0.985 0.006 80 / 0.62) 100%)",
                    // Vidro fosco de verdade no desktop: a imagem transparece
                    // desfocada por trás de cada lâmina enquanto ela se retrai.
                    backdropFilter: leve ? undefined : "blur(26px) saturate(1.15)",
                    WebkitBackdropFilter: leve ? undefined : "blur(26px) saturate(1.15)",
                    transform: `translate3d(${dir * t * 130}%, 0, 0) translateZ(0)`,
                    opacity: lead < 0.02 ? 0 : 1,
                    boxShadow:
                      !leve && fio > 0.02
                        ? `${dir * -10}px 0 34px -10px oklch(0.22 0.015 30 / ${(0.42 * fio).toFixed(2)})`
                        : undefined,
                    willChange: emMovimento ? "transform" : "auto",
                  }}
                />
              );
            })}
          </div>
        )}

        {/* Sombra de varredura que acompanha a frente da guilhotina */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-[34vw]"
          style={{
            right: 0,
            background:
              "linear-gradient(270deg, oklch(0.18 0.015 30 / 0.32) 0%, oklch(0.18 0.015 30 / 0.14) 42%, transparent 100%)",
            opacity: reveal * (1 - reveal) * 4,
            transform: `translate3d(${-1 * (1 - reveal) * 45}%, 0, 0)`,
          }}
        />

        {/* Frente da guilhotina: filete de vidro e luz percorrem a tela. */}
        {emMovimento && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-[clamp(32px,5.5vw,84px)]"
            style={{
              left: `calc(${(1 - reveal) * 100}% - clamp(16px, 2.75vw, 42px))`,
              opacity: Math.min(1, reveal * 8) * (1 - reveal),
              background:
                "linear-gradient(90deg, transparent 0%, oklch(0.99 0.01 80 / 0.42) 44%, oklch(1 0 0 / 0.78) 56%, transparent 100%)",
              filter: leve ? "blur(6px)" : "blur(11px)",
              boxShadow: leve ? undefined : "22px 0 54px -18px oklch(0.18 0.015 30 / 0.52)",
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
            opacity: textIn,
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
            opacity: textIn,
          }}
        />

        <div className="relative flex h-full max-w-6xl flex-col justify-center px-6 md:px-10 lg:mx-auto">
          <div className="max-w-xl">
            <p
              className="brand-eyebrow mb-4 max-md:!text-background/80"
              style={{ opacity: textIn, transform: `translateY(${(1 - textIn) * 18}px)` }}
            >
              Semijoias
            </p>
            <h2
              className="text-4xl leading-tight text-foreground max-md:!text-background md:text-6xl"
              style={{ opacity: textIn, transform: `translateY(${(1 - textIn) * 24}px)` }}
            >
              {BRAND.tagline}
            </h2>
            <div
              className="rose-rule mt-6 w-20 origin-left"
              style={{ transform: `scaleX(${ruleIn})` }}
            />
            <p
              className="mt-6 max-w-md text-base text-muted-foreground max-md:!text-background/85 md:text-lg"
              style={{ opacity: textIn, transform: `translateY(${(1 - textIn) * 18}px)` }}
            >
              {BRAND.subline}
            </p>
            <Link
              to="/semijoias"
              className="btn-premium mt-10"
              style={{ opacity: ctaIn, transform: `translateY(${(1 - ctaIn) * 18}px)` }}
              tabIndex={ctaIn > 0.5 ? 0 : -1}
            >
              Conhecer semijoias
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
