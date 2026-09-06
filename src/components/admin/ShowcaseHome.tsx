import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { EmptyState, Panel } from "@/components/admin/ui";
import {
  getHomeCuration,
  listTaxonomia,
  saveHomeCuration,
  type HomeBloco,
} from "@/lib/showcase";

/** Curadoria dos blocos da página inicial do site. */
export function ShowcaseHome({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const [blocos, setBlocos] = React.useState<HomeBloco[] | null>(null);
  const [salvo, setSalvo] = React.useState(false);

  const atual = useQuery({ queryKey: ["vitrine", "home"], queryFn: getHomeCuration });
  const categorias = useQuery({ queryKey: ["vitrine", "taxonomia", "categories"], queryFn: () => listTaxonomia("categories") });
  const colecoes = useQuery({ queryKey: ["vitrine", "taxonomia", "collections"], queryFn: () => listTaxonomia("collections") });

  React.useEffect(() => {
    if (atual.data && !blocos) setBlocos(atual.data);
  }, [atual.data, blocos]);

  const gravar = useMutation({
    mutationFn: () => saveHomeCuration(blocos ?? []),
    onSuccess: () => {
      setSalvo(true);
      void qc.invalidateQueries({ queryKey: ["vitrine", "home"] });
    },
  });

  if (!blocos) {
    return <Panel title="Página inicial"><EmptyState title="Carregando" description="Buscando a curadoria atual da página inicial." /></Panel>;
  }

  const ordenados = [...blocos].sort((a, b) => a.ordem - b.ordem);

  const mover = (chave: HomeBloco["chave"], direcao: -1 | 1) => {
    const idx = ordenados.findIndex((b) => b.chave === chave);
    const alvo = idx + direcao;
    if (alvo < 0 || alvo >= ordenados.length) return;
    const copia = [...ordenados];
    const a = copia[idx]!;
    const b = copia[alvo]!;
    copia[idx] = b;
    copia[alvo] = a;
    setBlocos(copia.map((bl, i) => ({ ...bl, ordem: i + 1 })));
    setSalvo(false);
  };

  const alternar = (chave: HomeBloco["chave"]) => {
    setBlocos(ordenados.map((b) => (b.chave === chave ? { ...b, visivel: !b.visivel } : b)));
    setSalvo(false);
  };

  const alternarItem = (chave: HomeBloco["chave"], id: string) => {
    setBlocos(
      ordenados.map((b) =>
        b.chave === chave
          ? { ...b, itens: b.itens.includes(id) ? b.itens.filter((x) => x !== id) : [...b.itens, id] }
          : b,
      ),
    );
    setSalvo(false);
  };

  return (
    <Panel
      title="Curadoria da página inicial"
      action={
        podeEditar ? (
          <button type="button" className="admin-btn-primary" disabled={gravar.isPending} onClick={() => gravar.mutate()}>
            Salvar página inicial
          </button>
        ) : null
      }
    >
      <p className="text-sm text-ledger-muted">
        Escolha quais blocos aparecem na página inicial, em que ordem, e quais coleções ou categorias entram em cada
        um. Nada aqui altera produtos — apenas a vitrine.
      </p>

      <ul className="mt-6 space-y-4">
        {ordenados.map((b, i) => {
          const opcoes =
            b.chave === "colecoes" ? colecoes.data ?? [] : b.chave === "categorias" ? categorias.data ?? [] : [];
          return (
            <li key={b.chave} className="rounded-[12px] border border-line px-5 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-ledger-text">{b.titulo}</p>
                  <p className="text-xs text-ledger-muted">Posição {i + 1} · {b.visivel ? "visível no site" : "oculto"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" className="admin-btn" disabled={!podeEditar || i === 0} onClick={() => mover(b.chave, -1)}>
                    <ArrowUp aria-hidden className="size-4" />
                  </button>
                  <button type="button" className="admin-btn" disabled={!podeEditar || i === ordenados.length - 1} onClick={() => mover(b.chave, 1)}>
                    <ArrowDown aria-hidden className="size-4" />
                  </button>
                  <button type="button" className="admin-btn" disabled={!podeEditar} onClick={() => alternar(b.chave)}>
                    {b.visivel ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
                    {b.visivel ? "Ocultar" : "Mostrar"}
                  </button>
                </div>
              </div>

              {opcoes.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-line-soft pt-4">
                  {opcoes.map((o) => {
                    const ativo = b.itens.includes(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        disabled={!podeEditar}
                        onClick={() => alternarItem(b.chave, o.id)}
                        className={
                          ativo
                            ? "rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-ink-foreground"
                            : "rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ledger-muted hover:border-champagne"
                        }
                      >
                        {o.name}
                        {o.status !== "publicado" && " · oculta"}
                      </button>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {salvo && (
        <p className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-success">
          <CheckCircle2 aria-hidden className="size-4" /> Página inicial atualizada.
        </p>
      )}
    </Panel>
  );
}
