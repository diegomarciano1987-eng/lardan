import * as React from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { formatBRLFromCents, formatInt } from "@/components/admin/ui";
import { lerPlanilha, type PlanilhaLida } from "@/lib/importacao/parser";
import {
  CAMPOS_PESSOA,
  CAMPOS_TITULO,
  SITUACAO_LABEL,
  aplicarMapa,
  importarPessoas,
  importarTitulos,
  sugerirMapa,
  type CampoImportacao,
  type LinhaResultado,
  type PapelImportavel,
  type ResultadoImportacao,
  type SituacaoLinha,
} from "@/lib/importacao-cadastros";

export type DestinoImportacao =
  | { tipo: "pessoas"; papel: PapelImportavel; titulo: string; descricao: string }
  | { tipo: "titulos"; direcao: "payable" | "receivable"; titulo: string; descricao: string };

const TOM: Record<SituacaoLinha, string> = {
  novo: "text-emerald-600",
  vinculado: "text-sky-600",
  atualizado: "text-sky-600",
  sem_alteracao: "text-ledger-muted",
  conflito: "text-amber-600",
  repetido: "text-ledger-muted",
  recusado: "text-red-600",
  pendente: "text-amber-600",
};

const ORDEM_CONTADORES = [
  ["recebidas", "Linhas recebidas"],
  ["novos", "Registros novos"],
  ["vinculados", "Vinculados a existentes"],
  ["atualizados", "Atualizações"],
  ["sem_alteracao", "Sem alteração"],
  ["repetidos", "Já importados antes"],
  ["conflitos", "Conflitos"],
  ["recusados", "Recusas"],
  ["pendentes", "Aguardando decisão"],
  ["contrapartes_criadas", "Contrapartes criadas"],
] as const;

/**
 * Importação de cadastros: arquivo → de-para de colunas → simulação
 * obrigatória → gravação. Quem decide cada linha é o banco.
 */
