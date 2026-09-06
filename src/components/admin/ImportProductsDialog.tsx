import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateField } from "@/components/premium/DateField";
import { listStockLocations, listStockReasons } from "@/lib/stock";
import { formatInt } from "@/components/admin/ui";
import {
  CAMPOS,
  type CampoKey,
  type JobResumo,
  type LinhaProblema,
  abrirLote,
  baixarModelo,
  baixarPlanilhaDeErros,
  cancelarLote,
  enviarLinhas,
  lerLote,
  lerPlanilha,
  listarProblemas,
  processarLote,
  sugerirMapeamento,
  validarLote,
} from "@/lib/imports";

type Etapa = "arquivo" | "mapa" | "conferencia" | "processando" | "fim";

const LOTE_ENVIO = 400;
const LOTE_VALIDA = 500;
const LOTE_PROCESSA = 150;

function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[0.72rem] font-semibold tracking-[0.12em] text-bronze uppercase">
      {children}
    </span>
  );
}

/** Importação industrial: arquivo → de-para → conferência → gravação em lotes. */
export function ImportProductsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const cancelar = React.useRef(false);

  const [etapa, setEtapa] = React.useState<Etapa>("arquivo");
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [cabecalhos, setCabecalhos] = React.useState<string[]>([]);
  const [linhas, setLinhas] = React.useState<Record<string, string>[]>([]);
  const [mapa, setMapa] = React.useState<Partial<Record<CampoKey, string>>>({});

  const [modo, setModo] = React.useState<"entrada" | "catalogo">("entrada");
  const [simular, setSimular] = React.useState(false);
  const [localId, setLocalId] = React.useState("");
  const [dataOp, setDataOp] = React.useState<Date | undefined>(new Date());
  const [motivo, setMotivo] = React.useState("");
  const [documento, setDocumento] = React.useState("");

  const [jobId, setJobId] = React.useState<string | null>(null);
  const [resumo, setResumo] = React.useState<JobResumo | null>(null);
  const [problemas, setProblemas] = React.useState<LinhaProblema[]>([]);
  const [progresso, setProgresso] = React.useState({ feitas: 0, total: 0 });
  const [ocupado, setOcupado] = React.useState<string | null>(null);

  const chave = React.useRef(crypto.randomUUID());
  React.useEffect(() => {
    if (open) chave.current = crypto.randomUUID();
  }, [open]);

  const locais = useQuery({ queryKey: ["stock-locations"], queryFn: listStockLocations });
  const motivos = useQuery({ queryKey: ["stock-reasons"], queryFn: listStockReasons });

  function reiniciar() {
    setEtapa("arquivo");
    setArquivo(null);
    setCabecalhos([]);
    setLinhas([]);
    setMapa({});
    setJobId(null);
    setResumo(null);
    setProblemas([]);
    setProgresso({ feitas: 0, total: 0 });
    setOcupado(null);
    cancelar.current = false;
    chave.current = crypto.randomUUID();
  }

  function fechar(v: boolean) {
    if (!v) {
      cancelar.current = true;
      reiniciar();
    }
    onOpenChange(v);
  }

  async function aoEscolherArquivo(file: File) {
    try {
      const lida = lerPlanilha(await file.arrayBuffer());
      if (lida.linhas.length === 0) {
        toast.error("Não encontrei nenhuma linha preenchida nesta planilha.");
        return;
      }
      setArquivo(file);
      setCabecalhos(lida.cabecalhos);
      setLinhas(lida.linhas);
      setMapa(sugerirMapeamento(lida.cabecalhos));
      setEtapa("mapa");
    } catch {
      toast.error("Não consegui ler este arquivo. Use .xlsx, .xls ou .csv.");
    }
  }

  async function conferir() {
    if (!arquivo) return;
    if (!mapa.nome) {
      toast.error("Indique qual coluna tem o nome do produto.");
      return;
    }
    if (!mapa.sku && !mapa.ean && !mapa.codigo_legado) {
      toast.error("Indique ao menos uma coluna de código: SKU, código legado ou código de barras.");
      return;
    }
    if (modo === "entrada" && (!localId || !dataOp || !documento.trim())) {
      toast.error("Para dar entrada informe local, data da operação e documento.");
      return;
    }
    try {
      setOcupado("Preparando o lote…");
      const id = await abrirLote({
        jobKey: chave.current,
        fileName: arquivo.name,
        fileSize: arquivo.size,
        mode: modo,
        mapping: mapa as Record<string, string>,
        defaults: {},
        locationId: modo === "entrada" ? localId : null,
        operationDate: modo === "entrada" && dataOp ? dataOp.toISOString().slice(0, 10) : null,
        reasonCode: motivo || null,
        reference: documento.trim() || null,
        dryRun: simular,
      });
      setJobId(id);

      for (let i = 0; i < linhas.length; i += LOTE_ENVIO) {
        setOcupado(`Enviando linhas ${formatInt(i + 1)}–${formatInt(Math.min(i + LOTE_ENVIO, linhas.length))}…`);
        await enviarLinhas(
          id,
          linhas.slice(i, i + LOTE_ENVIO).map((raw, k) => ({ n: i + k + 1, raw })),
        );
      }

      let restantes = 1;
      while (restantes > 0 && !cancelar.current) {
        const r = await validarLote(id, LOTE_VALIDA);
        restantes = r.restantes;
        setOcupado(`Conferindo… ${formatInt(linhas.length - restantes)} de ${formatInt(linhas.length)}`);
      }

      setResumo(await lerLote(id));
      setProblemas(await listarProblemas(id));
      setEtapa("conferencia");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function gravar() {
    if (!jobId || !resumo) return;
    cancelar.current = false;
    setEtapa("processando");
    const total = resumo.ok_rows + resumo.warn_rows;
    setProgresso({ feitas: 0, total });
    let feitas = 0;
    try {
      let restantes = 1;
      while (restantes > 0 && !cancelar.current) {
        const r = await processarLote(jobId, LOTE_PROCESSA);
        feitas += r.processadas + r.erros_no_lote;
        restantes = r.restantes;
        setProgresso({ feitas, total });
      }
      setResumo(await lerLote(jobId));
      setProblemas(await listarProblemas(jobId));
      setEtapa("fim");
      void qc.invalidateQueries({ queryKey: ["stock"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["catalog"] });
      toast.success(simular ? "Simulação concluída." : "Importação concluída.");
    } catch (e) {
      toast.error((e as Error).message);
      setEtapa("conferencia");
    }
  }

  async function interromper() {
    cancelar.current = true;
    if (jobId) {
      try {
        await cancelarLote(jobId);
        setResumo(await lerLote(jobId));
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    setEtapa("fim");
  }

  const aptas = (resumo?.ok_rows ?? 0) + (resumo?.warn_rows ?? 0);

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Importar produtos por planilha</DialogTitle>
          <DialogDescription>
            Quatro passos: enviar o arquivo, conferir o de-para das colunas, revisar o que o sistema
            entendeu e só então gravar. Peças já cadastradas são atualizadas — nada é duplicado, e
            reenviar o mesmo lote não lança estoque duas vezes.
          </DialogDescription>
        </DialogHeader>

        {/* Passo 1 — arquivo */}
        {etapa === "arquivo" && (
          <div className="space-y-4">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void aoEscolherArquivo(f);
                e.target.value = "";
              }}
            />
            <div className="ledger-panel flex flex-col items-center gap-3 px-6 py-10 text-center">
              <FileSpreadsheet aria-hidden className="size-8 text-bronze" />
              <p className="text-sm text-ledger-muted">
                Excel (.xlsx, .xls) ou CSV. Códigos com zeros à esquerda são preservados.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <button type="button" className="admin-btn-primary" onClick={() => inputRef.current?.click()}>
                  <Upload aria-hidden className="mr-2 inline size-4" />
                  Escolher arquivo
                </button>
                <button type="button" className="admin-btn" onClick={baixarModelo}>
                  <Download aria-hidden className="mr-2 inline size-4" />
                  Baixar modelo
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Passo 2 — de-para e regras do lote */}
        {etapa === "mapa" && (
          <div className="space-y-5">
            <p className="text-sm text-ledger-muted">
              <strong className="text-ledger-text">{arquivo?.name}</strong> · {formatInt(linhas.length)}{" "}
              linhas · {formatInt(cabecalhos.length)} colunas.
            </p>

            <div className="flex flex-wrap gap-4">
              <label className="block w-64 space-y-1.5">
                <Rotulo>O que a planilha faz</Rotulo>
                <SmartSelect
                  options={[
                    { value: "entrada", label: "Cadastrar e dar entrada no estoque" },
                    { value: "catalogo", label: "Somente cadastrar as peças" },
                  ]}
                  value={modo}
                  onChange={(v) => setModo(v as "entrada" | "catalogo")}
                />
              </label>
              <label className="block w-56 space-y-1.5">
                <Rotulo>Modo</Rotulo>
                <SmartSelect
                  options={[
                    { value: "real", label: "Gravar de verdade" },
                    { value: "simular", label: "Simular (não grava nada)" },
                  ]}
                  value={simular ? "simular" : "real"}
                  onChange={(v) => setSimular(v === "simular")}
                />
              </label>
              {modo === "entrada" && (
                <>
                  <label className="block w-56 space-y-1.5">
                    <Rotulo>Local de entrada</Rotulo>
                    <SmartSelect
                      options={(locais.data ?? []).map((l) => ({ value: l.id, label: l.name, hint: l.code }))}
                      value={localId}
                      onChange={setLocalId}
                      placeholder="Escolha o local…"
                    />
                  </label>
                  <label className="block w-48 space-y-1.5">
                    <Rotulo>Data da operação</Rotulo>
                    <DateField value={dataOp} onChange={setDataOp} />
                  </label>
                  <label className="block w-56 space-y-1.5">
                    <Rotulo>Motivo</Rotulo>
                    <SmartSelect
                      options={(motivos.data ?? [])
                        .filter((m) => m.kind === "entrada")
                        .map((m) => ({ value: m.code, label: m.label }))}
                      value={motivo}
                      onChange={setMotivo}
                      placeholder="Opcional"
                    />
                  </label>
                  <label className="block w-56 space-y-1.5">
                    <Rotulo>Documento / referência</Rotulo>
                    <input
                      className="admin-input w-full"
                      value={documento}
                      onChange={(e) => setDocumento(e.target.value)}
                      placeholder="Nota, pedido ou remessa"
                    />
                  </label>
                </>
              )}
            </div>

            <div className="ledger-panel max-h-72 overflow-auto p-4">
              <p className="mb-3 text-sm font-semibold text-ledger-text">
                De-para das colunas — confira antes de seguir
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {CAMPOS.map((c) => (
                  <label key={c.key} className="space-y-1">
                    <Rotulo>
                      {c.label}
                      {"obrigatorio" in c && c.obrigatorio ? " *" : ""}
                    </Rotulo>
                    <SmartSelect
                      options={[
                        { value: "", label: "— não usar —" },
                        ...cabecalhos.map((h) => ({ value: h, label: h })),
                      ]}
                      value={mapa[c.key] ?? ""}
                      onChange={(v) => setMapa((m) => ({ ...m, [c.key]: v }))}
                      placeholder="Escolha a coluna…"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button type="button" className="admin-btn" onClick={reiniciar} disabled={!!ocupado}>
                Trocar arquivo
              </button>
              <button type="button" className="admin-btn-primary" onClick={() => void conferir()} disabled={!!ocupado}>
                {ocupado ?? "Conferir planilha"}
              </button>
            </div>
          </div>
        )}

        {/* Passo 3 — conferência */}
        {etapa === "conferencia" && resumo && (
          <div className="space-y-4">
            <div className="ledger-panel grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-4">
              <div>
                <Rotulo>Linhas lidas</Rotulo>
                <p className="font-display text-2xl font-bold text-ledger-text">{formatInt(resumo.total_rows)}</p>
              </div>
              <div>
                <Rotulo>Prontas</Rotulo>
                <p className="font-display text-2xl font-bold text-ledger-text">{formatInt(resumo.ok_rows)}</p>
              </div>
              <div>
                <Rotulo>Com aviso</Rotulo>
                <p className="font-display text-2xl font-bold text-ledger-text">{formatInt(resumo.warn_rows)}</p>
              </div>
              <div>
                <Rotulo>Recusadas</Rotulo>
                <p className="font-display text-2xl font-bold text-ledger-text">{formatInt(resumo.error_rows)}</p>
              </div>
            </div>

            {problemas.length > 0 && (
              <div className="ledger-panel max-h-64 overflow-auto">
                <p className="flex items-center gap-2 px-4 py-3 text-sm font-semibold text-ledger-text">
                  <AlertTriangle aria-hidden className="size-4 text-bronze" />
                  Linhas que não serão gravadas
                </p>
                <table className="w-full text-sm">
                  <tbody>
                    {problemas.slice(0, 60).map((p) => (
                      <tr key={p.line_no} className="border-t border-line/60">
                        <td className="w-16 px-4 py-2 tabular-nums text-ledger-muted">#{p.line_no}</td>
                        <td className="px-4 py-2 text-ledger-text">
                          {(p.messages ?? []).map((m) => m.erro ?? m.aviso).filter(Boolean).join(" · ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {problemas.length > 60 && (
                  <p className="px-4 py-2 text-xs text-ledger-muted">
                    … e mais {formatInt(problemas.length - 60)} linhas na planilha de recusadas.
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-3">
              {problemas.length > 0 && (
                <button
                  type="button"
                  className="admin-btn"
                  onClick={() => baixarPlanilhaDeErros(problemas, "linhas-recusadas-lardan.xlsx")}
                >
                  <Download aria-hidden className="mr-2 inline size-4" />
                  Baixar linhas recusadas
                </button>
              )}
              <button type="button" className="admin-btn" onClick={() => setEtapa("mapa")}>
                Voltar ao de-para
              </button>
              <button type="button" className="admin-btn-primary" disabled={aptas === 0} onClick={() => void gravar()}>
                {simular
                  ? `Simular ${formatInt(aptas)} linhas`
                  : `Gravar ${formatInt(aptas)} linhas`}
              </button>
            </div>
          </div>
        )}

        {/* Passo 4 — gravando */}
        {etapa === "processando" && (
          <div className="space-y-4">
            <p className="text-sm text-ledger-muted">
              Gravando em lotes de {LOTE_PROCESSA} linhas. Uma linha com problema não derruba as
              demais e você pode interromper a qualquer momento.
            </p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-line/60">
              <div
                className="h-full bg-ink transition-all"
                style={{
                  width: `${progresso.total ? Math.min(100, (progresso.feitas / progresso.total) * 100) : 0}%`,
                }}
              />
            </div>
            <p className="text-sm text-ledger-text">
              {formatInt(progresso.feitas)} de {formatInt(progresso.total)} linhas.
            </p>
            <div className="flex justify-end">
              <button type="button" className="admin-btn" onClick={() => void interromper()}>
                Interromper
              </button>
            </div>
          </div>
        )}

        {/* Resultado */}
        {etapa === "fim" && resumo && (
          <div className="space-y-4">
            <div className="ledger-panel space-y-2 px-5 py-4 text-sm">
              <p className="font-semibold text-ledger-text">
                {resumo.dry_run ? "Resultado da simulação" : "Resultado da importação"}
              </p>
              <p className="text-ledger-muted">
                {formatInt(resumo.products_created)} produtos criados ·{" "}
                {formatInt(resumo.products_updated)} atualizados ·{" "}
                {formatInt(resumo.variants_created)} variações novas ·{" "}
                {formatInt(resumo.variants_updated)} variações atualizadas ·{" "}
                {formatInt(resumo.stock_entries)} entradas · {formatInt(resumo.units_in)} unidades.
              </p>
              <p className="text-ledger-muted">
                {formatInt(resumo.processed_rows)} linhas gravadas · {formatInt(resumo.error_rows)}{" "}
                recusadas.
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-3">
              {problemas.length > 0 && (
                <button
                  type="button"
                  className="admin-btn"
                  onClick={() => baixarPlanilhaDeErros(problemas, "linhas-recusadas-lardan.xlsx")}
                >
                  <Download aria-hidden className="mr-2 inline size-4" />
                  Baixar linhas recusadas
                </button>
              )}
              <button type="button" className="admin-btn" onClick={reiniciar}>
                Importar outra planilha
              </button>
              <button type="button" className="admin-btn-primary" onClick={() => fechar(false)}>
                Fechar
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
