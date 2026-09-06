import { BRAND } from "@/lib/brand";
import { useScrollProgress, useDeviceTier, phase, ease } from "@/hooks/use-scroll-progress";
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
 * Narrativa de scroll da home (V/5):
 * 1. Diamante nítido sobre a onda de vidro.
 * 2. O diamante avança na câmera, estoura em luz e se dissolve.
 * 3. Wordmark LARDAN surge com sombra longa dentro de um quadro em penumbra
 *    — apenas marca, nenhuma modelo — e um fio de luz percorre as letras.
 * 4. Clarão quente atravessa o quadro e entrega a cena à segunda sessão,
 *    sem trechos de rolagem vazios.
 * Sem scroll hijacking: a rolagem é nativa; apenas as camadas reagem.
 */
export function HeroScroll() {
  const { ref: trackRef, progress, reduced } = useScrollProgress<HTMLDivElement>();
  const tier = useDeviceTier();
  const leve = tier === "leve";

  // Com reduced motion, mostra o wordmark final diretamente.
  const p = reduced ? 1 : progress;

  const out = ease(phase(p, 0.12, 0.44)); // saída do diamante
  const flash = phase(p, 0.3, 0.42) * (1 - phase(p, 0.42, 0.56)); // estouro de luz
  const wordmarkIn = ease(phase(p, 0.36, 0.62));
  // Passagem final: o wordmark avança na câmera e se dissolve na segunda sessão.
  const sai = reduced ? 0 : ease(phase(p, 0.82, 1));
  const varredura = phase(p, 0.46, 0.8); // fio de luz percorrendo as letras
  const mostrarBrilho = !reduced && out < 0.35;
  const sombra = (1 - wordmarkIn) * 30; // sombra longa que encurta ao assentar
  // Penumbra cinematográfica sobre a onda de vidro: o wordmark brilha dentro
  // de um quadro escuro — apenas a marca, nenhuma modelo no hero.
  const penumbra = ease(phase(p, 0.34, 0.66)) * (1 - sai);

  return (
    <div ref={trackRef} className="relative h-[230vh]" aria-label={BRAND.name}>
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

        {/* Cena da segunda sessão surgindo em penumbra por trás do wordmark */}
        {cena > 0.002 && (
          <>
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
                alt=""
                aria-hidden
                className="gpu-layer absolute inset-0 h-full w-full object-cover"
                style={{
                  opacity: cena,
                  transform: `scale(${(1.34 - 0.26 * cena - 0.06 * sai).toFixed(3)}) translateZ(0)`,
                  filter: leve
                    ? undefined
                    : `blur(${stepBlur((1 - cena) * 26 + sai * 6, 2)}px) saturate(${(0.75 + cena * 0.35).toFixed(2)})`,
                }}
                loading="lazy"
                decoding="async"
                width={1664}
                height={928}
              />
            </picture>
            {/* Penumbra cinematográfica + vinheta: o wordmark passa a brilhar
                dentro de um quadro escuro, nunca sobre uma tela branca. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                opacity: penumbra,
                background:
                  "radial-gradient(120% 90% at 50% 50%, oklch(0.2 0.02 25 / 0.28) 0%, oklch(0.13 0.015 25 / 0.6) 62%, oklch(0.1 0.012 25 / 0.78) 100%)",
              }}
            />
          </>
        )}

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
            <picture>
              <source srcSet="/img/lardan-diamante.webp" type="image/webp" />
              <img
                src={diamanteAsset.url}
                alt="Lardan"
                className="w-full"
                decoding="async"
                fetchPriority="high"
                width={624}
                height={416}
              />
            </picture>
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

        {/* Estado 2: wordmark isolado — entra com sombra longa e sai fundindo
            com a segunda sessão (avança na câmera e se dissolve em marfim). */}
        <div
          className="gpu-layer absolute inset-0 flex items-center justify-center"
          style={{
            opacity: clamp01(wordmarkIn - sai * 1.15),
            transform: `scale(${(0.9 + wordmarkIn * 0.1) * (1 + sai * 1.5)}) translate3d(0, ${sai * -4}vh, 0)`,
            filter:
              leve || (wordmarkIn === 1 && sai === 0)
                ? undefined
                : `blur(${stepBlur((1 - wordmarkIn) * 10 + sai * 18, 2)}px)`,
            willChange: wordmarkIn > 0 && sai < 1 ? "transform, opacity" : "auto",
          }}
          aria-hidden={wordmarkIn < 0.5}
        >
          <div className="relative w-[clamp(240px,42vw,560px)]">
            <picture>
              <source srcSet="/img/lardan-wordmark.webp" type="image/webp" />
              <img
                src={wordmarkAsset.url}
                alt=""
                aria-hidden
                className="w-full"
                loading="lazy"
                decoding="async"
                width={650}
                height={210}
                style={{
                  filter: leve
                    ? undefined
                    : `drop-shadow(0 ${(10 + sombra).toFixed(0)}px ${(28 + sombra * 2.4).toFixed(0)}px oklch(0.06 0.01 30 / ${(0.3 + wordmarkIn * 0.35).toFixed(2)})) drop-shadow(0 0 ${(30 + wordmarkIn * 40).toFixed(0)}px oklch(0.85 0.06 40 / ${(0.18 * wordmarkIn).toFixed(2)})) brightness(${(1 + cena * 0.25).toFixed(2)})`,
                }}
              />
            </picture>
            {!leve && !reduced && varredura > 0.001 && varredura < 0.999 && (
              <div
                aria-hidden
                className="hero-wordmark-sweep pointer-events-none absolute inset-0"
                style={{
                  WebkitMaskImage: `url(${wordmarkAsset.url})`,
                  maskImage: `url(${wordmarkAsset.url})`,
                  backgroundPosition: `${(130 - varredura * 190).toFixed(1)}% 0`,
                  opacity: Math.min(1, varredura * 4) * (1 - varredura) * 1.6,
                }}
              />
            )}
          </div>
        </div>

        {/* Passagem final: um clarão quente atravessa o quadro e entrega a
            cena já escurecida para a segunda sessão — sem corte, sem branco. */}
        {sai > 0.001 && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              opacity: ease(sai),
              background:
                "radial-gradient(120% 90% at 50% 46%, oklch(1 0 0 / 0.98) 0%, oklch(0.99 0.01 70 / 0.92) 45%, oklch(0.985 0.006 80 / 0.98) 100%)",
            }}
          />
        )}
      </div>
    </div>
  );
}
