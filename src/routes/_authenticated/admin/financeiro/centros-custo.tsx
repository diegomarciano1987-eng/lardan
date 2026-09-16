import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { EmptyState, ErrorState, Panel, Skeleton, StatusBadge } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import {
  alternarCentroDeCusto,
  listCostCenters,
  salvarCentroDeCusto,
  type FinCostCenterRow,
} from "@/lib/financeiro";

export const Route = createFileRoute("/_authenticated/admin/financeiro/centros-custo")({
  component: CentrosCusto,
});

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25";

function CentrosCusto() {
  const qc = useQueryClient();
  const [busca, setBusca] = React.useState("");
  const [situacao, setSituacao] = React.useState("ativos");
  const [editando, setEditando] = React.useState<FinCostCenterRow | null>(null);
  const [novo, setNovo] = React.useState(false);

  const q = useQuery({
    queryKey: ["fin-cost-centers", busca, situacao],
    queryFn: () => listCostCenters({ busca, situacao, limit: 200, offset: 0 }),
  });

  const salvar = useMutation({
    mutationFn: (p: Record<string, unknown>) => salvarCentroDeCusto(p),
    onSuccess: () => {
      toast.success("Centro de custo salvo.");
      setNovo(false);
      setEditando(null);
      void qc.invalidateQueries({ queryKey: ["fin-cost-centers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const alternar = useMutation({
    mutationFn: (v: { id: string; ativo: boolean }) => alternarCentroDeCusto(v.id, v.ativo),
    onSuccess: () => {
      toast.success("Situação atualizada.");
      void qc.invalidateQueries({ queryKey: ["fin-cost-centers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pode = q.data?.pode_gerenciar ?? false;

  return (
    <AreaFinanceiraGuard capacidade="finance.view">
      <Panel
        title="Centros de custo"
        action={
          pode ? (
            <button type="button" className="admin-btn-primary" onClick={() => setNovo(true)}>
              <Plus aria-hidden className="size-4" />
              Novo centro de custo
            </button>
          ) : undefined
        }
      >
        <div className="mb-4 flex flex-wrap gap-3">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por código ou nome"
            className={`${inputCls} max-w-xs`}
          />
          <SmartSelect
            options={[
              { value: "ativos", label: "Somente ativos" },
              { value: "inativos", label: "Somente inativos" },
              { value: "todos", label: "Todos" },
            ]}
            value={situacao}
            onChange={setSituacao}
            className="w-52"
          />
        </div>

        {q.isLoading ? <Skeleton className="h-40 w-full" /> : null}
        {q.error ? <ErrorState message="Não foi possível carregar os centros de custo." /> : null}
        {q.data && q.data.rows.length === 0 ? (
          <EmptyState
            title="Nenhum centro de custo"
            description="Cadastre a estrutura usada para classificar despesas e receitas."
          />
        ) : null}

        {q.data && q.data.rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line-soft text-left">
                  <th className="py-3 pr-4 font-semibold text-ledger-muted">Código</th>
                  <th className="py-3 pr-4 font-semibold text-ledger-muted">Nome</th>
                  <th className="py-3 pr-4 font-semibold text-ledger-muted">Centro pai</th>
                  <th className="py-3 pr-4 font-semibold text-ledger-muted">Situação</th>
                  <th className="py-3" />
                </tr>
              </thead>
              <tbody>
                {q.data.rows.map((r) => (
                  <tr key={r.id} className="border-b border-line-soft/60">
                    <td className="py-3 pr-4 font-semibold tabular-nums text-ledger-text">
                      {r.codigo}
                    </td>
                    <td className="py-3 pr-4 text-ledger-text">{r.nome}</td>
                    <td className="py-3 pr-4 text-ledger-muted">{r.parent_label ?? "—"}</td>
                    <td className="py-3 pr-4">
                      <StatusBadge tone={r.is_active ? "success" : "neutral"}>
                        {r.is_active ? "Ativo" : "Inativo"}
                      </StatusBadge>
                    </td>
                    <td className="py-3 text-right">
                      {pode ? (
                        <div className="flex justify-end gap-2">
                          <button type="button" className="admin-btn" onClick={() => setEditando(r)}>
                            Editar
                          </button>
                          <button
                            type="button"
                            className="admin-btn"
                            onClick={() => alternar.mutate({ id: r.id, ativo: !r.is_active })}
                          >
                            {r.is_active ? "Inativar" : "Ativar"}
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>

      <Dialog
        open={novo || !!editando}
        onOpenChange={(v) => {
          if (!v) {
            setNovo(false);
            setEditando(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar centro de custo" : "Novo centro de custo"}</DialogTitle>
          </DialogHeader>
          <Formulario
            inicial={editando}
            opcoesPai={(q.data?.rows ?? []).filter((r) => r.id !== editando?.id)}
            salvando={salvar.isPending}
            onSalvar={(p) => salvar.mutate(editando ? { ...p, id: editando.id } : p)}
          />
        </DialogContent>
      </Dialog>
    </AreaFinanceiraGuard>
  );
}

function Formulario({
  inicial,
  opcoesPai,
  salvando,
  onSalvar,
}: {
  inicial: FinCostCenterRow | null;
  opcoesPai: FinCostCenterRow[];
  salvando: boolean;
  onSalvar: (p: Record<string, unknown>) => void;
}) {
  const [codigo, setCodigo] = React.useState(inicial?.codigo ?? "");
  const [nome, setNome] = React.useState(inicial?.nome ?? "");
  const [pai, setPai] = React.useState(inicial?.parent_id ?? "");

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!codigo.trim() || !nome.trim()) {
          toast.error("Informe o código e o nome.");
          return;
        }
        onSalvar({ codigo: codigo.trim(), nome: nome.trim(), parent_id: pai || null });
      }}
    >
      <label className="block text-sm font-medium text-ledger-muted">
        <span className="mb-1 block">Código</span>
        <input value={codigo} onChange={(e) => setCodigo(e.target.value)} className={inputCls} />
      </label>
      <label className="block text-sm font-medium text-ledger-muted">
        <span className="mb-1 block">Nome</span>
        <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} />
      </label>
      <div>
        <span className="mb-1 block text-sm font-medium text-ledger-muted">Centro pai</span>
        <SmartSelect
          options={[
            { value: "", label: "Sem centro pai" },
            ...opcoesPai.map((o) => ({ value: o.id, label: `${o.codigo} · ${o.nome}` })),
          ]}
          value={pai}
          onChange={setPai}
        />
      </div>
      <DialogFooter>
        <button type="submit" className="admin-btn-primary" disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </DialogFooter>
    </form>
  );
}
