import * as React from "react";
import { MapPin, Play } from "lucide-react";
import depoimentoAsset from "@/assets/denise-carina-depoimento.mp4.asset.json";
import depoimentoWebmAsset from "@/assets/denise-carina-depoimento.webm.asset.json";
import posterAsset from "@/assets/denise-carina-poster.webp.asset.json";
import { CinematicTitle } from "./CinematicTitle";

export function DepoimentoDenise() {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [tocando, setTocando] = React.useState(false);
  return (
    <section
      aria-labelledby="depoimento-denise-titulo"
      className="border-t border-border bg-secondary/40"
    >
      <div className="mx-auto max-w-3xl px-6 py-20 text-center md:py-28">
        <p className="brand-eyebrow mb-4">Depoimento real</p>
        <CinematicTitle
          id="depoimento-denise-titulo"
          className="text-3xl leading-tight text-foreground md:text-5xl"
        >
          Independência financeira construída com semijoias.
        </CinematicTitle>
        <div className="rose-rule mx-auto mt-8 w-20" />
        <p className="mx-auto mt-8 max-w-xl font-display text-[clamp(1.25rem,2.3vw,1.75rem)] leading-[1.42] text-foreground">
          A Denise conta, no vídeo, como as semijoias da Lardan abriram o caminho para a
          independência financeira dela.
        </p>

        <div className="relative mx-auto mt-12 w-full max-w-[24rem]">
          <div aria-hidden="true" className="absolute -inset-3 border border-rose/25" />
          <video
            ref={videoRef}
            controls={tocando}
            onPlay={() => setTocando(true)}
            playsInline
            preload="metadata"
            poster={posterAsset.url}
            aria-label="Depoimento de Denise Carina, Consultora Lardan de Ponta Grossa"
            className="relative aspect-[9/16] w-full bg-foreground object-cover shadow-[var(--shadow-soft)]"
          >
            <source src={depoimentoWebmAsset.url} type="video/webm" />
            <source src={depoimentoAsset.url} type="video/mp4" />
            Seu navegador não consegue reproduzir este vídeo.
          </video>
          {!tocando ? (
            <button
              type="button"
              onClick={() => void videoRef.current?.play()}
              aria-label="Assistir ao depoimento da Denise"
              className="group absolute inset-0 flex items-center justify-center"
            >
              <span className="flex size-24 items-center justify-center rounded-full bg-background/90 text-rose-deep shadow-[var(--shadow-soft)] ring-8 ring-background/30 transition duration-300 group-hover:scale-110 group-focus-visible:scale-110 md:size-28">
                <Play aria-hidden="true" className="ml-1.5 size-10 fill-current md:size-12" />
              </span>
            </button>
          ) : null}
        </div>

        <div className="mt-10">
          <p className="font-display text-2xl text-foreground">Denise Carina</p>
          <p className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-rose-deep">
            Consultora Lardan
          </p>
          <p className="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <MapPin aria-hidden="true" className="size-4 text-rose" />
            Ponta Grossa — PR
          </p>
        </div>

        <a href="#candidatura" className="btn-premium mt-10 inline-flex items-center gap-2">
          <Play aria-hidden="true" className="size-4" />
          Quero começar minha história
        </a>
      </div>
    </section>
  );
}
