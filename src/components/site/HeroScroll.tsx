import { BRAND } from "@/lib/brand";
import { useScrollProgress, phase, ease } from "@/hooks/use-scroll-progress";
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
  const p = reduced ? 0.62 : progress;
  const iconOut = ease(phase(p, 0.18, 0.43));
  const wordmarkIn = ease(phase(p, 0.32, 0.58));
  const heroOut = reduced ? 0 : ease(phase(p, 0.88, 1));

  return (
    <div ref={trackRef} className="relative h-[210vh]" aria-label={BRAND.name}>
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
            transform: `scale(${1 + iconOut * 0.12}) translate3d(0, ${iconOut * -2}vh, 0)`,
            willChange: iconOut > 0 && iconOut < 1 ? "transform, opacity" : "auto",
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
          </div>
          <h1 className="sr-only">Lardan — semijoias</h1>
        </div>

        {/* Estado 2: nome LARDAN, no mesmo cenário intacto. */}
        <div
          className="gpu-layer absolute inset-0 flex items-center justify-center"
          style={{
            opacity: clamp01(wordmarkIn - heroOut),
            transform: `translate3d(0, ${(1 - wordmarkIn) * 3}vh, 0) scale(${0.94 + wordmarkIn * 0.06})`,
            willChange: wordmarkIn > 0 && wordmarkIn < 1 ? "transform, opacity" : "auto",
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
