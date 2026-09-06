import { BRAND } from "@/lib/brand";
import {
  useScrollProgress,
  useDeviceTier,
  phase,
  ease,
} from "@/hooks/use-scroll-progress";
import heroAsset from "@/assets/lardan-hero-vidro.jpg.asset.json";
import heroMobileAsset from "@/assets/lardan-mobile-hero.png.asset.json";
import diamanteAsset from "@/assets/lardan-diamante.png.asset.json";
import wordmarkAsset from "@/assets/lardan-wordmark.png.asset.json";

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

/** Arredonda o desfoque em degraus, evitando reprocessar a imagem a cada pixel. */
function stepBlur(v: number, passo = 3) {
  return Math.round(v / passo) * passo;
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
  const { ref: trackRef, progress, reduced } = useScrollProgress<HTMLDivElement>();
  const tier = useDeviceTier();
  const leve = tier === "leve";

  // Com reduced motion, mostra o wordmark final diretamente.
  const p = reduced ? 1 : progress;

  const out = ease(phase(p, 0.18, 0.6)); // saída do diamante
  const flash = phase(p, 0.42, 0.55) * (1 - phase(p, 0.55, 0.68)); // estouro de luz
  const wordmarkIn = ease(phase(p, 0.5, 0.78));
  const mostrarBrilho = !reduced && out < 0.35;

  return (
    <div ref={trackRef} className="relative h-[300vh]" aria-label={BRAND.name}>
      <div className="sticky top-0 h-screen overflow-hidden bg-background">
        {/* Fundo-base: onda de vidro original */}
        <picture>
          <source
            media="(max-width: 767px)"
            srcSet="/img/lardan-mobile-hero.webp"
            type="image/webp"
          />
          <source media="(max-width: 767px)" srcSet={heroMobileAsset.url} />
          <source srcSet="/img/lardan-hero-vidro.webp" type="image/webp" />
          <img
            src={heroAsset.url}
            alt=""
            aria-hidden
            className="gpu-layer absolute inset-0 h-full w-full object-cover"
            style={{ transform: `scale(${1 + out * 0.06}) translateZ(0)` }}
            fetchPriority="high"
            decoding="async"
            width={1664}
            height={928}
          />
        </picture>

        {/* Estado 1: diamante — avança na câmera e se desfaz em luz */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            opacity: 1 - clamp01(out * 1.35),
            filter: leve
              ? undefined
              : `blur(${stepBlur(out * 26)}px) brightness(${(1 + out * 1.6).toFixed(2)})`,
            transform: `scale(${1 + out * 1.9}) rotate(${out * 14}deg) translateY(${out * -6}vh)`,
            transformOrigin: "50% 52%",
            willChange: out > 0 && out < 1 ? "transform, opacity" : "auto",
          }}
        >
          <div className="relative w-[clamp(180px,32vw,420px)]">
            <img
              src="/img/lardan-diamante.webp"
              alt="Lardan"
              className="w-full"
              decoding="async"
              fetchPriority="high"
              width={624}
              height={416}
            />
            {mostrarBrilho && (
              <>
                {/* Reflexo dourado percorrendo as bordas do diamante */}
                <div
                  aria-hidden
                  className="hero-gleam pointer-events-none absolute inset-0"
                  style={{
                    WebkitMaskImage: `url(${diamanteAsset.url})`,
                    maskImage: `url(${diamanteAsset.url})`,
                  }}
                />
                {/* Faísca quente que acompanha o reflexo, só nas arestas */}
                {!leve && (
                  <div
                    aria-hidden
                    className="hero-gleam-spark pointer-events-none absolute inset-0"
                    style={{
                      WebkitMaskImage: `url(${diamanteAsset.url})`,
                      maskImage: `url(${diamanteAsset.url})`,
                    }}
                  />
                )}
              </>
            )}
          </div>
          <h1 className="sr-only">Lardan — semijoias</h1>
        </div>

        {/* Estouro de luz no ponto de virada */}
        {flash > 0.01 && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              opacity: flash,
              background:
                "radial-gradient(circle at 50% 50%, oklch(1 0 0 / 0.95), oklch(1 0 0 / 0.45) 35%, transparent 70%)",
            }}
          />
        )}

        {/* Estado 2: wordmark isolado, fundo limpo, sem véu nem sombra */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            opacity: wordmarkIn,
            transform: `scale(${0.94 + wordmarkIn * 0.06})`,
            filter:
              leve || wordmarkIn === 1
                ? undefined
                : `blur(${stepBlur((1 - wordmarkIn) * 8, 2)}px)`,
          }}
          aria-hidden={wordmarkIn < 0.5}
        >
          <img
            src="/img/lardan-wordmark.webp"
            alt=""
            aria-hidden
            className="w-[clamp(240px,42vw,560px)]"
            decoding="async"
            width={650}
            height={210}
          />
        </div>
      </div>
    </div>
  );
}
