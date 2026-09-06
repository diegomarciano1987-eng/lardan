import { Link } from "@tanstack/react-router";
import {
  useScrollProgress,
  useDeviceTier,
  phase,
  ease,
  easeOut,
} from "@/hooks/use-scroll-progress";

interface CategoryGuillotineProps {
  title: string;
  /** Texto leve opcional exibido abaixo do título. */
  subtitle?: string;
  /** Slug da categoria no catálogo publicado. */
  categoria: string;
  image: { url: string };
  /** Versão leve (webp) da imagem de desktop. */
  imageWebp?: string;
  /** Versão vertical da imagem, usada só em telas de celular. */
  mobileImage?: { url: string };
  /** Versão leve (webp) da imagem de celular. */
  mobileImageWebp?: string;
  imageAlt: string;
  /** Lado por onde a guilhotina entra: "right" = da direita para a esquerda. */
  enterFrom: "left" | "right";
  /** Lado onde o texto fica, para não cobrir a peça na foto. */
  align?: "left" | "right";
  /** Lado do texto apenas no mobile (quando diferente do desktop). */
  mobileAlign?: "left" | "right";
}

/**
 * Sessão de categoria em tela cheia, guiada pela rolagem (trilho de 240vh).
 * A foto é revelada por lâminas verticais que deslizam na horizontal, em
 * cascata, como uma guilhotina lateral — a direção alterna entre as sessões.
 * As lâminas têm bordas esfumaçadas e sombra na frente de varredura, para um
 * acabamento fino e cinematográfico.
 */
