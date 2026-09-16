import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Upload, X } from "lucide-react";
import {
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
  StatusBadge,
  formatBRLFromCents,
} from "@/components/admin/ui";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { useCapabilities } from "@/lib/capabilities";
import { PedirDadosDialog } from "@/components/admin/financeiro/PedirDadosDialog";
import { fetchFinAccounts, reaisParaCentavos } from "@/lib/financeiro";
import { processarExtrato } from "@/lib/conciliacao.functions";
import {
  STATUS_LINHA_LABEL,
  conciliar,
  desfazerConciliacao,
  listarLinhasExtrato,
  marcarLinha,
  resumoExtrato,
  sugerirCorrespondencias,
  enviarArquivoExtrato,
  type LinhaExtratoRow,
  type StatusLinha,
} from "@/lib/conciliacao";

const PAGE_SIZE = 25;

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none placeholder:font-normal placeholder:text-ledger-muted focus:border-champagne focus:ring-2 focus:ring-champagne/25";

const dataBR = (d: string | null) =>
  d ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${d}T12:00:00`)) : "—";

const TOM: Record<StatusLinha, "success" | "danger" | "warning" | "neutral"> = {
  pendente: "neutral",
  invalida: "danger",
  repetida: "warning",
  parcial: "warning",
  conciliada: "success",
  ignorada: "neutral",
  divergente: "danger",
};

function useDebounce<T>(valor: T, ms = 350) {
  const [saida, setSaida] = React.useState(valor);
  React.useEffect(() => {
    const t = setTimeout(() => setSaida(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return saida;
}

function Indicador({ rotulo, valor }: { rotulo: string; valor: string | number }) {
  return (
    <div className="rounded-[12px] border border-line-soft bg-cream-2 p-4">
      <p className="ledger-eyebrow">{rotulo}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-ledger-text">{valor}</p>
    </div>
  );
}

/** Painel lateral: linha original, sugestões, conciliação e auditoria. */
function PainelLinha({
  linha,
  onFechar,
  onMudou,
}: {
  linha: LinhaExtratoRow;
  onFechar: () => void;
  onMudou: () => void;
}) {
  const caps = useCapabilities();
  const podeConciliar = caps.includes("finance.reconcile");
  const podeMarcar = caps.includes("finance.statement.flag");
  const [selecionadas, setSelecionadas] = React.useState<Record<string, string>>({});
  const [tarifa, setTarifa] = React.useState("");
  const [juros, setJuros] = React.useState("");
  const [desconto, setDesconto] = React.useState("");
  const [excedente, setExcedente] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");

  const sugestoes = useQuery({
    queryKey: ["fin-sugestoes", linha.id],
    queryFn: () => sugerirCorrespondencias(linha.id),
    enabled:
      linha.status === "pendente" || linha.status === "parcial" || linha.status === "divergente",
  });

  const aplicar = useMutation({
    mutationFn: async () => {
      const alocacoes = Object.entries(selecionadas)
        .map(([installment_id, texto]) => ({
          installment_id,
          valor_cents: reaisParaCentavos(texto) ?? 0,
        }))
        .filter((a) => a.valor_cents > 0);
      if (alocacoes.length === 0)
        throw new Error("Escolha ao menos uma parcela e informe o valor.");
      return conciliar({
        line_ids: [linha.id],
        alocacoes,
        tarifa_cents: reaisParaCentavos(tarifa) ?? 0,
        juros_cents: reaisParaCentavos(juros) ?? 0,
        desconto_cents: reaisParaCentavos(desconto) ?? 0,
        permitir_excedente: excedente,
        idempotency_key: `${linha.id}:${JSON.stringify(alocacoes)}`,
      });
    },
    onSuccess: () => {
      toast.success("Linha conciliada e lançada no razão.");
      onMudou();
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const marcar = useMutation({
    mutationFn: (status: string) => marcarLinha(linha.id, status, motivo.trim()),
    onSuccess: () => {
      toast.success("Situação da linha registrada.");
      onMudou();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const emAberto = (linha.valor_cents ?? 0) - linha.conciliado_cents;

  return (
    <aside className="ledger-panel space-y-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="ledger-eyebrow">Linha {linha.line_no} do extrato</p>
          <p className="truncate font-display text-lg font-bold text-ledger-text">
            {linha.historico || "Sem histórico"}
          </p>
          <p className="text-xs text-ledger-muted">
            {dataBR(linha.data)} · {linha.kind === "saida" ? "Saída" : "Entrada"} ·{" "}
            {formatBRLFromCents(linha.valor_cents ?? 0)}
            {linha.bank_id ? ` · id ${linha.bank_id}` : ""}
            {linha.documento ? ` · doc. ${linha.documento}` : ""}
          </p>
        </div>
        <button type="button" className="admin-btn" onClick={onFechar} aria-label="Fechar painel">
          <X aria-hidden className="size-4" />
        </button>
      </div>

      <StatusBadge tone={TOM[linha.status]}>{STATUS_LINHA_LABEL[linha.status]}</StatusBadge>
      {linha.error_reason && (
        <p className="text-sm text-ledger-muted">Motivo: {linha.error_reason}</p>
      )}
      {linha.flag_reason && (
        <p className="text-sm text-ledger-muted">Observação: {linha.flag_reason}</p>
      )}

      {linha.status === "conciliada" && (
        <p className="text-sm font-medium text-ledger-muted">
          Já conciliada. Para alterar, desfaça a conciliação na lista de conciliações da linha.
        </p>
      )}

      {podeConciliar && (linha.status === "pendente" || linha.status === "divergente") && (
        <div className="space-y-3">
          <p className="ledger-eyebrow">Sugestões de correspondência</p>
          {sugestoes.isLoading && <Skeleton className="h-20 w-full" />}
          {sugestoes.data && sugestoes.data.length === 0 && (
            <p className="text-sm text-ledger-muted">
              Nenhuma parcela em aberto parecida. Marque a linha como divergente ou ignorada.
            </p>
          )}
          <ul className="space-y-2">
            {(sugestoes.data ?? []).map((s) => (
              <li key={s.installment_id} className="rounded-[10px] border border-line-soft p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ledger-text">{s.titulo}</p>
                    <p className="text-xs text-ledger-muted">
                      {s.contraparte ?? "Sem contraparte"} · vence {dataBR(s.vencimento)} · em
                      aberto {formatBRLFromCents(s.aberto_cents)}
                    </p>
                    <p className="text-xs text-ledger-muted">
                      Confiança {s.score}% —{" "}
                      {[
                        s.reasons.valor_exato ? "valor exato" : "valor aproximado",
                        `${s.reasons.dias} dia(s) do vencimento`,
                        s.reasons.documento ? `documento ${s.reasons.documento}` : null,
                        s.reasons.contraparte ? `contraparte ${s.reasons.contraparte}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <input
                    value={selecionadas[s.installment_id] ?? ""}
                    onChange={(e) =>
                      setSelecionadas((p) => ({ ...p, [s.installment_id]: e.target.value }))
                    }
                    inputMode="decimal"
                    placeholder="0,00"
                    aria-label="Valor a alocar nesta parcela"
                    className={`${inputCls} w-32`}
                  />
                </div>
              </li>
            ))}
          </ul>

          <div className="grid gap-2 sm:grid-cols-3">
            <input
              value={tarifa}
              onChange={(e) => setTarifa(e.target.value)}
              placeholder="Tarifa R$"
              className={inputCls}
            />
            <input
              value={juros}
              onChange={(e) => setJuros(e.target.value)}
              placeholder="Juros R$"
              className={inputCls}
            />
            <input
              value={desconto}
              onChange={(e) => setDesconto(e.target.value)}
              placeholder="Desconto R$"
              className={inputCls}
            />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-ledger-muted">
            <input
              type="checkbox"
              checked={excedente}
              onChange={(e) => setExcedente(e.target.checked)}
            />
            Aceitar valor acima do saldo da parcela (excedente explícito)
          </label>
          <ResumoConciliacao
            somaLinhas={emAberto}
            alocacoes={Object.values(selecionadas)}
            tarifa={tarifa}
            juros={juros}
            desconto={desconto}
          />
          <button
            type="button"
            className="admin-btn-primary"
            disabled={aplicar.isPending}
            onClick={() => aplicar.mutate()}
          >
            {aplicar.isPending ? "Conciliando…" : "Conciliar"}
          </button>
        </div>
      )}

      {podeMarcar && linha.status !== "conciliada" && (
        <div className="space-y-2 border-t border-line-soft pt-4">
          <p className="ledger-eyebrow">Marcar linha</p>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (obrigatório)"
            className={inputCls}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="admin-btn" onClick={() => marcar.mutate("ignorada")}>
              Ignorar linha
            </button>
            <button type="button" className="admin-btn" onClick={() => marcar.mutate("divergente")}>
              Marcar divergência
            </button>
          </div>
        </div>
      )}

      <details className="border-t border-line-soft pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-ledger-text">
          Conteúdo original da linha
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-[10px] bg-cream-2 p-3 text-xs text-ledger-muted">
          {JSON.stringify(linha.raw, null, 2)}
        </pre>
      </details>
    </aside>
  );
}

