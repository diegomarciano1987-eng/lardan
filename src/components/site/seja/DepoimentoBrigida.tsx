import * as React from "react";
import { MapPin, Play } from "lucide-react";
import depoimentoAsset from "@/assets/brigida-carla-giroudo-depoimento.mp4.asset.json";
import depoimentoWebmAsset from "@/assets/brigida-carla-giroudo-depoimento.webm.asset.json";
import posterAsset from "@/assets/brigida-carla-giroudo-poster.webp.asset.json";
import { CinematicTitle } from "./CinematicTitle";

export function DepoimentoBrigida() {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [tocando, setTocando] = React.useState(false);
  return (
    <section
      aria-labelledby="depoimento-brigida-titulo"
      className="border-t border-border bg-secondary/40"
    >
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 md:grid-cols-[minmax(18rem,0.8fr)_minmax(22rem,1fr)] md:gap-20 md:py-28">
        <div className="relative mx-auto w-full max-w-[24rem]">
          <div aria-hidden="true" className="absolute -inset-3 border border-rose/25" />
          <video
            ref={videoRef}
            controls={tocando}
            onPlay={() => setTocando(true)}
            playsInline
            preload="metadata"
            poster={posterAsset.url}
            aria-label="Depoimento de Brígida Carla Giroudo, Consultora Diamante Lardan"
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
              aria-label="Assistir ao depoimento da Brígida"
              className="group absolute inset-0 flex items-center justify-center"
            >
              <span className="flex size-24 items-center justify-center rounded-full bg-background/90 text-rose-deep shadow-[var(--shadow-soft)] ring-8 ring-background/30 transition duration-300 group-hover:scale-110 group-focus-visible:scale-110 md:size-28">
                <Play aria-hidden="true" className="ml-1.5 size-10 fill-current md:size-12" />
              </span>
            </button>
          ) : null}
        </div>

        <div className="md:py-8">
          <p className="brand-eyebrow mb-4">Depoimento real</p>
          <CinematicTitle
            id="depoimento-brigida-titulo"
            className="text-3xl leading-tight text-foreground md:text-5xl"
          >
            A voz de quem vive a experiência Lardan.
          </CinematicTitle>
          <div className="rose-rule mt-8 w-20" />
          <blockquote className="mt-8 max-w-xl font-display text-[clamp(1.25rem,2.3vw,1.75rem)] leading-[1.42] text-foreground">
            “Um depoimento real sobre escolhas, conquistas e o caminho construído como Consultora
            Lardan.”
          </blockquote>

          <div className="mt-10 border-l-2 border-rose pl-5">
            <p className="font-display text-2xl text-foreground">Brígida Carla Giroudo</p>
            <p className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-rose-deep">
              Consultora Diamante Lardan
            </p>
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin aria-hidden="true" className="size-4 text-rose" />
              Ibiporã — PR
            </p>
          </div>

          <a href="#candidatura" className="btn-premium mt-10 inline-flex items-center gap-2">
            <Play aria-hidden="true" className="size-4" />
            Quero escrever minha história
          </a>
        </div>
      </div>
    </section>
  );
}