export function CategoryGuillotine({
  title,
  subtitle,
  categoria,
  image,
  imageWebp,
  mobileImage,
  mobileImageWebp,
  imageAlt,
  enterFrom,
  align = "left",
  mobileAlign,
}: CategoryGuillotineProps) {
  const { ref, progress, reduced } = useScrollProgress<HTMLDivElement>();
  const tier = useDeviceTier();
  const slats = tier === "leve" ? 10 : 18;
  const p = reduced ? 1 : progress;

  const reveal = phase(p, 0.04, 0.62);
  const imgScale = 1.22 - 0.22 * ease(phase(p, 0, 0.75));
  const dir = enterFrom === "right" ? 1 : -1;
  const mobileSide = mobileAlign ?? align;

  const textIn = easeOut(phase(p, 0.5, 0.8));
  const ruleIn = easeOut(phase(p, 0.56, 0.84));
  const ctaIn = easeOut(phase(p, 0.62, 0.9));
  const emMovimento = reveal > 0.001 && reveal < 0.999;

  return (
    <div ref={ref} className="relative h-[240vh]">
      <section className="sticky top-0 h-screen overflow-hidden bg-background">
        <picture>
          {mobileImageWebp && (
            <source media="(max-width: 767px)" srcSet={mobileImageWebp} type="image/webp" />
          )}
          {mobileImage && <source media="(max-width: 767px)" srcSet={mobileImage.url} />}
          {imageWebp && <source srcSet={imageWebp} type="image/webp" />}
          <img
            src={image.url}
            alt={imageAlt}
            loading="lazy"
            decoding="async"
            width={1664}
            height={928}
            className="gpu-layer absolute inset-0 h-full w-full object-cover"
            style={{ transform: `scale(${imgScale}) translateZ(0)` }}
          />
        </picture>

        {/* Lâminas que deslizam na horizontal, em cascata.
            Apenas transform/opacidade — sem desfoque por lâmina, para manter
            a rolagem fluida no Safari e em aparelhos mais simples. */}
        {reveal < 0.999 && (
          <div aria-hidden className="pointer-events-none absolute inset-0 flex">
            {Array.from({ length: slats }).map((_, i) => {
              const order = enterFrom === "right" ? (slats - 1 - i) / (slats - 1) : i / (slats - 1);
              const start = 0.5 * order;
              const t = easeOut(phase(reveal, start, start + 0.5));
              const lead = 1 - t; // 1 = lâmina cobrindo, 0 = fora da cena
              return (
                <div
                  key={i}
                  className="-mx-px h-full flex-1 bg-background"
                  style={{
                    transform: `translate3d(${dir * t * 130}%, 0, 0)`,
                    opacity: lead < 0.02 ? 0 : 1,
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
          className="pointer-events-none absolute inset-y-0 w-[30vw]"
          style={{
            [enterFrom === "right" ? "right" : "left"]: 0,
            background:
              enterFrom === "right"
                ? "linear-gradient(270deg, oklch(0.2 0.015 30 / 0.28) 0%, transparent 100%)"
                : "linear-gradient(90deg, oklch(0.2 0.015 30 / 0.28) 0%, transparent 100%)",
            opacity: reveal * (1 - reveal) * 4,
            transform: `translate3d(${dir * -1 * (1 - reveal) * 40}%, 0, 0)`,
          }}
        />

        {/* Leitura do texto sobre a imagem — desktop: véu marfim */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 hidden md:block"
          style={{
            background:
              align === "left"
                ? "linear-gradient(90deg, oklch(0.985 0.006 80 / 0.88) 0%, oklch(0.985 0.006 80 / 0.45) 40%, transparent 65%)"
                : "linear-gradient(270deg, oklch(0.985 0.006 80 / 0.88) 0%, oklch(0.985 0.006 80 / 0.45) 40%, transparent 65%)",
            opacity: textIn,
          }}
        />
        {/* Mobile: véu escuro suave atrás do texto (sem desfoque de fundo,
            que é o efeito mais pesado no Safari do iPhone) */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 md:hidden"
          style={{
            background:
              mobileSide === "left"
                ? "linear-gradient(90deg, oklch(0.18 0.01 30 / 0.62) 0%, oklch(0.18 0.01 30 / 0.34) 40%, transparent 66%)"
                : "linear-gradient(270deg, oklch(0.18 0.01 30 / 0.62) 0%, oklch(0.18 0.01 30 / 0.34) 40%, transparent 66%)",
            opacity: textIn,
          }}
        />

        <div
          className={`relative mx-auto flex h-full max-w-6xl flex-col justify-center px-6 md:px-10 ${
            mobileSide === "right" ? "items-end text-right" : "items-start text-left"
          } ${align === "right" ? "md:items-end md:text-right" : "md:items-start md:text-left"}`}
        >
          <div className="max-w-md">
            <p
              className="brand-eyebrow mb-3 max-md:!text-background/80"
              style={{ opacity: textIn, transform: `translateY(${(1 - textIn) * 18}px)` }}
            >
              Categoria
            </p>
            <h2
              className="text-4xl text-foreground max-md:!text-background md:text-6xl"
              style={{ opacity: textIn, transform: `translateY(${(1 - textIn) * 24}px)` }}
            >
              {title}
            </h2>
            {subtitle && (
              <p
                className="mt-3 text-xs font-extralight uppercase tracking-[0.45em] text-foreground/50 max-md:!text-background/60"
                style={{ opacity: textIn, transform: `translateY(${(1 - textIn) * 20}px)` }}
              >
                {subtitle}
              </p>
            )}
            <div
              className={`rose-rule mt-6 w-16 ${
                mobileSide === "right" ? "origin-right" : "origin-left"
              } ${align === "right" ? "md:origin-right md:ml-auto" : "md:origin-left"}`}
              style={{ transform: `scaleX(${ruleIn})` }}
            />
            <Link
              to="/semijoias/$categoria"
              params={{ categoria }}
              className="btn-premium mt-8"
              style={{ opacity: ctaIn, transform: `translateY(${(1 - ctaIn) * 18}px)` }}
              tabIndex={ctaIn > 0.5 ? 0 : -1}
            >
              Ver {title.toLowerCase()}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
