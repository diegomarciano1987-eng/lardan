import * as React from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Quote, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export function AvaliacoesGoogle() {
  const [ativa, setAtiva] = React.useState(0);
  const [destino, setDestino] = React.useState<number | null>(null);
  const [interagindo, setInteragindo] = React.useState(false);
  const gestoInicio = React.useRef<number | null>(null);
  const trocaPendente = React.useRef<number | null>(null);
  const trocando = React.useRef(false);

  const selecionar = React.useCallback((proxima: number) => {
    if (trocando.current) return;
    const indice = (proxima + AVALIACOES.length) % AVALIACOES.length;
    if (indice === ativa) return;
    trocando.current = true;
    setDestino(indice);
    trocaPendente.current = window.setTimeout(() => {
      setAtiva(indice);
      setDestino(null);
      trocando.current = false;
      trocaPendente.current = null;
    }, 560);
  }, [ativa]);

  React.useEffect(() => {
    if (interagindo || destino !== null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timer = window.setTimeout(() => selecionar(ativa + 1), 3000);
    return () => window.clearTimeout(timer);
  }, [ativa, destino, interagindo, selecionar]);

  React.useEffect(
    () => () => {
      if (trocaPendente.current !== null) window.clearTimeout(trocaPendente.current);
      trocando.current = false;
    },
    [],
  );

  const anterior = (ativa - 1 + AVALIACOES.length) % AVALIACOES.length;
  const proxima = (ativa + 1) % AVALIACOES.length;
  const avaliacaoAnterior = AVALIACOES[anterior] ?? AVALIACAO_MARIA;
  const avaliacaoAtiva = AVALIACOES[ativa] ?? AVALIACAO_MARIA;
  const avaliacaoProxima = AVALIACOES[proxima] ?? AVALIACAO_MARIA;
  const avaliacaoDestino = destino === null ? null : (AVALIACOES[destino] ?? AVALIACAO_MARIA);

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

        <div
          className="mt-12 touch-pan-y md:mt-16"
          onPointerEnter={() => setInteragindo(true)}
          onPointerLeave={() => {
            gestoInicio.current = null;
            setInteragindo(false);
          }}
          onPointerDown={(event) => {
            gestoInicio.current = event.clientX;
            setInteragindo(true);
          }}
          onPointerUp={(event) => {
            const inicio = gestoInicio.current;
            gestoInicio.current = null;
            setInteragindo(false);
            if (inicio === null) return;
            const distancia = event.clientX - inicio;
            if (Math.abs(distancia) < 45) return;
            selecionar(distancia < 0 ? ativa + 1 : ativa - 1);
          }}
        >
          <div
            className="avaliacoes-palco grid min-w-0 gap-5 md:grid-cols-3 md:items-stretch"
            aria-live="polite"
          >
            <ReviewCard avaliacao={avaliacaoAnterior} destaque={false} />
            <div className="avaliacao-card-stack relative h-[36rem] min-w-0 md:h-[39rem]">
              <div className={cn("absolute inset-0", avaliacaoDestino && "avaliacao-card--saindo")}>
                <ReviewCard avaliacao={avaliacaoAtiva} destaque />
              </div>
              {avaliacaoDestino ? (
                <div className="avaliacao-card--entrando absolute inset-0">
                  <ReviewCard avaliacao={avaliacaoDestino} destaque />
                </div>
              ) : null}
            </div>
            <ReviewCard avaliacao={avaliacaoProxima} destaque={false} />
          </div>
        </div>

        <div className="mt-8 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => selecionar(ativa - 1)}
            aria-label="Ver avaliação anterior"
            className="size-11 rounded-full"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>

          <div className="flex min-w-0 justify-center gap-2" aria-label="Escolher avaliação">
            {AVALIACOES.map((avaliacao, index) => (
              <Button
                key={avaliacao.nome}
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => selecionar(index)}
                aria-label={`Ver avaliação de ${avaliacao.nome}`}
                aria-current={index === ativa ? "true" : undefined}
                className="size-8 rounded-full p-0"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "block h-1.5 rounded-full transition-all duration-500",
                    index === ativa ? "w-7 bg-rose-deep" : "w-1.5 bg-border",
                  )}
                />
              </Button>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => selecionar(ativa + 1)}
            aria-label="Ver próxima avaliação"
            className="size-11 rounded-full"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>

        <div className="mt-8 text-center">
          <a
            href={GOOGLE_REVIEWS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-rose-deep underline-offset-8 transition-colors hover:text-foreground hover:underline"
          >
            Ver avaliações no Google
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        </div>
      </div>
    </section>
  );
}