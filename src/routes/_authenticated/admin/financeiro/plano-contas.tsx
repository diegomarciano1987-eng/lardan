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
  alternarContaContabil,
  listChartAccounts,
  salvarContaContabil,
  type FinChartRow,
} from "@/lib/financeiro";

export const Route = createFileRoute("/_authenticated/admin/financeiro/plano-contas")({
  component: PlanoContas,
});

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25";

function PlanoContas() {
  const qc = useQueryClient();
  const [busca, setBusca] = React.useState("");
  const [situacao, setSituacao] = React.useState("ativos");
  const [editando, setEditando] = React.useState<FinChartRow | null>(null);
  const [novo, setNovo] = React.useState(false);

  const q = useQuery({
    queryKey: ["fin-chart", busca, situacao],
    queryFn: () => listChartAccounts({ busca, situacao, limit: 200, offset: 0 }),
  });

  const salvar = useMutation({
    mutationFn: (payload: Record<string, unknown>) => salvarContaContabil(payload),
    onSuccess: () => {
      toast.success("Conta contábil salva.");
      setEditando(null);
      setNovo(false);
      void qc.invalidateQueries({ queryKey: ["fin-chart"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const alternar = useMutation({
    mutationFn: (v: { id: string; ativo: boolean }) => alternarContaContabil(v.id, v.ativo),
    onSuccess: () => {
      toast.success("Situação atualizada.");
      void qc.invalidateQueries({ queryKey: ["fin-chart"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pode = q.data?.pode_gerenciar ?? false;
  const aberto = novo || !!editando;

  return (
    <AreaFinanceiraGuard capacidade="finance.view">
      <Panel
        title="Plano de contas"
        action={
          pode ? (
            <button type="button" className="admin-btn-primary" onClick={() => setNovo(true)}>
              <Plus aria-hidden className="size-4" />
              Nova conta contábil
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
              { value: "ativos", label: "Somente ativas" },
              { value: "inativos", label: "Somente inativas" },
              { value: "todos", label: "Todas" },
            ]}
            value={situacao}
            onChange={setSituacao}
            className="w-52"
          />
        </div>

        {q.isLoading ? <Skeleton className="h-40 w-full" /> : null}
        {q.error ? <ErrorState message="Não foi possível carregar o plano de contas." /> : null}
        {q.data && q.data.rows.length === 0 ? (
          <EmptyState
            title="Nenhuma conta contábil"
            description="Cadastre a estrutura de classificação usada nos títulos."
          />
        ) : null}

        {q.data && q.data.rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line-soft text-left">
                  <th className="py-3 pr-4 font-semibold text-ledger-muted">Código</th>
                  <th className="py-3 pr-4 font-semibold text-ledger-muted">Nome</th>
                  <th className="py-3 pr-4 font-semibold text-ledger-muted">Natureza</th>
                  <th className="py-3 pr-4 font-semibold text-ledger-muted">Conta pai</th>
                  <th className="py-3 pr-4 font-semibold text-ledger-muted">Lançamento</th>
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
                    <td className="py-3 pr-4 text-ledger-muted">
                      {r.natureza === "receita" ? "Receita" : "Despesa"}
                    </td>
                    <td className="py-3 pr-4 text-ledger-muted">{r.parent_label ?? "—"}</td>
                    <td className="py-3 pr-4 text-ledger-muted">
                      {r.aceita_lancamento ? "Aceita" : "Só agrupa"}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge tone={r.is_active ? "success" : "neutral"}>
                        {r.is_active ? "Ativa" : "Inativa"}
                      </StatusBadge>
                    </td>
                    <td className="py-3 text-right">
                      {pode ? (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            className="admin-btn"
                            onClick={() => setEditando(r)}
                          >
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
        open={aberto}
        onOpenChange={(v) => {
          if (!v) {
            setNovo(false);
            setEditando(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar conta contábil" : "Nova conta contábil"}</DialogTitle>
          </DialogHeader>
          <FormularioConta
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

function FormularioConta({
  inicial,
  opcoesPai,
  salvando,
  onSalvar,
}: {
  inicial: FinChartRow | null;
  opcoesPai: FinChartRow[];
  salvando: boolean;
  onSalvar: (p: Record<string, unknown>) => void;
}) {
  const [codigo, setCodigo] = React.useState(inicial?.codigo ?? "");
  const [nome, setNome] = React.useState(inicial?.nome ?? "");
  const [natureza, setNatureza] = React.useState(inicial?.natureza ?? "despesa");
  const [pai, setPai] = React.useState(inicial?.parent_id ?? "");
  const [aceita, setAceita] = React.useState(inicial?.aceita_lancamento ?? true);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!codigo.trim() || !nome.trim()) {
          toast.error("Informe o código e o nome.");
          return;
        }
        onSalvar({
          codigo: codigo.trim(),
          nome: nome.trim(),
          natureza,
          parent_id: pai || null,
          aceita_lancamento: aceita,
        });
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
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-sm font-medium text-ledger-muted">Natureza</span>
          <SmartSelect
            options={[
              { value: "despesa", label: "Despesa" },
              { value: "receita", label: "Receita" },
            ]}
            value={natureza}
            onChange={setNatureza}
          />
        </div>
        <div>
          <span className="mb-1 block text-sm font-medium text-ledger-muted">Conta pai</span>
          <SmartSelect
            options={[
              { value: "", label: "Sem conta pai" },
              ...opcoesPai.map((o) => ({ value: o.id, label: `${o.codigo} · ${o.nome}` })),
            ]}
            value={pai}
            onChange={setPai}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium text-ledger-text">
        <input type="checkbox" checked={aceita} onChange={(e) => setAceita(e.target.checked)} />
        Aceita lançamento direto
      </label>
      <DialogFooter>
        <button type="submit" className="admin-btn-primary" disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </DialogFooter>
    </form>
  );
}
