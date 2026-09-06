import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

interface CategorySceneProps {
  title: string;
  to: string;
  image: { url: string };
  imageAlt: string;
  /** Lado onde o texto fica, para não cobrir a peça na foto. */
  align?: "left" | "right";
}

/** Sessão de categoria em tela cheia: a imagem é o fundo, sem card nem sombra. */
export function CategoryScene({ title, to, image, imageAlt, align = "left" }: CategorySceneProps) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => entry && setVisible(entry.isIntersecting), {
      threshold: 0.35,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section ref={ref} className="relative h-screen w-full overflow-hidden">
      <img
        src={image.url}
        alt={imageAlt}
        loading="lazy"
        width={1664}
        height={928}
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1400ms] ease-out"
        style={{ transform: visible ? "scale(1)" : "scale(1.08)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            align === "left"
              ? "linear-gradient(90deg, oklch(0.985 0.006 80 / 0.85) 0%, oklch(0.985 0.006 80 / 0.4) 40%, transparent 65%)"
              : "linear-gradient(270deg, oklch(0.985 0.006 80 / 0.85) 0%, oklch(0.985 0.006 80 / 0.4) 40%, transparent 65%)",
        }}
      />
      <div
        className={`relative mx-auto flex h-full max-w-6xl flex-col justify-center px-6 md:px-10 ${
          align === "right" ? "items-end text-right" : "items-start"
        }`}
      >
        <div
          className="max-w-md transition-all duration-1000 ease-out"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(28px)",
          }}
        >
          <p className="brand-eyebrow mb-3">Categoria</p>
          <h2 className="text-4xl text-foreground md:text-6xl">{title}</h2>
          <div className={`rose-rule mt-6 w-16 ${align === "right" ? "ml-auto" : ""}`} />
          <Link
            to={to}
            className="mt-8 inline-flex items-center border-b border-primary/50 pb-2 text-[0.75rem] tracking-[0.22em] uppercase text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            Ver {title.toLowerCase()}
          </Link>
        </div>
      </div>
    </section>
  );
}
