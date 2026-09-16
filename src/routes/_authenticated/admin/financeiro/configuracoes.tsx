import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState, Panel, Skeleton, StatusBadge } from "@/components/admin/ui";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { alternarFormaPagamento, fetchFinSettings, salvarFormaPagamento } from "@/lib/financeiro";

export const Route = createFileRoute("/_authenticated/admin/financeiro/configuracoes")({
  component: ConfiguracoesFinanceiras,
});

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25";

function ConfiguracoesFinanceiras() {
  const qc = useQueryClient();
  const [codigo, setCodigo] = React.useState("");
  const [nome, setNome] = React.useState("");

  const q = useQuery({ queryKey: ["fin-settings"], queryFn: fetchFinSettings });

  const salvar = useMutation({
    mutationFn: () => salvarFormaPagamento({ codigo: codigo.trim(), nome: nome.trim() }),
    onSuccess: () => {
      toast.success("Forma de pagamento salva.");
      setCodigo("");
      setNome("");
      void qc.invalidateQueries({ queryKey: ["fin-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const alternar = useMutation({
    mutationFn: (v: { id: string; ativo: boolean }) => alternarFormaPagamento(v.id, v.ativo),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["fin-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pode = q.data?.pode_gerenciar ?? false;

  return (
    <AreaFinanceiraGuard capacidade="finance.view">
      <div className="space-y-6">
        {q.isLoading ? <Skeleton className="h-40 w-full" /> : null}
        {q.error ? <ErrorState message="Não foi possível carregar as configurações." /> : null}

        {q.data ? (
          <>
            <Panel title="Formas de pagamento">
              {q.data.formas_pagamento.length === 0 ? (
                <p className="text-sm font-medium text-ledger-muted">
                  Nenhuma forma de pagamento cadastrada.
                </p>
              ) : (
                <ul className="space-y-2">
                  {q.data.formas_pagamento.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center justify-between gap-3 rounded-[12px] border border-line-soft bg-cream-2 px-4 py-3"
                    >
                      <div>
                        <p className="font-semibold text-ledger-text">{f.nome}</p>
                        <p className="text-xs text-ledger-muted">{f.codigo}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge tone={f.is_active ? "success" : "neutral"}>
                          {f.is_active ? "Ativa" : "Inativa"}
                        </StatusBadge>
                        {pode ? (
                          <button
                            type="button"
                            className="admin-btn"
                            onClick={() => alternar.mutate({ id: f.id, ativo: !f.is_active })}
                          >
                            {f.is_active ? "Inativar" : "Ativar"}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {pode ? (
                <form
                  className="mt-4 flex flex-wrap items-end gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!codigo.trim() || !nome.trim()) {
                      toast.error("Informe o código e o nome.");
                      return;
                    }
                    salvar.mutate();
                  }}
                >
                  <label className="text-sm font-medium text-ledger-muted">
                    <span className="mb-1 block">Código</span>
                    <input
                      value={codigo}
                      onChange={(e) => setCodigo(e.target.value)}
                      className={`${inputCls} w-40`}
                    />
                  </label>
                  <label className="text-sm font-medium text-ledger-muted">
                    <span className="mb-1 block">Nome</span>
                    <input
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      className={`${inputCls} w-64`}
                    />
                  </label>
                  <button type="submit" className="admin-btn-primary" disabled={salvar.isPending}>
                    Adicionar
                  </button>
                </form>
              ) : null}
            </Panel>

            <Panel title="Regra de aprovação">
              <p className="text-sm font-medium text-ledger-text">{q.data.aprovacao.regra}</p>
              <p className="mt-1 text-xs font-medium text-ledger-muted">
                A parametrização por valor, natureza, centro de custo ou perfil está preparada na
                estrutura e será ligada quando o Daniel definir os limites.
              </p>
            </Panel>

            <Panel title="Integrações">
              <ul className="space-y-2">
                {q.data.integracoes.map((i) => (
                  <li
                    key={i.nome}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-line-soft bg-cream-2 px-4 py-3"
                  >
                    <div>
                      <p className="font-semibold text-ledger-text">{i.nome}</p>
                      <p className="text-xs text-ledger-muted">{i.observacao}</p>
                    </div>
                    <StatusBadge tone="neutral">{i.status}</StatusBadge>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs font-medium text-ledger-muted">
                Nenhuma cobrança, PIX ou boleto é emitido por aqui. Nada está conectado a um
                provedor externo.
              </p>
            </Panel>
          </>
        ) : null}
      </div>
    </AreaFinanceiraGuard>
  );
}
