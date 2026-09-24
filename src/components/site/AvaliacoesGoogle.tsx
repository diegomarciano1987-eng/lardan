import * as React from "react";
import { ExternalLink, Quote, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import mariaAsset from "@/assets/avaliacao-maria-fatima.png.asset.json";
import nataliaAsset from "@/assets/avaliacao-natalia-pedroso.png.asset.json";
import larissaAsset from "@/assets/avaliacao-larissa-persinato.png.asset.json";
import saraAsset from "@/assets/avaliacao-sara-danielly.png.asset.json";
import dudaAsset from "@/assets/avaliacao-duda-goes.png.asset.json";

const GOOGLE_REVIEWS_URL =
  "https://www.google.com/search?q=lardan#lrd=0x94eb4765591303db:0x6e4139909e180f1d,1";

type Avaliacao = { nome: string; foto: string; texto: string };

const AVALIACAO_MARIA: Avaliacao = {
  nome: "Maria Fatima",
  foto: mariaAsset.url,
  texto:
    "Excelente peças e com muita qualidade e charme. A Lardan Semi jóias chegou para ficar e deixar qualquer mulher valorizadas com suas peças. Só comprem que não vão se arrepender. A gerência é muito atenciosa para com os vendedores. Estou satisfeita com todas as jóias que tenho e que vendo.",
};

const AVALIACOES: readonly Avaliacao[] = [
  AVALIACAO_MARIA,
  {
    nome: "Natália Pedroso",
    foto: nataliaAsset.url,
    texto:
      "Excelente produto, 2 anos de garantia, sempre dão banho na peça de novo, quando precisa. Amo trabalhar com a marca, são super atenciosos.",
  },
  {
    nome: "Larissa Persinato",
    foto: larissaAsset.url,
    texto:
      "Peças de alta qualidade, sempre atualizadas e com durabilidade. O atendimento da equipe é nota mil!",
  },
  {
    nome: "Sara Danielly de Oliveira",
    foto: saraAsset.url,
    texto:
      "Experiência muito boa, todos são muito atenciosos, e a qualidade das joias são muito boas.",
  },
  {
    nome: "Duda Goes",
    foto: dudaAsset.url,
    texto: "Amei, perfeito!",
  },
] as const;

function ReviewCard({
  avaliacao,
  destaque,
}: {
  avaliacao: Avaliacao;
  destaque: boolean;
}) {
  return (
    <article
      className={cn(
        "avaliacao-card flex h-[36rem] min-w-0 flex-col border border-border bg-card p-7 md:h-[39rem] md:p-8",
        destaque ? "avaliacao-card--destaque" : "avaliacao-card--lateral",
      )}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <Quote aria-hidden="true" className="size-9 text-rose/55" strokeWidth={1.25} />
        <div className="flex items-center gap-0.5" aria-label="5 de 5 estrelas">
          {Array.from({ length: 5 }).map((_, index) => (
            <Star key={index} aria-hidden="true" className="size-4 fill-rose text-rose" />
          ))}
        </div>
      </div>

      <blockquote className="mt-7 flex-1 font-display text-xl leading-[1.55] text-foreground md:text-[1.35rem]">
        “{avaliacao.texto}”
      </blockquote>

      <div className="mt-8 flex min-w-0 items-center gap-4 border-t border-border pt-6">
        <img
          src={avaliacao.foto}
          alt={`Foto de ${avaliacao.nome}`}
          width={88}
          height={88}
          loading="lazy"
          decoding="async"
          className="size-[4.75rem] shrink-0 rounded-full border border-rose/35 object-cover shadow-[var(--shadow-soft)]"
        />
        <div className="min-w-0">
          <p className="truncate text-base font-medium text-foreground">{avaliacao.nome}</p>
          <p className="mt-1 text-[0.65rem] font-medium uppercase tracking-[0.18em] text-rose-deep">
            Avaliação no Google
          </p>
        </div>
      </div>
    </article>
  );
}

const INTERVALO_UNICA_MS = 1500;

export function AvaliacoesGoogle({ unica = false }: { unica?: boolean }) {
  const [ativa, setAtiva] = React.useState(0);
  const [pausado, setPausado] = React.useState(false);
  const toqueInicial = React.useRef<{ x: number; y: number } | null>(null);

  React.useEffect(() => {
    if (!unica) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (pausado) return;
    const timer = window.setInterval(() => {
      setAtiva((atual) => (atual + 1) % AVALIACOES.length);
    }, INTERVALO_UNICA_MS);
    return () => window.clearInterval(timer);
  }, [unica, pausado]);

  const avancar = React.useCallback((delta: number) => {
    setAtiva((atual) => (atual + delta + AVALIACOES.length) % AVALIACOES.length);
  }, []);


  return (
    <section
      aria-labelledby="avaliacoes-google-titulo"
      className="overflow-hidden border-t border-border bg-background"
    >
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <p className="brand-eyebrow mb-4">Quem conhece, recomenda</p>
          <h2
            id="avaliacoes-google-titulo"
            className="font-display text-3xl leading-tight text-foreground md:text-5xl"
          >
            Histórias reais, brilho que permanece.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
            A experiência de quem escolheu as semijoias Lardan.
          </p>
        </div>

        {unica ? (
          <div
            className="mx-auto mt-12 max-w-2xl touch-pan-y select-none md:mt-16"
            aria-live="polite"
            aria-label="Avaliações de clientes no Google"
            onMouseEnter={() => setPausado(true)}
            onMouseLeave={() => setPausado(false)}
            onTouchStart={(e) => {
              const toque = e.touches[0];
              toqueInicial.current = { x: toque.clientX, y: toque.clientY };
              setPausado(true);
            }}
            onTouchEnd={(e) => {
              const inicio = toqueInicial.current;
              toqueInicial.current = null;
              setPausado(false);
              if (!inicio) return;
              const toque = e.changedTouches[0];
              const dx = toque.clientX - inicio.x;
              const dy = toque.clientY - inicio.y;
              // Arraste horizontal claro: passa para o depoimento ao lado.
              if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                avancar(dx < 0 ? 1 : -1);
              }
            }}
          >
            <div
              key={ativa}
              className="avaliacao-unica cursor-grab active:cursor-grabbing"
            >
              <ReviewCard avaliacao={AVALIACOES[ativa] ?? AVALIACAO_MARIA} destaque />
            </div>
            <div className="mt-6 flex justify-center gap-2" role="tablist" aria-label="Escolher avaliação">
              {AVALIACOES.map((avaliacao, index) => (
                <button
                  key={avaliacao.nome}
                  type="button"
                  role="tab"
                  aria-selected={index === ativa}
                  aria-label={`Ver avaliação de ${avaliacao.nome}`}
                  onClick={() => setAtiva(index)}
                  className={cn(
                    "size-2 rounded-full transition-all duration-300",
                    index === ativa ? "w-6 bg-rose" : "bg-rose/30 hover:bg-rose/55",
                  )}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="avaliacoes-janela mt-12 select-none overflow-hidden md:mt-16">
            <div className="avaliacoes-trilho flex gap-5" aria-label="Avaliações de clientes no Google">
              {[...AVALIACOES, ...AVALIACOES].map((avaliacao, index) => (
                <div
                  key={`${avaliacao.nome}-${index}`}
                  className="avaliacoes-item shrink-0"
                  aria-hidden={index >= AVALIACOES.length ? "true" : undefined}
                >
                  <ReviewCard avaliacao={avaliacao} destaque />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-10 flex justify-center">
          <a
            href={GOOGLE_REVIEWS_URL}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center gap-3 rounded-full border border-rose/40 bg-card px-6 py-3 shadow-[var(--shadow-soft)] transition-all duration-300 hover:-translate-y-0.5 hover:border-rose hover:shadow-[var(--shadow-elegant)] md:px-7 md:py-3.5"
          >
            <svg aria-hidden="true" viewBox="0 0 48 48" className="size-6 shrink-0 md:size-7">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
            <span className="text-sm font-semibold tracking-wide text-foreground md:text-base">
              Ver mais avaliações no <span className="font-bold">Google</span>
            </span>
            <ExternalLink
              aria-hidden="true"
              className="size-4 text-rose-deep transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </a>
        </div>
      </div>
    </section>
  );
}