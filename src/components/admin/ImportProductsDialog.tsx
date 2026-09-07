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
  ROTULO_ESTADO,
  type CampoKey,
  type EstadoLote,
  type Indicadores,
  type JobResumo,
  type LinhaProblema,
  abrirExecucao,
  baixarModelo,
  baixarPlanilhaDeErros,
  cancelarLote,
  colunasAmbiguas,
  enviarLinhas,
  indicadoresLote,
  lerLote,
  lerPlanilha,
  listarProblemas,
  pausarLote,
  processarLote,
  promoverSimulacao,
  registrarArquivoNoServidor,
  retomarLote,
  selarLote,
  sugerirMapeamentoDetalhado,
  validarLote,
} from "@/lib/imports";

type Etapa = "arquivo" | "mapa" | "conferencia" | "processando" | "fim";

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none placeholder:font-normal placeholder:text-ledger-muted focus:border-champagne focus:ring-2 focus:ring-champagne/25";

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

function duracao(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}min ${String(s % 60).padStart(2, "0")}s`;
}

/**
 * Importação industrial: arquivo (identidade no servidor) → de-para →
 * conferência → simulação ou gravação em blocos, com pausa, retomada e
 * cancelamento com motivo.
 */
export function ImportProductsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const parar = React.useRef(false);
  const worker = React.useRef(crypto.randomUUID());

  const [etapa, setEtapa] = React.useState<Etapa>("arquivo");
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [fileId, setFileId] = React.useState<string | null>(null);
  const [sha, setSha] = React.useState("");
  const [cabecalhos, setCabecalhos] = React.useState<string[]>([]);
  const [linhas, setLinhas] = React.useState<Record<string, string>[]>([]);
  const [mapa, setMapa] = React.useState<Partial<Record<CampoKey, string>>>({});
  const [confianca, setConfianca] = React.useState<Partial<Record<CampoKey, string>>>({});
  const [avisosArquivo, setAvisosArquivo] = React.useState<string[]>([]);

  const [modo, setModo] = React.useState<"entrada" | "catalogo">("entrada");
  const [simular, setSimular] = React.useState(false);
  const [localId, setLocalId] = React.useState("");
  const [dataOp, setDataOp] = React.useState<Date | undefined>(new Date());
  const [motivo, setMotivo] = React.useState("");
  const [documento, setDocumento] = React.useState("");

  const [jobId, setJobId] = React.useState<string | null>(null);
  const [resumo, setResumo] = React.useState<JobResumo | null>(null);
  const [indicadores, setIndicadores] = React.useState<Indicadores | null>(null);
  const [problemas, setProblemas] = React.useState<LinhaProblema[]>([]);
  const [progresso, setProgresso] = React.useState({ feitas: 0, total: 0, inicio: 0 });
  const [ocupado, setOcupado] = React.useState<string | null>(null);
  const [motivoCancelar, setMotivoCancelar] = React.useState("");
  const [pedirMotivo, setPedirMotivo] = React.useState(false);

  const locais = useQuery({ queryKey: ["stock-locations"], queryFn: listStockLocations });
  const motivos = useQuery({ queryKey: ["stock-reasons"], queryFn: listStockReasons });

  function reiniciar() {
    setEtapa("arquivo");
    setArquivo(null);
    setFileId(null);
    setSha("");
    setCabecalhos([]);
    setLinhas([]);
    setMapa({});
    setConfianca({});
    setAvisosArquivo([]);
    setJobId(null);
    setResumo(null);
    setIndicadores(null);
    setProblemas([]);
    setProgresso({ feitas: 0, total: 0, inicio: 0 });
    setOcupado(null);
    setPedirMotivo(false);
    setMotivoCancelar("");
    parar.current = false;
    worker.current = crypto.randomUUID();
  }

  function fechar(v: boolean) {
    if (!v) {
      parar.current = true;
      reiniciar();
    }
    onOpenChange(v);
  }

  async function aoEscolherArquivo(file: File) {
    try {
      setOcupado("Registrando o arquivo no servidor…");
      const lida = await lerPlanilha(await file.arrayBuffer());
      if (lida.linhas.length === 0) {
        toast.error("Não encontrei nenhuma linha preenchida nesta planilha.");
        return;
      }
      const registro = await registrarArquivoNoServidor(file);
      const sugestoes = sugerirMapeamentoDetalhado(lida.cabecalhos);
      setArquivo(file);
      setFileId(registro.id);
      setSha(registro.sha256);
      setCabecalhos(lida.cabecalhos);
      setLinhas(lida.linhas);
      setMapa(Object.fromEntries(sugestoes.map((s) => [s.campo, s.coluna])));
      setConfianca(Object.fromEntries(sugestoes.map((s) => [s.campo, s.confianca])));
      setAvisosArquivo([...lida.avisos, ...registro.avisos]);
      if (!registro.novo) {
        toast.info("Este arquivo já foi enviado antes. O histórico dele será mantido.");
      }
      setEtapa("mapa");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function conferir() {
    if (!arquivo || !fileId) return;
    if (!mapa.nome) {
      toast.error("Indique qual coluna tem o nome do produto.");
      return;
    }
    if (!mapa.sku && !mapa.ean && !mapa.codigo_legado) {
      toast.error("Indique ao menos uma coluna de código: SKU, código legado ou código de barras.");
      return;
    }
    const ambiguas = colunasAmbiguas(mapa);
    if (ambiguas.length > 0) {
      toast.error(`A coluna "${ambiguas[0]}" está apontada para mais de um campo.`);
      return;
    }
    if (modo === "entrada" && (!localId || !dataOp || !documento.trim())) {
      toast.error("Para dar entrada informe local, data da operação e documento.");
      return;
    }
    try {
      parar.current = false;
      setOcupado("Preparando a execução…");
      const aberta = await abrirExecucao({
        fileId,
        mode: modo,
        mapping: mapa as Record<string, string>,
        defaults: {},
        dryRun: simular,
        locationId: modo === "entrada" ? localId : null,
        operationDate: modo === "entrada" && dataOp ? dataOp.toISOString().slice(0, 10) : null,
        reasonCode: motivo || null,
        reference: documento.trim() || null,
      });
      setJobId(aberta.id);

      if (!aberta.reaproveitado) {
        for (let i = 0; i < linhas.length; i += LOTE_ENVIO) {
          if (parar.current) return;
          setOcupado(
            `Recebendo linhas ${formatInt(i + 1)}–${formatInt(Math.min(i + LOTE_ENVIO, linhas.length))}…`,
          );
          await enviarLinhas(
            aberta.id,
            linhas.slice(i, i + LOTE_ENVIO).map((raw, k) => ({ n: i + k + 1, raw })),
          );
        }
        await selarLote(aberta.id);
      }

      let restantes = 1;
      while (restantes > 0 && !parar.current) {
        const r = await validarLote(aberta.id, LOTE_VALIDA);
        restantes = r.restantes;
        setIndicadores(r.indicadores);
        setOcupado(
          `Conferindo… ${formatInt(linhas.length - restantes)} de ${formatInt(linhas.length)}`,
        );
      }

      setResumo(await lerLote(aberta.id));
      setIndicadores(await indicadoresLote(aberta.id));
      setProblemas(await listarProblemas(aberta.id));
      setEtapa("conferencia");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function executar(idExecucao?: string) {
    const alvo = idExecucao ?? jobId;
    if (!alvo || !indicadores) return;
    parar.current = false;
    setEtapa("processando");
    const total = indicadores.prontas + indicadores.avisos + indicadores.em_curso;
    setProgresso({ feitas: 0, total, inicio: Date.now() });
    let feitas = 0;
    try {
      let restantes = 1;
      while (restantes > 0 && !parar.current) {
        const r = await processarLote(alvo, LOTE_PROCESSA, worker.current);
        feitas += r.processadas + r.erros_no_lote;
        restantes = r.restantes;
        setIndicadores(r.indicadores);
        setProgresso((p) => ({ ...p, feitas, total: Math.max(total, feitas) }));
        if (r.pausado) break;
      }
      setResumo(await lerLote(alvo));
      setIndicadores(await indicadoresLote(alvo));
      setProblemas(await listarProblemas(alvo));
      setEtapa("fim");
      void qc.invalidateQueries({ queryKey: ["stock"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["catalog"] });
      toast.success(simular ? "Simulação concluída." : "Importação concluída.");
    } catch (e) {
      toast.error((e as Error).message);
      setResumo(await lerLote(alvo).catch(() => null));
      setEtapa("conferencia");
    }
  }

  async function pausar() {
    if (!jobId) return;
    parar.current = true;
    try {
      await pausarLote(jobId);
      setResumo(await lerLote(jobId));
      setEtapa("fim");
      toast.info("Lote pausado. Você pode retomar de onde parou.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function retomar() {
    if (!jobId) return;
    try {
      await retomarLote(jobId);
      setIndicadores(await indicadoresLote(jobId));
      await executar(jobId);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function confirmarCancelamento() {
    if (!jobId) return;
    if (motivoCancelar.trim().length < 5) {
      toast.error("Escreva o motivo do cancelamento.");
      return;
    }
    parar.current = true;
    try {
      await cancelarLote(jobId, motivoCancelar.trim());
      setResumo(await lerLote(jobId));
      setIndicadores(await indicadoresLote(jobId));
      setPedirMotivo(false);
      setEtapa("fim");
      toast.info("Lote cancelado. O que já foi gravado permanece registrado.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function promover() {
    if (!jobId) return;
    try {
      const r = await promoverSimulacao(jobId);
      if (r.base_mudou)
        toast.warning("A base mudou desde a simulação — confira o resultado no fim.");
      setJobId(r.id);
      setSimular(false);
      setResumo(await lerLote(r.id));
      setIndicadores(await indicadoresLote(r.id));
      setEtapa("conferencia");
      toast.success("Execução real criada a partir da simulação.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const aptas = (indicadores?.prontas ?? 0) + (indicadores?.avisos ?? 0);
  const decorrido = progresso.inicio ? Date.now() - progresso.inicio : 0;
  const velocidade = decorrido > 0 ? progresso.feitas / (decorrido / 1000) : 0;
  const estimativa =
    velocidade > 0 ? duracao(((progresso.total - progresso.feitas) / velocidade) * 1000) : "—";
  const estado = (resumo?.status ?? "rascunho") as EstadoLote;

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="admin-scope max-h-[88vh] max-w-4xl overflow-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            Importar produtos por planilha
          </DialogTitle>
          <DialogDescription>
            O arquivo ganha uma impressão digital no servidor; depois vêm o de-para, a conferência e
            só então a gravação. Peças já cadastradas são atualizadas — nada é duplicado, e reenviar
            o mesmo lote não lança estoque duas vezes.
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
                Excel (.xlsx, .xls) ou CSV, até 20 MB e 50.000 linhas. Códigos com zeros à esquerda
                são preservados.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  className="admin-btn-primary"
                  disabled={!!ocupado}
                  onClick={() => inputRef.current?.click()}
                >
                  <Upload aria-hidden className="mr-2 inline size-4" />
                  {ocupado ?? "Escolher arquivo"}
                </button>
                <button type="button" className="admin-btn" onClick={() => void baixarModelo()}>
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
              <strong className="text-ledger-text">{arquivo?.name}</strong> ·{" "}
              {formatInt(linhas.length)} linhas · {formatInt(cabecalhos.length)} colunas · impressão
              digital {sha.slice(0, 12)}
            </p>
            {avisosArquivo.length > 0 && (
              <ul className="ledger-panel space-y-1 px-4 py-3 text-sm text-ledger-muted">
                {avisosArquivo.map((a) => (
                  <li key={a}>• {a}</li>
                ))}
              </ul>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
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
              <label className="block space-y-1.5">
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
                  <label className="block space-y-1.5">
                    <Rotulo>Local de entrada</Rotulo>
                    <SmartSelect
                      options={(locais.data ?? []).map((l) => ({
                        value: l.id,
                        label: l.name,
                        hint: l.code,
                      }))}
                      value={localId}
                      onChange={setLocalId}
                      placeholder="Escolha o local…"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <Rotulo>Data da operação</Rotulo>
                    <DateField value={dataOp} onChange={setDataOp} />
                  </label>
                  <label className="block space-y-1.5">
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
                  <label className="block space-y-1.5">
                    <Rotulo>Documento / referência</Rotulo>
                    <input
                      className={inputCls}
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
                      {confianca[c.key] === "parecida" ? " · palpite" : ""}
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
              <button
                type="button"
                className="admin-btn-primary"
                onClick={() => void conferir()}
                disabled={!!ocupado}
              >
                {ocupado ?? "Conferir planilha"}
              </button>
            </div>
          </div>
        )}

        {/* Passo 3 — conferência */}
        {etapa === "conferencia" && indicadores && (
          <div className="space-y-4">
            <div className="ledger-panel grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-5">
              <div>
                <Rotulo>Linhas lidas</Rotulo>
                <p className="font-display text-2xl font-bold text-ledger-text">
                  {formatInt(indicadores.total)}
                </p>
              </div>
              <div>
                <Rotulo>Prontas</Rotulo>
                <p className="font-display text-2xl font-bold text-ledger-text">
                  {formatInt(indicadores.prontas)}
                </p>
              </div>
              <div>
                <Rotulo>Com aviso</Rotulo>
                <p className="font-display text-2xl font-bold text-ledger-text">
                  {formatInt(indicadores.avisos)}
                </p>
              </div>
              <div>
                <Rotulo>Recusadas</Rotulo>
                <p className="font-display text-2xl font-bold text-ledger-text">
                  {formatInt(indicadores.recusadas)}
                </p>
              </div>
              <div>
                <Rotulo>Conflitos</Rotulo>
                <p className="font-display text-2xl font-bold text-ledger-text">
                  {formatInt(indicadores.conflitos)}
                </p>
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
                        <td className="w-16 px-4 py-2 tabular-nums text-ledger-muted">
                          #{p.line_no}
                        </td>
                        <td className="px-4 py-2 text-ledger-text">
                          {(p.messages ?? [])
                            .map((m) => m.erro ?? m.aviso)
                            .filter(Boolean)
                            .join(" · ")}
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
                  onClick={() =>
                    void baixarPlanilhaDeErros(problemas, "linhas-recusadas-lardan.xlsx")
                  }
                >
                  <Download aria-hidden className="mr-2 inline size-4" />
                  Baixar linhas recusadas
                </button>
              )}
              <button type="button" className="admin-btn" onClick={() => setEtapa("mapa")}>
                Voltar ao de-para
              </button>
              <button
                type="button"
                className="admin-btn-primary"
                disabled={aptas === 0}
                onClick={() => void executar()}
              >
                {simular
                  ? `Simular ${formatInt(aptas)} linhas`
                  : `Gravar ${formatInt(aptas)} linhas`}
              </button>
            </div>
          </div>
        )}

        {/* Passo 4 — processando */}
        {etapa === "processando" && (
          <div className="space-y-4">
            <p className="text-sm text-ledger-muted">
              Gravando em blocos de {LOTE_PROCESSA} linhas. Uma linha com problema não derruba as
              demais; você pode pausar e retomar de onde parou.
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
              {formatInt(progresso.feitas)} de {formatInt(progresso.total)} linhas ·{" "}
              {velocidade.toFixed(0)} linhas/s · decorrido {duracao(decorrido)} · faltam ~
              {estimativa}
            </p>
            {pedirMotivo ? (
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-[16rem] flex-1 space-y-1.5">
                  <Rotulo>Motivo do cancelamento</Rotulo>
                  <input
                    className={inputCls}
                    value={motivoCancelar}
                    onChange={(e) => setMotivoCancelar(e.target.value)}
                    placeholder="Explique por que este lote foi cancelado"
                  />
                </label>
                <button type="button" className="admin-btn" onClick={() => setPedirMotivo(false)}>
                  Voltar
                </button>
                <button
                  type="button"
                  className="admin-btn-primary"
                  onClick={() => void confirmarCancelamento()}
                >
                  Confirmar cancelamento
                </button>
              </div>
            ) : (
              <div className="flex justify-end gap-3">
                <button type="button" className="admin-btn" onClick={() => void pausar()}>
                  Pausar
                </button>
                <button type="button" className="admin-btn" onClick={() => setPedirMotivo(true)}>
                  Cancelar lote
                </button>
              </div>
            )}
          </div>
        )}

        {/* Resultado */}
        {etapa === "fim" && resumo && indicadores && (
          <div className="space-y-4">
            <div className="ledger-panel space-y-2 px-5 py-4 text-sm">
              <p className="font-semibold text-ledger-text">
                {resumo.dry_run ? "Resultado da simulação" : "Resultado da importação"} ·{" "}
                {ROTULO_ESTADO[estado]}
              </p>
              <p className="text-ledger-muted">
                {formatInt(indicadores.produtos_criados)} produtos criados ·{" "}
                {formatInt(indicadores.produtos_atualizados)} atualizados ·{" "}
                {formatInt(indicadores.variantes_criadas)} variações novas ·{" "}
                {formatInt(indicadores.variantes_atualizadas)} variações atualizadas ·{" "}
                {formatInt(indicadores.entradas)} entradas · {formatInt(indicadores.unidades)}{" "}
                unidades.
              </p>
              <p className="text-ledger-muted">
                {formatInt(indicadores.processadas + indicadores.simuladas)} linhas concluídas ·{" "}
                {formatInt(indicadores.recusadas)} recusadas · {formatInt(indicadores.conflitos)}{" "}
                conflitos · {formatInt(indicadores.publicacoes)} publicações ·{" "}
                {formatInt(indicadores.publicacoes_recusadas)} publicações impedidas.
              </p>
              {resumo.cancel_reason && (
                <p className="text-ledger-muted">Motivo do cancelamento: {resumo.cancel_reason}</p>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-3">
              {problemas.length > 0 && (
                <button
                  type="button"
                  className="admin-btn"
                  onClick={() =>
                    void baixarPlanilhaDeErros(problemas, "linhas-recusadas-lardan.xlsx")
                  }
                >
                  <Download aria-hidden className="mr-2 inline size-4" />
                  Baixar linhas recusadas
                </button>
              )}
              {estado === "pausado" && (
                <button type="button" className="admin-btn-primary" onClick={() => void retomar()}>
                  Retomar de onde parou
                </button>
              )}
              {resumo.dry_run && (estado === "simulado" || estado === "concluido") && (
                <button type="button" className="admin-btn-primary" onClick={() => void promover()}>
                  Executar de verdade
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
