import { useEffect, useRef, useState } from "react";
import { BRAND } from "@/lib/brand";
import heroAsset from "@/assets/lardan-hero-vidro.jpg.asset.json";
import heroMobileAsset from "@/assets/lardan-mobile-hero.png.asset.json";
import diamanteAsset from "@/assets/lardan-diamante.png.asset.json";
import wordmarkAsset from "@/assets/lardan-wordmark.png.asset.json";

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

/** Interpola 0→1 entre os marcos [a, b] do progresso total. */
function phase(progress: number, a: number, b: number) {
  return clamp01((progress - a) / (b - a));
}

/** Suavização cinematográfica (ease-in-out cúbica). */
function ease(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Narrativa de scroll da home (V/4.2):
 * 1. Diamante nítido sobre a onda de vidro.
 * 2. Transição cinematográfica: o diamante avança na câmera, gira levemente,
 *    estoura em luz e se dissolve — sem véu rosé, fundo limpo.
 * 3. Wordmark LARDAN isolado sobre o fundo limpo.
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

  // Com reduced motion, mostra o wordmark final diretamente.
  const p = reduced ? 1 : progress;

  const out = ease(phase(p, 0.18, 0.6)); // saída do diamante
  const flash = phase(p, 0.42, 0.55) * (1 - phase(p, 0.55, 0.68)); // estouro de luz
  const wordmarkIn = ease(phase(p, 0.5, 0.78));

  return (
    <div ref={trackRef} className="relative h-[300vh]" aria-label={BRAND.name}>
      <div className="sticky top-0 h-screen overflow-hidden bg-background">
        {/* Fundo-base: onda de vidro original */}
        <img
          src={heroAsset.url}
          srcSet={`${heroMobileAsset.url} 750w, ${heroAsset.url} 1664w`}
          sizes="(max-width: 767px) 100vw, 100vw"
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
          style={{ transform: `scale(${1 + out * 0.06})` }}
          fetchPriority="high"
          width={1664}
          height={928}
        />

        {/* Estado 1: diamante — avança na câmera e se desfaz em luz */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            opacity: 1 - clamp01(out * 1.35),
            filter: `blur(${out * 26}px) brightness(${1 + out * 1.6}) contrast(${1 - out * 0.3})`,
            transform: `scale(${1 + out * 1.9}) rotate(${out * 14}deg) translateY(${out * -6}vh)`,
            transformOrigin: "50% 52%",
          }}
        >
          <img
            src={diamanteAsset.url}
            alt="Lardan"
            className="w-[clamp(180px,32vw,420px)]"
            width={624}
            height={416}
          />
          <h1 className="sr-only">Lardan — semijoias</h1>
        </div>

        {/* Estouro de luz no ponto de virada */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            opacity: flash,
            background:
              "radial-gradient(circle at 50% 50%, oklch(1 0 0 / 0.95), oklch(1 0 0 / 0.45) 35%, transparent 70%)",
          }}
        />

        {/* Estado 2: wordmark isolado, fundo limpo, sem véu nem sombra */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            opacity: wordmarkIn,
            transform: `scale(${0.94 + wordmarkIn * 0.06})`,
            filter: `blur(${(1 - wordmarkIn) * 8}px)`,
          }}
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
      </div>
    </div>
  );
}
