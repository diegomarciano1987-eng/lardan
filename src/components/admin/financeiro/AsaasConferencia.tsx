import * as React from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ErrorState, Panel, Skeleton, formatBRLFromCents, formatInt } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";
import { useCapabilities } from "@/lib/capabilities";
import { fetchUltimaSyncAsaas, type LinhaPR } from "@/lib/financeiro-unificado";
import { sincronizarCobrancasAsaas } from "@/lib/asaas/espelho.functions";

const dataBR = (d?: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR") : "—");

const STATUS_ASAAS: Record<string, string> = {
  PENDING: "Aguardando pagamento",
  OVERDUE: "Vencida",
  RECEIVED: "Recebida",
  CONFIRMED: "Confirmada",
  RECEIVED_IN_CASH: "Recebida em dinheiro",
  DUNNING_REQUESTED: "Negativação pedida",
};

/** Ficha de uma cobrança do Asaas (somente leitura: a baixa acontece no Asaas). */
export function CobrancaAsaasSheet({ linha, onOpenChange }: { linha: LinhaPR | null; onOpenChange: (v: boolean) => void }) {
  return (
    <Sheet open={!!linha} onOpenChange={onOpenChange}>
      <SheetContent className="admin-scope w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{linha?.descricao ?? "Cobrança Asaas"}</SheetTitle>
          <SheetDescription>{linha ? `${linha.pessoa ?? "Cliente não identificado"} · ${linha.external_id ?? ""}` : ""}</SheetDescription>
        </SheetHeader>
        {linha ? (
          <div className="mt-6 space-y-5 px-1 pb-10">
            <span className="inline-flex rounded-full bg-asaas px-3 py-1 text-xs font-bold text-asaas-foreground">Asaas</span>
            <dl className="grid grid-cols-2 gap-3 rounded-[12px] border border-line-soft bg-cream-2 p-4 text-sm">
              <div>
                <dt className="text-xs text-ledger-muted">Valor</dt>
                <dd className="font-semibold tabular-nums">{formatBRLFromCents(linha.valor_cents)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ledger-muted">Recebido</dt>
                <dd className="font-semibold tabular-nums">{formatBRLFromCents(linha.liquidado_cents)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ledger-muted">Vencimento</dt>
                <dd className="tabular-nums">{dataBR(linha.vencimento)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ledger-muted">Situação no Asaas</dt>
                <dd>{STATUS_ASAAS[linha.status_externo ?? ""] ?? linha.status_externo ?? "—"}</dd>
              </div>
            </dl>
            <p className="text-sm text-ledger-muted">
              O recebimento desta cobrança é registrado pelo próprio Asaas. Para não haver baixa em dobro, ela não tem botão de baixa
              manual aqui: quando o cliente paga, a situação muda na próxima sincronização.
            </p>
            {linha.invoice_url ? (
              <a
                href={linha.invoice_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center rounded-[10px] bg-asaas px-4 text-sm font-semibold text-asaas-foreground"
              >
                Abrir fatura no Asaas
              </a>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Sincroniza todas as cobranças uma vez por dia, no primeiro acesso depois das 6h (horário de Brasília). */
export function useSincronizacaoDiariaAsaas(de: string, ate: string) {
  const qc = useQueryClient();
  const caps = useCapabilities();
  const sync = useServerFn(sincronizarCobrancasAsaas);
  const ultima = useQuery({ queryKey: ["asaas-sync-ultima"], queryFn: fetchUltimaSyncAsaas });
  const feito = React.useRef(false);
  React.useEffect(() => {
    if (feito.current || ultima.isLoading || ultima.error || !caps.includes("finance.receivable.view")) return;
    const agora = new Date();
    const sp = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    if (sp.getHours() < 6) return;
    const hoje6 = new Date(agora.getTime() - (sp.getTime() - new Date(sp.getFullYear(), sp.getMonth(), sp.getDate(), 6).getTime()));
    const u = ultima.data;
    if (u && new Date(u.iniciado_em) >= hoje6) return;
    feito.current = true;
    void (async () => {
      try {
        const r = await sync({ data: { de, ate } });
        if (caps.includes("finance.reconcile")) await supabase.rpc("asaas_conferencia_gerar" as never);
        toast.success(`Asaas atualizado automaticamente: ${formatInt(r.recebidas)} cobranças lidas.`);
        void qc.invalidateQueries({ queryKey: ["fin-pagar-receber"] });
        void qc.invalidateQueries({ queryKey: ["fin-overview"] });
        void qc.invalidateQueries({ queryKey: ["asaas-sync-ultima"] });
        void qc.invalidateQueries({ queryKey: ["asaas-conferencia"] });
      } catch {
        /* falha fica registrada na sincronização; o botão manual continua disponível */
      }
    })();
  }, [ultima.isLoading, ultima.data, ultima.error, caps, sync, de, ate, qc]);
}

interface LinhaConf {
  id: string;
  regra: string;
  status: string;
  evidencia: Record<string, unknown>;
  external_id: string;
  value_cents: number;
  vencimento_cobranca: string;
  payment_date: string | null;
  external_status: string;
  cliente: string | null;
  descricao_titulo: string;
  titulo_numero: string | null;
  numero: number;
  total_parcelas: number;
  vencimento_parcela: string;
  valor_parcela_cents: number;
  motivo: string | null;
}

const REGRA: Record<string, string> = {
  numero_fatura: "Nº da fatura igual",
  valor_data: "Mesmo valor e data próxima",
};

/** Conferência Asaas × títulos da Lardan: o certo entra sozinho; o resto espera revisão. */
export function ConferenciaAsaas() {
  const qc = useQueryClient();
  const caps = useCapabilities();
  const podeDecidir = caps.includes("finance.reconcile");
  const [aba, setAba] = React.useState<"sugerido" | "confirmado" | "recusado">("sugerido");
  const [pagina, setPagina] = React.useState(0);
  const POR = 20;
  const q = useQuery({
    queryKey: ["asaas-conferencia", aba, pagina],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("asaas_conferencia_lista" as never, { _status: aba, _limit: POR, _offset: pagina * POR } as never);
      if (error) throw new Error(error.message);
      return data as unknown as { rows: LinhaConf[]; total: number; resumo: Record<string, number> | null };
    },
  });
  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ["asaas-conferencia"] });
    void qc.invalidateQueries({ queryKey: ["fin-pagar-receber"] });
    void qc.invalidateQueries({ queryKey: ["fin-overview"] });
  };
  const gerar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("asaas_conferencia_gerar" as never);
      if (error) throw new Error(error.message);
      return data as unknown as { confirmados: number; sugeridos: number };
    },
    onSuccess: (r) => {
      toast.success(`Conferência: ${r.confirmados} confirmadas automaticamente, ${r.sugeridos} para revisar.`);
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const decidir = useMutation({
    mutationFn: async (v: { id: string; aceitar: boolean; motivo?: string }) => {
      const { error } = await supabase.rpc("asaas_conferencia_decidir" as never, { _match: v.id, _aceitar: v.aceitar, _motivo: v.motivo ?? null } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_r, v) => {
      toast.success(v.aceitar ? "Conferência aceita." : "Sugestão recusada.");
      invalidar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const d = q.data;
  const resumo = d?.resumo ?? {};
  const paginas = d ? Math.max(1, Math.ceil(d.total / POR)) : 1;

  return (
    <Panel title="Conferência Asaas × títulos da Lardan">
      <p className="text-sm text-ledger-muted">
        Liga cada cobrança do Asaas ao título da Lardan que já tem o mesmo recebimento, para não contar duas vezes. Entra sozinho só
        quando é certo: o número da fatura do Asaas está escrito no título, um para um, com o mesmo valor. O resto espera sua decisão.
        Nenhum título é alterado.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(
          [
            ["sugerido", "Para revisar"],
            ["confirmado", "Conferidas"],
            ["recusado", "Recusadas"],
          ] as const
        ).map(([k, r]) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setAba(k);
              setPagina(0);
            }}
            className={`min-h-10 rounded-[9px] px-4 text-sm font-semibold ${aba === k ? "bg-ledger-text text-surface" : "border border-line bg-surface text-ledger-text"}`}
          >
            {r} <span className="tabular-nums">({formatInt(resumo[k] ?? 0)})</span>
          </button>
        ))}
        {podeDecidir ? (
          <button
            type="button"
            disabled={gerar.isPending}
            onClick={() => gerar.mutate()}
            className="ml-auto inline-flex min-h-10 items-center rounded-[10px] bg-asaas px-4 text-sm font-semibold text-asaas-foreground disabled:opacity-60"
          >
            {gerar.isPending ? "Conferindo…" : "Conferir agora"}
          </button>
        ) : null}
      </div>
      {q.isLoading ? <Skeleton className="mt-3 h-24" /> : null}
      {q.error ? <ErrorState message={`Não foi possível carregar: ${(q.error as Error).message}`} /> : null}
      {d && d.rows.length === 0 ? <p className="py-6 text-center text-sm text-ledger-muted">Sem dados nesta aba.</p> : null}
      <ul className="mt-3 divide-y divide-line-soft">
        {(d?.rows ?? []).map((r) => (
          <li key={r.id} className="grid gap-3 py-3 md:grid-cols-[1fr_1fr_auto] md:items-center">
            <div className="text-sm">
              <p className="text-xs font-bold text-asaas">ASAAS · {r.external_id}</p>
              <p className="font-medium text-ledger-text">{r.cliente ?? "Cliente não identificado"}</p>
              <p className="text-xs text-ledger-muted tabular-nums">
                {formatBRLFromCents(r.value_cents)} · vence {dataBR(r.vencimento_cobranca)} · pago {dataBR(r.payment_date)}
              </p>
            </div>
            <div className="text-sm">
              <p className="text-xs font-bold text-ledger-muted">LARDAN · {REGRA[r.regra] ?? r.regra}</p>
              <p className="font-medium text-ledger-text">{r.descricao_titulo}</p>
              <p className="text-xs text-ledger-muted tabular-nums">
                Parcela {r.numero}/{r.total_parcelas} · {formatBRLFromCents(r.valor_parcela_cents)} · vence {dataBR(r.vencimento_parcela)}
              </p>
              {r.motivo ? <p className="text-xs text-ledger-muted">Motivo: {r.motivo}</p> : null}
            </div>
            {aba === "sugerido" && podeDecidir ? (
              <div className="flex gap-2">
                <button type="button" className="admin-btn-primary min-h-10" disabled={decidir.isPending} onClick={() => decidir.mutate({ id: r.id, aceitar: true })}>
                  Aceitar
                </button>
                <button
                  type="button"
                  className="admin-btn min-h-10"
                  disabled={decidir.isPending}
                  onClick={() => {
                    const m = window.prompt("Motivo da recusa:");
                    if (m && m.trim()) decidir.mutate({ id: r.id, aceitar: false, motivo: m.trim() });
                  }}
                >
                  Recusar
                </button>
              </div>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ul>
      {d && d.total > POR ? (
        <div className="flex items-center justify-end gap-2 pt-2 text-sm">
          <button type="button" className="admin-btn min-h-10" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>
            Anterior
          </button>
          <span className="tabular-nums">
            {pagina + 1} de {paginas}
          </span>
          <button type="button" className="admin-btn min-h-10" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>
            Próxima
          </button>
        </div>
      ) : null}
    </Panel>
  );
}
