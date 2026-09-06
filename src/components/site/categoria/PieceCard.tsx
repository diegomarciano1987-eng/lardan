import { Link } from "@tanstack/react-router";
import { formatPreco, mediaUrl, type PecaVitrine } from "@/lib/storefront";
import { cn } from "@/lib/utils";

export type EscalaPeca = "abertura" | "ampla" | "padrao" | "discreta";

interface PieceCardProps {
  peca: PecaVitrine;
  escala?: EscalaPeca;
  proporcao: string;
  proporcaoDestaque: string;
  moldura: string;
  /** true apenas para a primeira imagem acima da dobra. */
  prioridade?: boolean;
  /** Volta para a listagem com os mesmos filtros e posição. */
  contexto?: Record<string, unknown>;
}

export function PieceCard({
  peca,
  escala = "padrao",
  proporcao,
  proporcaoDestaque,
  moldura,
  prioridade = false,
  contexto,
}: PieceCardProps) {
  const capa = mediaUrl(peca.cover_media_id);
  const segunda = mediaUrl(peca.hover_media_id);
  const preco = formatPreco(peca.price_cents);
  const grande = escala === "abertura" || escala === "ampla";
  const ratio = grande ? proporcaoDestaque : proporcao;

  return (
    <Link
      to="/produto/$slug"
      params={{ slug: peca.slug }}
      {...(contexto ? { state: { voltarPara: contexto } as never } : {})}
      className={cn(
        "group relative block focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-ring",
        escala === "discreta" && "opacity-95",
      )}
      aria-label={`Conhecer a peça ${peca.name}`}
    >
      <figure className="m-0">
        <div
          className={cn(
            "relative overflow-hidden bg-[color-mix(in_oklab,var(--muted)_55%,transparent)]",
            moldura,
          )}
          style={{ aspectRatio: ratio }}
        >
          {capa ? (
            <>
              <img
                src={capa}
                alt={peca.cover_alt?.trim() || `${peca.name} — semijoia Lardan`}
                loading={prioridade ? "eager" : "lazy"}
                decoding={prioridade ? "sync" : "async"}
                fetchPriority={prioridade ? "high" : "auto"}
                sizes={grande ? "(max-width: 768px) 92vw, 66vw" : "(max-width: 768px) 92vw, 33vw"}
                className={cn(
                  "size-full object-cover transition-[transform,opacity] duration-[600ms] ease-out",
                  "motion-reduce:transition-none",
                  segunda ? "group-hover:opacity-0" : "group-hover:scale-[1.02]",
                )}
              />
              {segunda ? (
                <img
                  src={segunda}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-[600ms] ease-out group-hover:opacity-100 motion-reduce:transition-none"
                />
              ) : null}
            </>
          ) : (
            <div className="flex size-full items-center justify-center text-[0.65rem] uppercase tracking-[0.3em] text-muted-foreground">
              Imagem em produção
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-[color-mix(in_oklab,var(--rose)_16%,transparent)]" />
        </div>

        <figcaption
          className={cn(
            "flex flex-col gap-1 pt-6",
            escala === "abertura" ? "max-w-md" : "max-w-sm",
          )}
        >
          {peca.collection_name ? (
            <span className="brand-eyebrow">{peca.collection_name}</span>
          ) : null}
          <h3
            className={cn(
              "font-display leading-tight text-foreground",
              escala === "abertura"
                ? "text-3xl md:text-4xl"
                : grande
                  ? "text-2xl md:text-3xl"
                  : "text-xl md:text-2xl",
            )}
          >
            {peca.name}
          </h3>
          {peca.material || peca.plating ? (
            <p className="text-sm text-muted-foreground">
              {[peca.material, peca.plating].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          {escala === "abertura" && peca.short_description ? (
            <p className="mt-1 max-w-prose text-base leading-relaxed text-muted-foreground">
              {peca.short_description}
            </p>
          ) : null}
          {preco ? <p className="pt-1 text-base text-foreground">{preco}</p> : null}
          {!peca.em_estoque ? (
            <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
              Peça indisponível no momento
            </p>
          ) : null}
          <span className="mt-3 inline-flex w-fit items-center gap-2 border-b border-[color-mix(in_oklab,var(--rose)_45%,transparent)] pb-1 text-[0.7rem] uppercase tracking-[0.24em] text-foreground/80 transition-colors duration-300 group-hover:text-foreground">
            Conhecer a peça
          </span>
        </figcaption>
      </figure>
    </Link>
  );
}

export function PieceSkeleton({ proporcao, moldura }: { proporcao: string; moldura: string }) {
  return (
    <div>
      <div
        className={cn(
          "animate-pulse bg-[color-mix(in_oklab,var(--muted)_70%,transparent)]",
          moldura,
        )}
        style={{ aspectRatio: proporcao }}
      />
      <div className="mt-6 h-4 w-1/2 animate-pulse rounded bg-[color-mix(in_oklab,var(--muted)_70%,transparent)]" />
      <div className="mt-3 h-3 w-1/3 animate-pulse rounded bg-[color-mix(in_oklab,var(--muted)_60%,transparent)]" />
    </div>
  );
}
