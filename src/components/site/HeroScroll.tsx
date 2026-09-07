import { BRAND } from "@/lib/brand";
import { useScrollProgress, useDeviceTier, phase, ease, easeOut } from "@/hooks/use-scroll-progress";
import heroAsset from "@/assets/lardan-hero-vidro.jpg.asset.json";
import diamanteAsset from "@/assets/lardan-diamante.png.asset.json";
import wordmarkAsset from "@/assets/lardan-wordmark.png.asset.json";

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

/**
 * Hero de marca: uma única imagem permanece absolutamente imóvel durante toda
 * a sequência. O ícone cede lugar ao nome LARDAN numa transição de luz —
 * como um corte de cinema, sem tocar no cenário.
 */
export function HeroScroll() {
  const { ref: trackRef, progress, reduced } = useScrollProgress<HTMLDivElement>();
  const leve = useDeviceTier() === "leve";
  const p = reduced ? 0.5 : progress;

  // Coreografia da transição:
  //  0.05–0.13  o ícone se entrega à luz (cresce, desfoca, acende)
  //  0.10–0.18  clarão central — o "corte" de cinema
  //  0.12–0.26  feixe horizontal atravessa a tela
  //  0.14–0.30  o nome LARDAN emerge do clarão e assenta
  const iconOut = ease(phase(p, 0.05, 0.14));
  // Eclipse: a cena mergulha numa penumbra curta — é ela que dá contraste
  // ao clarão e ao feixe, como num corte de cinema.
  const eclipse = reduced ? 0 : ease(phase(p, 0.07, 0.13)) * (1 - ease(phase(p, 0.16, 0.27)));
  const flash = reduced ? 0 : phase(p, 0.1, 0.155) * (1 - ease(phase(p, 0.155, 0.22)));
  const beam = reduced ? 0 : phase(p, 0.11, 0.17) * (1 - easeOut(phase(p, 0.17, 0.26)));
  const wordmarkIn = easeOut(phase(p, 0.14, 0.27));
  const halo = reduced ? 0 : phase(p, 0.14, 0.21) * (1 - ease(phase(p, 0.23, 0.32)));
  const mostrarReflexo = !reduced && iconOut < 0.65;

  // O ícone "implode em luz": acende por dentro antes de ceder.
  const brilhoIcone = reduced ? 0 : phase(p, 0.06, 0.13);

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
            transform: `scale(${1 + iconOut * 0.22}) translate3d(0, ${iconOut * -2}vh, 0)`,
            filter: leve || iconOut === 0 ? undefined : `blur(${Math.round(iconOut * 26)}px)`,
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
            {/* O diamante acende por dentro instantes antes de ceder. */}
            {brilhoIcone > 0.005 && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  opacity: brilhoIcone * 0.9,
                  background:
                    "radial-gradient(circle, oklch(1 0 0 / 0.95) 0%, oklch(0.97 0.03 75 / 0.5) 42%, transparent 72%)",
                  WebkitMaskImage: `url(${diamanteAsset.url})`,
                  maskImage: `url(${diamanteAsset.url})`,
                  mixBlendMode: "screen",
                }}
              />
            )}
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

        {/* Eclipse cinematográfico: a cena escurece nas bordas no instante da troca. */}
        {eclipse > 0.005 && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              opacity: eclipse * 0.62,
              background:
                "radial-gradient(ellipse at center, oklch(0.24 0.02 45 / 0.55) 0%, oklch(0.2 0.02 45 / 0.85) 72%, oklch(0.18 0.02 45 / 0.95) 100%)",
            }}
          />
        )}

        {/* Clarão central: o "corte" de cinema entre ícone e nome. */}
        {flash > 0.005 && (
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 h-[42vh] w-[min(86vw,1080px)] -translate-x-1/2 -translate-y-1/2"
            style={{
              opacity: flash * 0.9,
              background:
                "radial-gradient(ellipse, oklch(1 0 0 / 0.95) 0%, oklch(0.98 0.02 75 / 0.5) 32%, oklch(0.95 0.03 60 / 0.15) 56%, transparent 78%)",
              filter: leve ? "blur(12px)" : "blur(24px)",
              transform: `translate3d(-50%, -50%, 0) scale(${0.55 + flash * 0.8})`,
              mixBlendMode: "screen",
            }}
          />
        )}

        {/* Feixe de luz horizontal que atravessa a tela no auge da troca. */}
        {beam > 0.005 && (
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{
              width: "120vw",
              height: "2px",
              opacity: beam,
              background:
                "linear-gradient(90deg, transparent 0%, oklch(1 0 0 / 0.85) 18%, oklch(1 0 0) 50%, oklch(1 0 0 / 0.85) 82%, transparent 100%)",
              boxShadow: leve
                ? undefined
                : "0 0 26px 8px oklch(0.99 0.01 75 / 0.55), 0 0 90px 30px oklch(0.96 0.03 60 / 0.3)",
              transform: `translate3d(-50%, -50%, 0) scaleX(${0.25 + easeOut(beam) * 0.95})`,
              mixBlendMode: "screen",
            }}
          />
        )}

        {/* Estado 2: nome LARDAN emerge do clarão, no mesmo cenário intacto. */}
        <div
          className="gpu-layer absolute inset-0 flex items-center justify-center"
          style={{
            opacity: clamp01(wordmarkIn),
            transform: `translate3d(0, ${(1 - wordmarkIn) * 2}vh, 0) scale(${1.12 - wordmarkIn * 0.12})`,
            filter:
              leve || wordmarkIn === 1 ? undefined : `blur(${Math.round((1 - wordmarkIn) * 22)}px)`,
            willChange: wordmarkIn > 0 && wordmarkIn < 1 ? "transform, opacity, filter" : "auto",
          }}
          aria-hidden={wordmarkIn < 0.5}
        >
          <div className="relative w-[clamp(240px,42vw,560px)]">
            {/* Halo de chegada: o nome nasce dentro da própria luz. */}
            {halo > 0.005 && (
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-[38%]"
                style={{
                  opacity: halo,
                  background:
                    "radial-gradient(ellipse, oklch(1 0 0 / 0.85) 0%, oklch(0.97 0.02 72 / 0.4) 45%, transparent 75%)",
                  filter: leve ? "blur(12px)" : "blur(24px)",
                  mixBlendMode: "screen",
                }}
              />
            )}
            <img
              src={wordmarkAsset.url}
              alt=""
              aria-hidden
              className="relative w-full"
              loading="eager"
              decoding="async"
              width={650}
              height={210}
              style={{
                filter: `drop-shadow(0 ${(46 - wordmarkIn * 26).toFixed(0)}px ${(80 - wordmarkIn * 32).toFixed(0)}px oklch(0.06 0.01 30 / 0.46))`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
