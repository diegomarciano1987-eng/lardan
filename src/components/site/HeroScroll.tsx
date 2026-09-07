import { BRAND } from "@/lib/brand";
import { useScrollProgress, useDeviceTier, phase, ease } from "@/hooks/use-scroll-progress";
import heroAsset from "@/assets/lardan-hero-vidro.jpg.asset.json";
import diamanteAsset from "@/assets/lardan-diamante.png.asset.json";
import wordmarkAsset from "@/assets/lardan-wordmark.png.asset.json";

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

/**
 * Hero de marca: uma única imagem permanece absolutamente imóvel durante toda
 * a sequência. O ícone cede lugar ao nome LARDAN sem alterar o cenário.
 */
export function HeroScroll() {
  const { ref: trackRef, progress, reduced } = useScrollProgress<HTMLDivElement>();
  const leve = useDeviceTier() === "leve";
  const p = reduced ? 0.5 : progress;
  // Sequência curta: o ícone cede cedo, o nome LARDAN assenta rápido e
  // permanece em cena por uma rolagem inteira — depois disso a segunda
  // sessão começa a subir suavemente por cima.
  const iconOut = ease(phase(p, 0.06, 0.16));
  const wordmarkIn = ease(phase(p, 0.10, 0.20));
  const nevoa = reduced ? 0 : phase(p, 0.07, 0.14) * (1 - phase(p, 0.14, 0.20));
  const mostrarReflexo = !reduced && iconOut < 0.65;

  return (
    <div ref={trackRef} className="relative h-[260vh]" aria-label={BRAND.name}>
      <div className="sticky top-0 h-screen overflow-hidden bg-background">
        {/* Único cenário do hero: não recebe escala, blur, filtro ou overlay. */}
        <img
          src={heroAsset.url}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
          fetchPriority="high"
          decoding="async"
          width={1664}
          height={928}
        />

        {/* Estado 1: ícone. */}
        <div
          className="gpu-layer absolute inset-0 flex items-center justify-center"
          style={{
            opacity: 1 - iconOut,
            transform: `scale(${1 + iconOut * 0.1}) translate3d(0, ${iconOut * -1.5}vh, 0)`,
            filter: leve || iconOut === 0 ? undefined : `blur(${Math.round(iconOut * 18)}px)`,
            willChange: iconOut > 0 && iconOut < 1 ? "transform, opacity, filter" : "auto",
          }}
        >
          <div className="relative w-[clamp(180px,32vw,420px)]">
            <img
              src={diamanteAsset.url}
              alt="Lardan"
              className="w-full"
              decoding="async"
              fetchPriority="high"
              width={624}
              height={416}
            />
            {mostrarReflexo && (
              <>
                <div
                  aria-hidden
                  className="hero-gleam pointer-events-none absolute inset-0"
                  style={{
                    WebkitMaskImage: `url(${diamanteAsset.url})`,
                    maskImage: `url(${diamanteAsset.url})`,
                  }}
                />
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

        {/* Névoa óptica localizada: transforma a marca sem tocar no cenário. */}
        {nevoa > 0.005 && (
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 h-[30vh] w-[min(72vw,820px)] -translate-x-1/2 -translate-y-1/2 rounded-[50%]"
            style={{
              opacity: nevoa * 0.72,
              background:
                "radial-gradient(ellipse, oklch(0.99 0.008 80 / 0.48) 0%, oklch(0.96 0.014 55 / 0.2) 38%, transparent 74%)",
              filter: leve ? "blur(18px)" : "blur(34px)",
              transform: `translate3d(-50%, -50%, 0) scaleX(${0.72 + nevoa * 0.38})`,
            }}
          />
        )}

        {/* Estado 2: nome LARDAN, no mesmo cenário intacto. */}
        <div
          className="gpu-layer absolute inset-0 flex items-center justify-center"
          style={{
            opacity: clamp01(wordmarkIn),
            transform: `translate3d(0, ${(1 - wordmarkIn) * 1.5}vh, 0) scale(${1.04 - wordmarkIn * 0.04})`,
            filter: leve || wordmarkIn === 1 ? undefined : `blur(${Math.round((1 - wordmarkIn) * 18)}px)`,
            willChange: wordmarkIn > 0 && wordmarkIn < 1 ? "transform, opacity, filter" : "auto",
          }}
          aria-hidden={wordmarkIn < 0.5}
        >
          <div className="relative w-[clamp(240px,42vw,560px)]">
            <img
              src={wordmarkAsset.url}
              alt=""
              aria-hidden
              className="w-full"
              loading="eager"
              decoding="async"
              width={650}
              height={210}
              style={{
                filter: `drop-shadow(0 ${(42 - wordmarkIn * 22).toFixed(0)}px ${(76 - wordmarkIn * 30).toFixed(0)}px oklch(0.06 0.01 30 / 0.46))`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
