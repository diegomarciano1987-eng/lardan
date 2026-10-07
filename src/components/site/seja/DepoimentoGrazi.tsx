import * as React from "react";
import { MapPin, Play } from "lucide-react";
import { CinematicTitle } from "./CinematicTitle";

const VIDEO_ID = "oDi3Y6DSI5A";

export function DepoimentoGrazi() {
  const [tocando, setTocando] = React.useState(false);
  return (
    <section aria-labelledby="depoimento-grazi-titulo" className="border-t border-border">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 md:grid-cols-[minmax(22rem,1fr)_minmax(18rem,0.8fr)] md:gap-20 md:py-28">
        <div className="relative mx-auto w-full max-w-[24rem] md:order-2">
          <div aria-hidden="true" className="absolute -inset-3 border border-rose/25" />
          <div className="relative aspect-[9/16] w-full overflow-hidden bg-foreground shadow-[var(--shadow-soft)]">
            {tocando ? (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0&playsinline=1`}
                title="Depoimento da Grazi, Consultora Lardan de Echaporã — SP"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                className="absolute inset-0 size-full"
              />
            ) : (
              <button
                type="button"
                onClick={() => setTocando(true)}
                aria-label="Assistir ao depoimento da Grazi"
                className="group absolute inset-0 flex items-center justify-center"
              >
                <img
                  src={`https://i.ytimg.com/vi/${VIDEO_ID}/oar2.jpg`}
                  onError={(e) => {
                    e.currentTarget.src = `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`;
                  }}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover"
                />
                <span className="relative flex size-24 items-center justify-center rounded-full bg-background/90 text-rose-deep shadow-[var(--shadow-soft)] ring-8 ring-background/30 transition duration-300 group-hover:scale-110 group-focus-visible:scale-110 md:size-28">
                  <Play aria-hidden="true" className="ml-1.5 size-10 fill-current md:size-12" />
                </span>
              </button>
            )}
          </div>
        </div>

        <div className="md:order-1 md:py-8">
          <p className="brand-eyebrow mb-4">História real</p>
          <CinematicTitle
            id="depoimento-grazi-titulo"
            className="text-3xl leading-tight text-foreground md:text-5xl"
          >
            Começou dentro de casa. E mudou uma realidade.
          </CinematicTitle>
          <div className="rose-rule mt-8 w-20" />
          <p className="mt-8 max-w-xl font-display text-[clamp(1.25rem,2.3vw,1.75rem)] leading-[1.42] text-foreground">
            Sem roteiro e sem produção: a Grazi conta, do jeito dela, como a Lardan entrou na sua
            rotina e a ajudou a crescer.
          </p>
          <ul className="mt-8 max-w-xl space-y-3 text-base text-muted-foreground">
            <li className="flex gap-3"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-rose" />Como começou com a maleta consignada, sem investir para começar</li>
            <li className="flex gap-3"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-rose" />O apoio da equipe e do treinamento da Lardan Academy</li>
            <li className="flex gap-3"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-rose" />O que mudou na rotina e na renda depois de virar consultora</li>
          </ul>

          <div className="mt-10 border-l-2 border-rose pl-5">
            <p className="font-display text-2xl text-foreground">Grazi</p>
            <p className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-rose-deep">
              Consultora Lardan
            </p>
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin aria-hidden="true" className="size-4 text-rose" />
              Echaporã — SP
            </p>
          </div>

          <a href="#candidatura" className="btn-premium mt-10 inline-flex items-center gap-2">
            <Play aria-hidden="true" className="size-4" />
            Quero começar minha história
          </a>
        </div>
      </div>
    </section>
  );
}
