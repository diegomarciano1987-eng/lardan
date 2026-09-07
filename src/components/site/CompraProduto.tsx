import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ShoppingBag, Sparkles } from "lucide-react";
import { avisarSacola } from "@/lib/aviso";
import { adicionarAoCarrinho } from "@/lib/carrinho";

type Variante = { id: string; label: string };

export function CompraProduto({
  slug,
  nome,
  precoCents,
  mediaId,
  variantes,
}: {
  slug: string;
  nome: string;
  precoCents: number | null;
  mediaId: string | null;
  variantes: Variante[];
}) {
  const navigate = useNavigate();
  const [tamanho, setTamanho] = useState<string | null>(variantes[0]?.label ?? null);

  function guardar() {
    adicionarAoCarrinho({ slug, nome, variante: tamanho, precoCents, mediaId });
  }

  return (
    <div className="mt-8">
      {variantes.length > 1 ? (
        <div className="mb-6">
          <p className="mb-3 text-[0.625rem] tracking-[0.22em] uppercase text-muted-foreground">Tamanho</p>
          <div className="flex flex-wrap gap-2">
            {variantes.map((v) => {
              const ativo = v.label === tamanho;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setTamanho(v.label)}
                  aria-pressed={ativo}
                  className={`rounded-full border px-5 py-2 text-sm transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring ${
                    ativo
                      ? "border-foreground/60 bg-foreground/[0.06] text-foreground"
                      : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  }`}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => {
            guardar();
            navigate({ to: "/carrinho" });
          }}
          className="btn-premium w-full sm:w-auto"
        >
          <Sparkles className="h-4 w-4" strokeWidth={1.5} />
          Comprar agora
        </button>
        <button
          type="button"
          onClick={() => {
            guardar();
            avisarSacola({ nome, variante: tamanho, mediaId });
          }}
          className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-foreground/25 px-7 py-[0.875rem] text-xs tracking-[0.22em] uppercase text-foreground transition-all duration-300 hover:border-foreground/60 hover:bg-foreground/[0.04] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring sm:w-auto"
        >
          <ShoppingBag className="h-4 w-4" strokeWidth={1.5} />
          Adicionar à sacola
        </button>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        A finalização é feita com a sua consultora Lardan. O pagamento online ainda não está ativo.
      </p>
    </div>
  );
}
