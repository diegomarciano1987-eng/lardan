import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateField } from "@/components/premium/DateField";
import { CHECKLIST_LABEL, BULK_LABEL, runBulk, listCategoriasSimples, listColecoesSimples } from "@/lib/showcase";
import type { BulkAction, BulkResult, ShowcaseFilters } from "@/lib/showcase";
import { formatInt } from "@/components/admin/ui";

interface Props {
  acao: BulkAction;
  ids: string[];
  filtros: ShowcaseFilters;
  onClose: () => void;
}

const ESTOQUE_OPCOES = [
  { value: "manter_visivel", label: "Manter visível como indisponível" },
  { value: "ocultar_ao_zerar", label: "Ocultar automaticamente quando zerar" },
  { value: "consulta", label: "Manter visível e permitir consulta" },
  { value: "institucional", label: "Manter visível para apresentação institucional" },
];

/** Confirmação de ação em massa: impacto, impedimentos e chave idempotente. */
export function ShowcaseBulkDialog({ acao, ids, filtros, onClose }: Props) {
  const qc = useQueryClient();
  const chave = React.useMemo(() => crypto.randomUUID(), []);
  const [categoriaId, setCategoriaId] = React.useState("");
  const [colecaoId, setColecaoId] = React.useState("");
  const [quando, setQuando] = React.useState<Date | undefined>(undefined);
  const [estrategia, setEstrategia] = React.useState("manter_visivel");
  const [nota, setNota] = React.useState("");
  const [resultado, setResultado] = React.useState<BulkResult | null>(null);

  const categorias = useQuery({
    queryKey: ["categorias-simples"],
    queryFn: listCategoriasSimples,
    enabled: acao === "definir_categoria",
  });
  const colecoes = useQuery({
    queryKey: ["colecoes-simples"],
    queryFn: listColecoesSimples,
    enabled: acao === "adicionar_colecao",
  });

  const executar = useMutation({
    mutationFn: () => {
      const extras: Record<string, unknown> = {};
      if (acao === "definir_categoria") extras["categoria_id"] = categoriaId;
      if (acao === "adicionar_colecao") extras["colecao_id"] = colecaoId;
      if (acao === "programar") extras["quando"] = quando?.toISOString();
      if (acao === "estoque_visibilidade") extras["estrategia"] = estrategia;
      return runBulk({ acao, ids, params: extras, filtros, chave, nota });
    },
    onSuccess: (r) => {
      setResultado(r);
      void qc.invalidateQueries({ queryKey: ["vitrine"] });
    },
  });

  const faltaParametro =
    (acao === "definir_categoria" && !categoriaId) ||
    (acao === "adicionar_colecao" && !colecaoId) ||
    (acao === "programar" && !quando);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-4" role="dialog" aria-modal="true">
      <div className="ledger-panel w-full max-w-2xl overflow-hidden">
        <header className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
          <div>
            <p className="ledger-eyebrow">Ação em massa</p>
            <h2 className="mt-1 text-xl font-semibold text-ledger-text">{BULK_LABEL[acao]}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="admin-btn size-10 justify-center p-0">
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <div className="space-y-5 px-6 py-6">
          {resultado ? (
            <div className="space-y-4">
              <p className="inline-flex items-center gap-2 text-[0.9375rem] font-semibold text-ledger-text">
                <CheckCircle2 aria-hidden className="size-4 text-success" />
                {formatInt(resultado.afetados)} produto(s) atualizados
                {resultado.repetido ? " (lote já executado — nada foi repetido)" : ""}
              </p>
              {resultado.rejeitados > 0 && (
                <div className="rounded-[10px] border border-line bg-surface-muted px-4 py-3">
                  <p className="inline-flex items-center gap-2 text-sm font-semibold text-warning">
                    <AlertTriangle aria-hidden className="size-4" />
                    {formatInt(resultado.rejeitados)} impedidos por falta de informação essencial
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-ledger-muted">
                    {resultado.itens_rejeitados.slice(0, 12).map((i) => (
                      <li key={i.id}>
                        <span className="font-medium text-ledger-text">{i.nome}</span> — falta{" "}
                        {i.faltando.map((f) => CHECKLIST_LABEL[f] ?? f).join(", ")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-ledger-muted">Lote registrado em auditoria: {resultado.lote_id}</p>
            </div>
          ) : (
            <>
              <div className="grid gap-5 md:grid-cols-2">
                <div className="rounded-[10px] border border-line bg-surface-muted px-4 py-3">
                  <p className="ledger-eyebrow">Quantidade afetada</p>
                  <p className="mt-1 font-display text-3xl font-bold tabular-nums text-ledger-text">
                    {formatInt(ids.length)}
                  </p>
                </div>
                <div className="rounded-[10px] border border-line bg-surface-muted px-4 py-3">
                  <p className="ledger-eyebrow">Impacto esperado</p>
                  <p className="mt-1 text-sm font-medium text-ledger-muted">
                    {acao === "publicar"
                      ? "Passam a aparecer no site. Produtos sem informação essencial são recusados e listados."
                      : acao === "despublicar" || acao === "arquivar"
                        ? "Saem do site imediatamente. O cadastro e o histórico permanecem."
                        : "Alteração aplicada no catálogo canônico, refletida na ficha e no site."}
                  </p>
                </div>

                {acao === "definir_categoria" && (
                  <label className="flex flex-col gap-2 md:col-span-2">
                    <span className="ledger-eyebrow">Categoria</span>
                    <SmartSelect
                      options={(categorias.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
                      value={categoriaId}
                      onChange={setCategoriaId}
                      placeholder="Escolher categoria"
                    />
                  </label>
                )}
                {acao === "adicionar_colecao" && (
                  <label className="flex flex-col gap-2 md:col-span-2">
                    <span className="ledger-eyebrow">Coleção</span>
                    <SmartSelect
                      options={(colecoes.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
                      value={colecaoId}
                      onChange={setColecaoId}
                      placeholder="Escolher coleção"
                    />
                  </label>
                )}
                {acao === "programar" && (
                  <label className="flex flex-col gap-2 md:col-span-2">
                    <span className="ledger-eyebrow">Publicar em</span>
                    <DateField value={quando} onChange={setQuando} />
                  </label>
                )}
                {acao === "estoque_visibilidade" && (
                  <label className="flex flex-col gap-2 md:col-span-2">
                    <span className="ledger-eyebrow">Estratégia</span>
                    <SmartSelect
                      options={ESTOQUE_OPCOES}
                      value={estrategia}
                      onChange={setEstrategia}
                      searchThreshold={99}
                    />
                  </label>
                )}

                <label className="flex flex-col gap-2 md:col-span-2">
                  <span className="ledger-eyebrow">Justificativa (opcional)</span>
                  <input
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    className="h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25"
                    placeholder="Motivo desta operação"
                  />
                </label>
              </div>

              {executar.isError && (
                <p className="text-sm font-medium text-danger">
                  {executar.error instanceof Error ? executar.error.message : "Falha ao executar."}
                </p>
              )}
            </>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4">
          <button type="button" onClick={onClose} className="admin-btn">
            {resultado ? "Fechar" : "Cancelar"}
          </button>
          {!resultado && (
            <button
              type="button"
              className="admin-btn-primary"
              disabled={ids.length === 0 || faltaParametro || executar.isPending}
              onClick={() => executar.mutate()}
            >
              {executar.isPending ? "Executando…" : "Confirmar operação"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
