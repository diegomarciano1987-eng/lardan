import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { BRAND } from "@/lib/brand";
import heroAsset from "@/assets/lardan-hero-vidro.jpg.asset.json";
import diamanteAsset from "@/assets/lardan-diamante.png.asset.json";
import wordmarkAsset from "@/assets/lardan-wordmark.png.asset.json";

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

/** Interpola 0→1 entre os marcos [a, b] do progresso total. */
function phase(progress: number, a: number, b: number) {
  return clamp01((progress - a) / (b - a));
}

/**
 * Narrativa de scroll da home (V/4.1):
 * 1. Diamante nítido sobre a onda de vidro.
 * 2. Diamante dissolve em véu rosé sutil.
 * 3. Wordmark LARDAN isolado.
 * 4. Composição editorial: título, subtítulo e CTA.
 * Sem scroll hijacking: a rolagem é nativa; apenas as camadas reagem.
 */
export function HeroScroll() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onMq = () => setReduced(mq.matches);
    mq.addEventListener("change", onMq);

    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = trackRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const total = el.offsetHeight - window.innerHeight;
        setProgress(total > 0 ? clamp01(-rect.top / total) : 0);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      mq.removeEventListener("change", onMq);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Com reduced motion, mostra o estado editorial final diretamente.
  const p = reduced ? 1 : progress;

  const diamondIn = 1 - phase(p, 0.22, 0.42); // sai
  const veil = phase(p, 0.22, 0.42) * (1 - phase(p, 0.55, 0.75)); // névoa rosé temporária
  const wordmarkIn = phase(p, 0.38, 0.52) * (1 - phase(p, 0.6, 0.78)); // entra e sai
  const editorialIn = phase(p, 0.66, 0.85);

  return (
    <div ref={trackRef} className="relative h-[320vh]" aria-label={BRAND.name}>
      <div className="sticky top-0 h-screen overflow-hidden">
        {/* Fundo-base comum: onda de vidro original */}
        <img
          src={heroAsset.url}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
          fetchPriority="high"
          width={1664}
          height={928}
        />

        {/* Véu rosé de dissolução */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            opacity: veil * 0.85,
            background:
              "radial-gradient(ellipse at 50% 60%, oklch(0.85 0.05 30 / 0.55), oklch(0.94 0.03 40 / 0.35) 55%, transparent 80%)",
          }}
        />

        {/* Estado 1–2: diamante */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            opacity: diamondIn,
            filter: `blur(${(1 - diamondIn) * 10}px)`,
            transform: `scale(${1 + (1 - diamondIn) * 0.06})`,
          }}
        >
          <img
            src={diamanteAsset.url}
            alt="Lardan"
            className="w-[clamp(180px,32vw,420px)]"
            width={624}
            height={416}
          />
          {/* H1 acessível presente desde o início */}
          <h1 className="sr-only">Lardan — semijoias</h1>
        </div>

        {/* Estado 3: wordmark isolado */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ opacity: wordmarkIn }}
          aria-hidden={wordmarkIn < 0.5}
        >
          <img
            src={wordmarkAsset.url}
            alt=""
            aria-hidden
            className="w-[clamp(240px,42vw,560px)]"
            width={650}
            height={210}
          />
        </div>

        {/* Estado 4: composição editorial */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center"
          style={{
            opacity: editorialIn,
            transform: `translateY(${(1 - editorialIn) * 24}px)`,
          }}
          aria-hidden={editorialIn < 0.5}
        >
          <img
            src={wordmarkAsset.url}
            alt="Lardan"
            className="mb-8 w-[clamp(180px,26vw,340px)]"
            width={650}
            height={210}
            style={{ opacity: Math.min(1, editorialIn * 1.4) }}
          />
          <p className="brand-eyebrow mb-4">Semijoias</p>
          <h2 className="max-w-2xl text-4xl leading-tight text-foreground md:text-6xl">
            {BRAND.tagline}
          </h2>
          <p className="mt-4 max-w-md text-base text-muted-foreground md:text-lg">
            {BRAND.subline}
          </p>
          <Link
            to="/semijoias"
            className="mt-10 inline-flex items-center rounded-full border border-primary/40 px-8 py-3 text-[0.75rem] tracking-[0.22em] uppercase text-foreground transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            tabIndex={editorialIn > 0.5 ? 0 : -1}
          >
            Conhecer semijoias
          </Link>
        </div>
      </div>
    </div>
  );
}