/** Resumo aritmético mostrado antes de confirmar a conciliação. */
function ResumoConciliacao({
  somaLinhas,
  alocacoes,
  tarifa,
  juros,
  desconto,
}: {
  somaLinhas: number;
  alocacoes: string[];
  tarifa: string;
  juros: string;
  desconto: string;
}) {
  const somaAloc = alocacoes.reduce((t, v) => t + (reaisParaCentavos(v) ?? 0), 0);
  const ajustes =
    (reaisParaCentavos(tarifa) ?? 0) +
    (reaisParaCentavos(juros) ?? 0) -
    (reaisParaCentavos(desconto) ?? 0);
  const diferenca = somaLinhas - somaAloc - ajustes;
  return (
    <div className="rounded-[10px] border border-line-soft bg-cream-2 p-3 text-sm">
      <p className="ledger-eyebrow">Resumo antes de confirmar</p>
      <ul className="mt-2 space-y-1 text-ledger-text">
        <li className="flex justify-between gap-3">
          <span>Soma das linhas selecionadas</span>
          <span className="tabular-nums">{formatBRLFromCents(somaLinhas)}</span>
        </li>
        <li className="flex justify-between gap-3">
          <span>Soma das alocações</span>
          <span className="tabular-nums">{formatBRLFromCents(somaAloc)}</span>
        </li>
        <li className="flex justify-between gap-3">
          <span>Tarifa, juros e desconto</span>
          <span className="tabular-nums">{formatBRLFromCents(ajustes)}</span>
        </li>
        <li className="flex justify-between gap-3 font-semibold">
          <span>Diferença restante</span>
          <span
            className={
              diferenca === 0 ? "tabular-nums text-emerald-700" : "tabular-nums text-rose-700"
            }
          >
            {formatBRLFromCents(diferenca)}
          </span>
        </li>
      </ul>
    </div>
  );
}

