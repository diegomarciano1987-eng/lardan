import { Link } from "@tanstack/react-router";
import { useScrollProgress, phase, ease, easeOut } from "@/hooks/use-scroll-progress";

const SLATS = 18;

interface CategoryGuillotineProps {
  title: string;
  to: string;
  image: { url: string };
  imageAlt: string;
  /** Lado por onde a guilhotina entra: "right" = da direita para a esquerda. */
  enterFrom: "left" | "right";
  /** Lado onde o texto fica, para não cobrir a peça na foto. */
  align?: "left" | "right";
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
  to,
  image,
  imageAlt,
  enterFrom,
  align = "left",
}: CategoryGuillotineProps) {
  const { ref, progress, reduced } = useScrollProgress<HTMLDivElement>();
  const p = reduced ? 1 : progress;

  const reveal = phase(p, 0.04, 0.62);
  const imgScale = 1.22 - 0.22 * ease(phase(p, 0, 0.75));
  const dir = enterFrom === "right" ? 1 : -1;

  const textIn = easeOut(phase(p, 0.5, 0.8));
  const ruleIn = easeOut(phase(p, 0.56, 0.84));
  const ctaIn = easeOut(phase(p, 0.62, 0.9));

  return (
    <div ref={ref} className="relative h-[240vh]">
      <section className="sticky top-0 h-screen overflow-hidden bg-background">
        <img
          src={image.url}
          alt={imageAlt}
          loading="lazy"
          width={1664}
          height={928}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ transform: `scale(${imgScale})` }}
        />

        {/* Lâminas que deslizam na horizontal, em cascata, com acabamento suave */}
        <div aria-hidden className="pointer-events-none absolute inset-0 flex">
          {Array.from({ length: SLATS }).map((_, i) => {
            // Cascata larga: a frente de varredura atravessa a tela inteira,
            // da borda de entrada até o lado oposto, lâmina a lâmina.
            const order =
              enterFrom === "right"
                ? (SLATS - 1 - i) / (SLATS - 1)
                : i / (SLATS - 1);
            const start = 0.5 * order;
            const t = easeOut(phase(reveal, start, start + 0.5));
            const lead = 1 - t; // 1 = lâmina cobrindo, 0 = fora da cena
            const moving = t * (1 - t) * 4; // desfoque só enquanto desliza
            return (
              <div
                key={i}
                className="-mx-px h-full flex-1 bg-background"
                style={{
                  transform: `translateX(${dir * t * 130}%)`,
                  opacity: lead < 0.02 ? 0 : 1,
                  filter: `blur(${moving * 4}px)`,
                }}
              />
            );
          })}
        </div>

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
            transform: `translateX(${dir * -1 * (1 - reveal) * 40}%)`,
          }}
        />

        {/* Leitura do texto sobre a imagem */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              align === "left"
                ? "linear-gradient(90deg, oklch(0.985 0.006 80 / 0.88) 0%, oklch(0.985 0.006 80 / 0.45) 40%, transparent 65%)"
                : "linear-gradient(270deg, oklch(0.985 0.006 80 / 0.88) 0%, oklch(0.985 0.006 80 / 0.45) 40%, transparent 65%)",
            opacity: textIn,
          }}
        />

        <div
          className={`relative mx-auto flex h-full max-w-6xl flex-col justify-center px-6 md:px-10 ${
            align === "right" ? "items-end text-right" : "items-start"
          }`}
        >
          <div className="max-w-md">
            <p
              className="brand-eyebrow mb-3"
              style={{ opacity: textIn, transform: `translateY(${(1 - textIn) * 18}px)` }}
            >
              Categoria
            </p>
            <h2
              className="text-4xl text-foreground md:text-6xl"
              style={{ opacity: textIn, transform: `translateY(${(1 - textIn) * 24}px)` }}
            >
              {title}
            </h2>
            <div
              className={`rose-rule mt-6 w-16 ${align === "right" ? "ml-auto origin-right" : "origin-left"}`}
              style={{ transform: `scaleX(${ruleIn})` }}
            />
            <Link
              to={to}
              className="mt-8 inline-flex items-center border-b border-primary/50 pb-2 text-[0.75rem] tracking-[0.22em] uppercase text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
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
