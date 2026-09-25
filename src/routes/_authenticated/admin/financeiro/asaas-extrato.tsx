import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { Conciliacao } from "@/components/admin/financeiro/Conciliacao";
import { EmptyState, Panel, Skeleton } from "@/components/admin/ui";
import { contaExtratoAsaas, sincronizarExtratoAsaas, statusSyncExtratoAsaas } from "@/lib/asaas/extrato.functions";

export const Route = createFileRoute("/_authenticated/admin/financeiro/asaas-extrato")({
  component: Pagina,
  head: () => ({ meta: [{ title: "Extrato Asaas — Financeiro Lardan" }] }),
});


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
  const buscarStatus = useServerFn(statusSyncExtratoAsaas);
  const conta = useQuery({ queryKey: ["asaas-extrato-conta"], queryFn: () => buscarConta() });
  const status = useQuery({ queryKey: ["asaas-extrato-status"], queryFn: () => buscarStatus() });

  const aoConcluir = () => {
    void qc.invalidateQueries({ queryKey: ["fin-extrato-linhas"] });
    void qc.invalidateQueries({ queryKey: ["fin-extrato-resumo"] });
    void qc.invalidateQueries({ queryKey: ["asaas-extrato-status"] });
  };

  const sync = useMutation({
    mutationFn: (p: { de: string; ate: string; modo: "manual" | "matinal" }) =>
      sincronizar({ data: { de: p.de, ate: p.ate, modo: p.modo, financial_account_id: conta.data!.id } }),
    onSuccess: (r, p) => {
      if (r.pulado) return;
      if (p.modo === "matinal") {
        if (r.novas > 0) toast.success(`Sincronização da manhã: ${r.novas} movimentações novas do Asaas.`);
      } else {
        toast.success(
          r.novas > 0
            ? `${r.novas} movimentações novas trazidas do Asaas.`
            : `Tudo em dia: ${r.total} movimentações já estavam aqui.`,
        );
      }
      aoConcluir();
    },
    onError: (e: Error, p) => {
      if (p.modo === "manual") toast.error(e.message);
      aoConcluir();
    },
  });

  // Sincronização da manhã: uma vez por dia, no mês atual; o servidor decide se já rodou.
  const disparou = React.useRef(false);
  React.useEffect(() => {
    if (disparou.current || !conta.data) return;
    disparou.current = true;
    const h = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    sync.mutate({
      de: iso(new Date(h.getFullYear(), h.getMonth(), 1)),
      ate: iso(new Date(h.getFullYear(), h.getMonth() + 1, 0)),
      modo: "matinal",
    });
  }, [conta.data, sync]);

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

  const u = status.data;
  const ultimaTxt = u
    ? `Última sincronização: ${new Date(u.quando).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · ${u.modo === "matinal" ? "automática da manhã" : "manual"}${u.quem ? ` por ${u.quem}` : ""} · ${u.novas} novas`
    : "Nenhuma sincronização registrada ainda.";

  return (
    <Conciliacao
      contaFixa={conta.data.id}
      titulo={`Extrato Asaas — ${conta.data.nome}`}
      mesAtualObrigatorio
      acoesTopo={({ de, ate }) => (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="admin-btn-primary"
            disabled={sync.isPending}
            onClick={() => sync.mutate({ de, ate, modo: "manual" })}
          >
            <RefreshCw aria-hidden className={`size-4 ${sync.isPending ? "animate-spin" : ""}`} />
            {sync.isPending ? "Buscando no Asaas…" : "Buscar movimentações do Asaas"}
          </button>
          <span className="text-xs font-medium text-ledger-muted">
            {ultimaTxt}. O sistema sincroniza sozinho uma vez por manhã; depois, só quando você clicar.
          </span>
        </div>
      )}
    />
  );
}