export function ImportWizardCadastros({
  destino,
  onOpenChange,
}: {
  destino: DestinoImportacao | null;
  onOpenChange: (aberto: boolean) => void;
}) {
  const campos: CampoImportacao[] = destino?.tipo === "titulos" ? CAMPOS_TITULO : CAMPOS_PESSOA;
  const [planilha, setPlanilha] = React.useState<PlanilhaLida | null>(null);
  const [nomeArquivo, setNomeArquivo] = React.useState("");
  const [mapa, setMapa] = React.useState<Record<string, string>>({});
  const [ocupado, setOcupado] = React.useState(false);
  const [progresso, setProgresso] = React.useState<{ feitas: number; total: number } | null>(null);
  const [simulacao, setSimulacao] = React.useState<ResultadoImportacao | null>(null);
  const [resultado, setResultado] = React.useState<ResultadoImportacao | null>(null);
  const [criarContraparte, setCriarContraparte] = React.useState(false);

  React.useEffect(() => {
    if (!destino) return;
    setPlanilha(null);
    setNomeArquivo("");
    setMapa({});
    setSimulacao(null);
    setResultado(null);
    setCriarContraparte(false);
  }, [destino]);

  const faltando = campos
    .filter((c) => c.obrigatorio && !mapa[c.key])
    .map((c) => c.label);

  async function escolherArquivo(file: File) {
    setOcupado(true);
    try {
      const lida = await lerPlanilha(await file.arrayBuffer());
      if (lida.linhas.length === 0) throw new Error("A planilha não tem linhas de dados.");
      setPlanilha(lida);
      setNomeArquivo(file.name);
      setMapa(sugerirMapa(lida.cabecalhos, campos));
      setSimulacao(null);
      setResultado(null);
      for (const aviso of lida.avisos) toast.warning(aviso);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui ler este arquivo.");
    } finally {
      setOcupado(false);
    }
  }

  async function executar(dryRun: boolean) {
    if (!destino || !planilha) return;
    setOcupado(true);
    setProgresso({ feitas: 0, total: planilha.linhas.length });
    try {
      const linhas = aplicarMapa(planilha.linhas, mapa);
      const onProgresso = (feitas: number, total: number) => setProgresso({ feitas, total });
      const res =
        destino.tipo === "pessoas"
          ? await importarPessoas(linhas, destino.papel, dryRun, onProgresso)
          : await importarTitulos(linhas, destino.direcao, dryRun, criarContraparte, onProgresso);
      if (dryRun) {
        setSimulacao(res);
        setResultado(null);
        toast.success("Simulação concluída. Nada foi gravado.");
      } else {
        setResultado(res);
        toast.success("Importação concluída.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na importação.");
    } finally {
      setOcupado(false);
      setProgresso(null);
    }
  }

  const exibido = resultado ?? simulacao;
  const problemas = (exibido?.linhas ?? []).filter((l) =>
    ["recusado", "conflito", "pendente"].includes(l.situacao),
  );

  return (
    <Dialog open={Boolean(destino)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[min(980px,96vw)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{destino?.titulo ?? "Importar"}</DialogTitle>
          <DialogDescription>{destino?.descricao ?? ""}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* 1 — arquivo */}
          <section className="space-y-2">
            <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-bronze uppercase">
              1. Planilha
            </p>
            <label className="flex cursor-pointer items-center gap-3 rounded-[12px] border border-dashed border-line bg-surface px-4 py-5 text-sm hover:border-champagne">
              <Upload className="h-5 w-5 text-bronze" aria-hidden />
              <span className="font-medium text-ledger-text">
                {nomeArquivo || "Escolher arquivo .xlsx, .xls ou .csv"}
              </span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void escolherArquivo(f);
                  e.target.value = "";
                }}
              />
            </label>
            {planilha ? (
              <p className="text-sm text-ledger-muted">
                {formatInt(planilha.linhas.length)} linhas · {planilha.cabecalhos.length} colunas
              </p>
            ) : null}
          </section>

          {/* 2 — de-para */}
          {planilha ? (
            <section className="space-y-3">
              <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-bronze uppercase">
                2. De-para das colunas
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {campos.map((c) => (
                  <div key={c.key} className="space-y-1">
                    <span className="text-sm font-medium text-ledger-text">
                      {c.label}
                      {c.obrigatorio ? <span className="text-red-600"> *</span> : null}
                    </span>
                    <SmartSelect
                      options={[
                        { value: "", label: "— não usar —" },
                        ...planilha.cabecalhos
                          .filter(Boolean)
                          .map((h) => ({ value: h, label: h })),
                      ]}
                      value={mapa[c.key] ?? ""}
                      onChange={(v) => setMapa((m) => ({ ...m, [c.key]: v }))}
                      placeholder="Selecionar coluna"
                    />
                  </div>
                ))}
              </div>
              {destino?.tipo === "titulos" ? (
                <label className="flex items-center gap-2 text-sm text-ledger-text">
                  <input
                    type="checkbox"
                    checked={criarContraparte}
                    onChange={(e) => setCriarContraparte(e.target.checked)}
                    className="h-4 w-4 accent-[color:var(--champagne,#b98b3a)]"
                  />
                  Criar automaticamente a contraparte que não existir no cadastro
                </label>
              ) : null}
              {faltando.length > 0 ? (
                <p className="flex items-center gap-2 text-sm text-amber-600">
                  <AlertTriangle className="h-4 w-4" aria-hidden /> Falta indicar:{" "}
                  {faltando.join(", ")}
                </p>
              ) : null}
            </section>
          ) : null}

          {/* 3 — conferência */}
          {planilha ? (
            <section className="space-y-3">
              <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-bronze uppercase">
                3. Conferência
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={ocupado || faltando.length > 0}
                  onClick={() => void executar(true)}
                  className="h-11 rounded-[10px] border border-line px-5 text-sm font-semibold text-ledger-text disabled:opacity-50"
                >
                  <FileSpreadsheet className="mr-2 inline h-4 w-4" aria-hidden />
                  Simular (não grava nada)
                </button>
                <button
                  type="button"
                  disabled={ocupado || !simulacao || Boolean(resultado)}
                  onClick={() => void executar(false)}
                  className="h-11 rounded-[10px] bg-ledger-text px-5 text-sm font-semibold text-surface disabled:opacity-50"
                >
                  <CheckCircle2 className="mr-2 inline h-4 w-4" aria-hidden />
                  Importar de verdade
                </button>
              </div>
              {progresso ? (
                <p className="text-sm text-ledger-muted">
                  Processando {formatInt(progresso.feitas)} de {formatInt(progresso.total)} linhas…
                </p>
              ) : null}
            </section>
          ) : null}

          {/* 4 — resultado */}
          {exibido ? (
            <section className="space-y-3">
              <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-bronze uppercase">
                {resultado ? "Resultado da importação" : "Resultado da simulação"}
              </p>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {ORDEM_CONTADORES.filter(([k]) => exibido.contadores[k] !== undefined).map(
                  ([k, label]) => (
                    <div key={k} className="rounded-[10px] border border-line bg-surface px-3 py-2">
                      <p className="text-xs text-ledger-muted">{label}</p>
                      <p className="text-lg font-semibold text-ledger-text">
                        {formatInt(exibido.contadores[k] ?? 0)}
                      </p>
                    </div>
                  ),
                )}
              </div>
              {problemas.length > 0 ? (
                <div className="max-h-72 overflow-y-auto rounded-[10px] border border-line">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-surface-2 text-xs text-ledger-muted">
                      <tr>
                        <th className="px-3 py-2">Linha</th>
                        <th className="px-3 py-2">Registro</th>
                        <th className="px-3 py-2">Situação</th>
                        <th className="px-3 py-2">Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {problemas.map((l: LinhaResultado) => (
                        <tr key={`${l.n}-${l.situacao}`} className="border-t border-line">
                          <td className="px-3 py-2">{l.n}</td>
                          <td className="px-3 py-2">
                            {l.nome ?? l.contraparte ?? "—"}
                            {l.valor_cents
                              ? ` · ${formatBRLFromCents(Number(l.valor_cents))}`
                              : ""}
                          </td>
                          <td className={`px-3 py-2 font-medium ${TOM[l.situacao]}`}>
                            {SITUACAO_LABEL[l.situacao]}
                          </td>
                          <td className="px-3 py-2 text-ledger-muted">{l.motivo ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-ledger-muted">Nenhuma linha recusada ou pendente.</p>
              )}
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