/** Conciliação de várias linhas do extrato para uma ou mais parcelas (N:1). */
function PainelLote({
  linhas,
  onFechar,
  onMudou,
}: {
  linhas: LinhaExtratoRow[];
  onFechar: () => void;
  onMudou: () => void;
}) {
  const [selecionadas, setSelecionadas] = React.useState<Record<string, string>>({});
  const [tarifa, setTarifa] = React.useState("");
  const [juros, setJuros] = React.useState("");
  const [desconto, setDesconto] = React.useState("");
  const [excedente, setExcedente] = React.useState(false);

  const soma = linhas.reduce((t, l) => t + ((l.valor_cents ?? 0) - l.conciliado_cents), 0);

  const sugestoes = useQuery({
    queryKey: ["fin-sugestoes-lote", linhas.map((l) => l.id).sort()],
    queryFn: async () => {
      const listas = await Promise.all(linhas.map((l) => sugerirCorrespondencias(l.id)));
      const mapa = new Map<string, (typeof listas)[number][number]>();
      for (const lista of listas)
        for (const s of lista) if (!mapa.has(s.installment_id)) mapa.set(s.installment_id, s);
      return Array.from(mapa.values()).sort((a, b) => b.score - a.score);
    },
  });

  const aplicar = useMutation({
    mutationFn: async () => {
      const alocacoes = Object.entries(selecionadas)
        .map(([installment_id, texto]) => ({
          installment_id,
          valor_cents: reaisParaCentavos(texto) ?? 0,
        }))
        .filter((a) => a.valor_cents > 0);
      if (alocacoes.length === 0)
        throw new Error("Escolha ao menos uma parcela e informe o valor.");
      return conciliar({
        line_ids: linhas.map((l) => l.id),
        alocacoes,
        tarifa_cents: reaisParaCentavos(tarifa) ?? 0,
        juros_cents: reaisParaCentavos(juros) ?? 0,
        desconto_cents: reaisParaCentavos(desconto) ?? 0,
        permitir_excedente: excedente,
        idempotency_key: `${linhas
          .map((l) => l.id)
          .sort()
          .join(",")}:${JSON.stringify(alocacoes)}`,
      });
    },
    onSuccess: () => {
      toast.success("Linhas conciliadas e lançadas no razão.");
      onMudou();
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <aside className="ledger-panel space-y-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="ledger-eyebrow">{linhas.length} linhas selecionadas</p>
          <p className="font-display text-lg font-bold tabular-nums text-ledger-text">
            {formatBRLFromCents(soma)}
          </p>
        </div>
        <button type="button" className="admin-btn" onClick={onFechar} aria-label="Limpar seleção">
          <X aria-hidden className="size-4" />
        </button>
      </div>

      <ul className="space-y-1 text-xs text-ledger-muted">
        {linhas.map((l) => (
          <li key={l.id} className="truncate">
            {dataBR(l.data)} · {l.historico || "Sem histórico"} ·{" "}
            {formatBRLFromCents(l.valor_cents ?? 0)}
          </li>
        ))}
      </ul>

      <div className="space-y-3">
        <p className="ledger-eyebrow">Parcelas candidatas</p>
        {sugestoes.isLoading && <Skeleton className="h-20 w-full" />}
        {sugestoes.data && sugestoes.data.length === 0 && (
          <p className="text-sm text-ledger-muted">
            Nenhuma parcela em aberto parecida com estas linhas.
          </p>
        )}
        <ul className="space-y-2">
          {(sugestoes.data ?? []).map((s) => (
            <li key={s.installment_id} className="rounded-[10px] border border-line-soft p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ledger-text">{s.titulo}</p>
                  <p className="text-xs text-ledger-muted">
                    {s.contraparte ?? "Sem contraparte"} · vence {dataBR(s.vencimento)} · em aberto{" "}
                    {formatBRLFromCents(s.aberto_cents)} · confiança {s.score}%
                  </p>
                </div>
                <input
                  value={selecionadas[s.installment_id] ?? ""}
                  onChange={(e) =>
                    setSelecionadas((p) => ({ ...p, [s.installment_id]: e.target.value }))
                  }
                  inputMode="decimal"
                  placeholder="0,00"
                  aria-label="Valor a alocar nesta parcela"
                  className={`${inputCls} w-32`}
                />
              </div>
            </li>
          ))}
        </ul>

        <div className="grid gap-2 sm:grid-cols-3">
          <input
            value={tarifa}
            onChange={(e) => setTarifa(e.target.value)}
            placeholder="Tarifa R$"
            className={inputCls}
          />
          <input
            value={juros}
            onChange={(e) => setJuros(e.target.value)}
            placeholder="Juros R$"
            className={inputCls}
          />
          <input
            value={desconto}
            onChange={(e) => setDesconto(e.target.value)}
            placeholder="Desconto R$"
            className={inputCls}
          />
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-ledger-muted">
          <input
            type="checkbox"
            checked={excedente}
            onChange={(e) => setExcedente(e.target.checked)}
          />
          Aceitar valor acima do saldo da parcela (excedente explícito)
        </label>

        <ResumoConciliacao
          somaLinhas={soma}
          alocacoes={Object.values(selecionadas)}
          tarifa={tarifa}
          juros={juros}
          desconto={desconto}
        />

        <button
          type="button"
          className="admin-btn-primary"
          disabled={aplicar.isPending}
          onClick={() => aplicar.mutate()}
        >
          {aplicar.isPending ? "Conciliando…" : "Conciliar linhas selecionadas"}
        </button>
      </div>
    </aside>
  );
}

/** Conciliação bancária: envio do extrato, correspondências e baixa pelo razão. */
export function Conciliacao() {
  const qc = useQueryClient();
  const caps = useCapabilities();
  const podeVer = caps.includes("finance.statement.view");
  const podeImportar = caps.includes("finance.statement.import");
  const podeDesfazer = caps.includes("finance.reconcile.undo");
  const processar = useServerFn(processarExtrato);

  const [conta, setConta] = React.useState("");
  const [status, setStatus] = React.useState("todos");
  const [de, setDe] = React.useState("");
  const [ate, setAte] = React.useState("");
  const [busca, setBusca] = React.useState("");
  const buscaLenta = useDebounce(busca);
  const [pagina, setPagina] = React.useState(0);
  const [aberta, setAberta] = React.useState<LinhaExtratoRow | null>(null);
  const [diagnostico, setDiagnostico] = React.useState<string | null>(null);
  const arquivoRef = React.useRef<HTMLInputElement>(null);

  const contas = useQuery({
    queryKey: ["fin-accounts"],
    queryFn: fetchFinAccounts,
    enabled: podeVer,
  });

  React.useEffect(() => {
    if (!conta && contas.data && contas.data.length > 0) setConta(contas.data[0]!.id);
  }, [contas.data, conta]);
  React.useEffect(() => setPagina(0), [conta, status, de, ate, buscaLenta]);

  const filtros = React.useMemo(
    () => ({
      ...(conta ? { financial_account_id: conta } : {}),
      ...(status !== "todos" ? { status } : {}),
      ...(de ? { de } : {}),
      ...(ate ? { ate } : {}),
      ...(buscaLenta ? { q: buscaLenta } : {}),
    }),
    [conta, status, de, ate, buscaLenta],
  );

  const linhas = useQuery({
    queryKey: ["fin-extrato-linhas", filtros, pagina],
    queryFn: () =>
      listarLinhasExtrato({ ...filtros, limit: PAGE_SIZE, offset: pagina * PAGE_SIZE }),
    enabled: podeVer && Boolean(conta),
  });
  const resumo = useQuery({
    queryKey: ["fin-extrato-resumo", conta, de, ate],
    queryFn: () =>
      resumoExtrato({
        ...(conta ? { financial_account_id: conta } : {}),
        ...(de ? { de } : {}),
        ...(ate ? { ate } : {}),
      }),
    enabled: podeVer && Boolean(conta),
  });

  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ["fin-extrato-linhas"] });
    void qc.invalidateQueries({ queryKey: ["fin-extrato-resumo"] });
    void qc.invalidateQueries({ queryKey: ["fin-accounts"] });
    void qc.invalidateQueries({ queryKey: ["fin-overview"] });
  };

  const enviar = useMutation({
    mutationFn: async (arquivo: File) => {
      if (!conta) throw new Error("Escolha a conta bancária antes de enviar o extrato.");
      const nome = arquivo.name.toLowerCase();
      const formato = nome.endsWith(".ofx") ? "ofx" : nome.endsWith(".csv") ? "csv" : null;
      if (!formato) throw new Error("Envie um arquivo CSV ou OFX.");
      const caminho = await enviarArquivoExtrato(conta, arquivo);
      return processar({
        data: {
          financial_account_id: conta,
          storage_path: caminho,
          original_name: arquivo.name,
          format: formato,
          size_bytes: arquivo.size,
        },
      });
    },
    onSuccess: (r) => {
      if (r.repetido) {
        setDiagnostico(
          `Este arquivo já havia sido importado (impressão digital ${r.sha256.slice(0, 12)}…). Nada foi duplicado.`,
        );
        toast.info("Arquivo já importado anteriormente.");
      } else {
        setDiagnostico(
          `Impressão digital ${r.sha256.slice(0, 12)}… · ${r.total} linhas lidas · ${r.validas} válidas · ${r.invalidas} inválidas · ${r.repetidas} repetidas.`,
        );
        toast.success("Extrato analisado. Nada foi lançado no razão ainda.");
      }
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [desfazendo, setDesfazendo] = React.useState<LinhaExtratoRow | null>(null);
  const [marcadas, setMarcadas] = React.useState<string[]>([]);

  const desfazer = useMutation({
    mutationFn: async ({ linha, motivo }: { linha: LinhaExtratoRow; motivo: string }) => {
      const { data, error } = await (
        await import("@/integrations/supabase/client")
      ).supabase
        .from("financial_reconciliation_allocations")
        .select("reconciliation_id, financial_reconciliations!inner(status)")
        .eq("line_id", linha.id)
        .eq("financial_reconciliations.status", "ativa")
        .limit(1);
      if (error) throw new Error(error.message);
      const alvo = data?.[0]?.reconciliation_id;
      if (!alvo) throw new Error("Nenhuma conciliação ativa encontrada para esta linha.");
      if (!motivo.trim()) throw new Error("Desfazer conciliação exige motivo.");
      return desfazerConciliacao(alvo, motivo.trim());
    },
    onSuccess: () => {
      toast.success("Conciliação desfeita por estorno. Nada foi apagado.");
      setDesfazendo(null);
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!podeVer) {
    return (
      <Panel>
        <EmptyState
          title="Acesso não liberado"
          description="Seu perfil não tem permissão para ver extratos bancários."
        />
      </Panel>
    );
  }

  const selecionavel = (r: LinhaExtratoRow) =>
    r.status === "pendente" || r.status === "parcial" || r.status === "divergente";

  const colunas: Column<LinhaExtratoRow>[] = [
    {
      key: "sel",
      header: "",
      render: (r) =>
        selecionavel(r) ? (
          <input
            type="checkbox"
            aria-label="Selecionar linha para conciliar em conjunto"
            checked={marcadas.includes(r.id)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              setMarcadas((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))
            }
          />
        ) : null,
    },
    {
      key: "data",
      header: "Data",
      render: (r) => <span className="tabular-nums">{dataBR(r.data)}</span>,
    },
    {
      key: "historico",
      header: "Lançamento",
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-ledger-text">
            {r.historico || "Sem histórico"}
          </p>
          <p className="truncate text-xs text-ledger-muted">
            linha {r.line_no}
            {r.bank_id ? ` · id ${r.bank_id}` : ""}
            {r.documento ? ` · doc. ${r.documento}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "valor",
      header: "Valor",
      render: (r) => (
        <span className={r.kind === "saida" ? "tabular-nums text-rose-700" : "tabular-nums"}>
          {r.kind === "saida" ? "− " : ""}
          {formatBRLFromCents(r.valor_cents ?? 0)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Situação",
      render: (r) => <StatusBadge tone={TOM[r.status]}>{STATUS_LINHA_LABEL[r.status]}</StatusBadge>,
    },
    {
      key: "acoes",
      header: "",
      render: (r) =>
        r.status === "conciliada" && podeDesfazer ? (
          <button
            type="button"
            className="admin-btn"
            onClick={(e) => {
              e.stopPropagation();
              setDesfazendo(r);
            }}
          >
            Desfazer
          </button>
        ) : null,
    },
  ];

  const opcoesConta = (contas.data ?? []).map((c) => ({ value: c.id, label: c.nome }));

  return (
    <div className="space-y-6">
      <Panel title="Extrato bancário">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SmartSelect
            options={opcoesConta}
            value={conta}
            onChange={setConta}
            placeholder="Conta bancária ou caixa"
          />
          <input
            type="date"
            value={de}
            onChange={(e) => setDe(e.target.value)}
            aria-label="De"
            className={inputCls}
          />
          <input
            type="date"
            value={ate}
            onChange={(e) => setAte(e.target.value)}
            aria-label="Até"
            className={inputCls}
          />
          <SmartSelect
            options={[
              { value: "todos", label: "Todas as situações" },
              ...(Object.keys(STATUS_LINHA_LABEL) as StatusLinha[]).map((s) => ({
                value: s,
                label: STATUS_LINHA_LABEL[s],
              })),
            ]}
            value={status}
            onChange={setStatus}
          />
        </div>

        {podeImportar && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              ref={arquivoRef}
              type="file"
              accept=".csv,.ofx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) enviar.mutate(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="admin-btn-primary"
              disabled={enviar.isPending || !conta}
              onClick={() => arquivoRef.current?.click()}
            >
              <Upload aria-hidden className="size-4" />
              {enviar.isPending ? "Analisando…" : "Enviar extrato (CSV ou OFX)"}
            </button>
            <span className="text-xs font-medium text-ledger-muted">
              CNAB: previsto para uma etapa futura, ainda não disponível.
            </span>
          </div>
        )}
        {diagnostico && (
          <p className="mt-3 rounded-[10px] border border-line-soft bg-cream-2 p-3 text-sm font-medium text-ledger-text">
            {diagnostico}
          </p>
        )}
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Entradas" valor={formatBRLFromCents(resumo.data?.entradas_cents ?? 0)} />
        <Indicador rotulo="Saídas" valor={formatBRLFromCents(resumo.data?.saidas_cents ?? 0)} />
        <Indicador rotulo="Pendentes" valor={resumo.data?.pendentes ?? 0} />
        <Indicador rotulo="Conciliadas" valor={resumo.data?.conciliadas ?? 0} />
        <Indicador rotulo="Divergentes" valor={resumo.data?.divergentes ?? 0} />
        <Indicador rotulo="Ignoradas" valor={resumo.data?.ignoradas ?? 0} />
        <Indicador rotulo="Inválidas" valor={resumo.data?.invalidas ?? 0} />
        <Indicador rotulo="Repetidas" valor={resumo.data?.repetidas ?? 0} />
      </div>

      {contas.data && contas.data.length === 0 ? (
        <Panel>
          <EmptyState
            title="Nenhuma conta cadastrada"
            description="Cadastre uma conta bancária em Contas e caixas antes de importar um extrato."
          />
        </Panel>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0">
            {contas.error ? (
              <ErrorState message="Não foi possível carregar as contas." />
            ) : (
              <DataTable
                columns={colunas}
                rows={linhas.data?.rows ?? []}
                rowKey={(r) => r.id}
                total={linhas.data?.total ?? 0}
                page={pagina}
                pageSize={PAGE_SIZE}
                onPageChange={setPagina}
                search={busca}
                onSearchChange={setBusca}
                searchPlaceholder="Buscar por histórico, documento ou identificador"
                isLoading={linhas.isLoading}
                error={linhas.error}
                onRetry={() => void linhas.refetch()}
                onRowClick={(r) => setAberta(r)}
                emptyTitle="Nenhuma linha de extrato"
                emptyDescription="Envie um arquivo CSV ou OFX desta conta para começar a conciliar."
              />
            )}
          </div>
          {marcadas.length > 1 ? (
            <PainelLote
              linhas={(linhas.data?.rows ?? []).filter((r) => marcadas.includes(r.id))}
              onFechar={() => setMarcadas([])}
              onMudou={() => {
                setMarcadas([]);
                atualizar();
              }}
            />
          ) : aberta ? (
            <PainelLinha
              linha={linhas.data?.rows.find((r) => r.id === aberta.id) ?? aberta}
              onFechar={() => setAberta(null)}
              onMudou={atualizar}
            />
          ) : null}
        </div>
      )}

      <PedirDadosDialog
        open={!!desfazendo}
        titulo="Desfazer conciliação"
        descricao="A conciliação é revertida por estorno. Nada é apagado do histórico."
        campos={[{ nome: "motivo", rotulo: "Motivo", tipo: "area", obrigatorio: true }]}
        confirmar="Desfazer"
        onOpenChange={(v) => !v && setDesfazendo(null)}
        onConfirmar={(vals) =>
          desfazer.mutate({ linha: desfazendo as LinhaExtratoRow, motivo: vals["motivo"] ?? "" })
        }
      />
    </div>
  );
}
