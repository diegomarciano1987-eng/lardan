import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { Conciliacao } from "@/components/admin/financeiro/Conciliacao";
import { EmptyState, Panel, Skeleton } from "@/components/admin/ui";
import { contaExtratoAsaas, sincronizarExtratoAsaas } from "@/lib/asaas/extrato.functions";

export const Route = createFileRoute("/_authenticated/admin/financeiro/asaas-extrato")({
  component: Pagina,
  head: () => ({ meta: [{ title: "Extrato Asaas — Financeiro Lardan" }] }),
});

const INICIO = "2026-01-01";

function Pagina() {
  return (
    <AreaFinanceiraGuard capacidade="finance.statement.view">
      <ExtratoAsaas />
    </AreaFinanceiraGuard>
  );
}

function ExtratoAsaas() {
  const qc = useQueryClient();
  const buscarConta = useServerFn(contaExtratoAsaas);
  const sincronizar = useServerFn(sincronizarExtratoAsaas);
  const conta = useQuery({ queryKey: ["asaas-extrato-conta"], queryFn: () => buscarConta() });

  const sync = useMutation({
    mutationFn: () => sincronizar({ data: { de: INICIO, financial_account_id: conta.data!.id } }),
    onSuccess: (r) => {
      toast.success(
        r.novas > 0
          ? `${r.novas} movimentações novas trazidas do Asaas.`
          : `Tudo em dia: ${r.total} movimentações já estavam aqui.`,
      );
      void qc.invalidateQueries({ queryKey: ["fin-extrato-linhas"] });
      void qc.invalidateQueries({ queryKey: ["fin-extrato-resumo"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (conta.isLoading) return <Skeleton className="h-40" />;
  if (!conta.data)
    return (
      <Panel>
        <EmptyState
          title="Conta Asaas não cadastrada"
          description="Cadastre a conta Asaas em Contas e caixas para ver o extrato."
        />
      </Panel>
    );

  return (
    <Conciliacao
      contaFixa={conta.data.id}
      titulo={`Extrato Asaas — ${conta.data.nome}`}
      acoesTopo={
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="admin-btn-primary"
            disabled={sync.isPending}
            onClick={() => sync.mutate()}
          >
            <RefreshCw aria-hidden className={`size-4 ${sync.isPending ? "animate-spin" : ""}`} />
            {sync.isPending ? "Buscando no Asaas…" : "Buscar movimentações do Asaas"}
          </button>
          <span className="text-xs font-medium text-ledger-muted">
            Entradas e saídas desde 01/01/2026. Clique numa linha para vincular a uma conta a
            receber ou a pagar — o vínculo já quita o título.
          </span>
        </div>
      }
    />
  );
}
