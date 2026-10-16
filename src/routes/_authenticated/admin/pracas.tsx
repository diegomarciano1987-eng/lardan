import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus, Power } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, ErrorState, PageHeader, Panel, Skeleton, StatusBadge } from "@/components/admin/ui";
import { useCapabilities } from "@/lib/capabilities";
import { supabase } from "@/integrations/supabase/client";
import { traduzir } from "@/lib/maletas";

export const Route = createFileRoute("/_authenticated/admin/pracas")({
  component: PracasPage,
  head: () => ({
    meta: [
      { title: "Praças — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

interface PracaResumo {
  id: string;
  codigo: number;
  nome: string;
  ativo: boolean;
  consultoras: number;
}

async function listarPracas() {
  const { data, error } = await supabase.rpc("pracas_resumo" as never);
  if (error) throw error;
  return (data ?? []) as unknown as PracaResumo[];
}

function PracasPage() {
  const caps = useCapabilities();
  const podeGerenciar = caps.includes("kit.manage");
  const qc = useQueryClient();
  const [nome, setNome] = React.useState("");
  const [busca, setBusca] = React.useState("");

  const pracas = useQuery({ queryKey: ["pracas", "resumo"], queryFn: listarPracas });

  const criar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("praca_criar" as never, { _nome: nome } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Praça criada.");
      setNome("");
      void qc.invalidateQueries({ queryKey: ["pracas"] });
    },
    onError: (e) => toast.error(traduzir(e)),
  });

  const alternar = useMutation({
    mutationFn: async (p: PracaResumo) => {
      const { error } = await supabase.rpc("praca_alternar" as never, {
        _id: p.id,
        _ativo: !p.ativo,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pracas"] }),
    onError: (e) => toast.error(traduzir(e)),
  });

  const filtradas = (pracas.data ?? []).filter((p) =>
    busca.trim() ? p.nome.toLowerCase().includes(busca.trim().toLowerCase()) : true,
  );
  const totalConsultoras = (pracas.data ?? []).reduce((s, p) => s + Number(p.consultoras ?? 0), 0);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Núcleo comercial"
        title="Praças"
        description="As remessas são organizadas por praça. Cada praça reúne as consultoras daquela região e alimenta o BI territorial."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Panel>
          <p className="ledger-eyebrow">Praças ativas</p>
          <p className="mt-1 font-display text-3xl font-bold tabular-nums text-ledger-text">
            {(pracas.data ?? []).filter((p) => p.ativo).length}
          </p>
        </Panel>
        <Panel>
          <p className="ledger-eyebrow">Consultoras com praça</p>
          <p className="mt-1 font-display text-3xl font-bold tabular-nums text-ledger-text">
            {totalConsultoras}
          </p>
        </Panel>
        <Panel title="Nova praça">
          {podeGerenciar ? (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (nome.trim().length >= 2) criar.mutate();
              }}
            >
              <label className="min-w-56 flex-1 text-sm">
                <span className="ledger-eyebrow mb-1 block">Nome da praça</span>
                <input
                  className="admin-input w-full"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex.: LONDRINA - ZONA SUL"
                />
              </label>
              <button
                type="submit"
                className="admin-btn admin-btn-primary"
                disabled={criar.isPending || nome.trim().length < 2}
              >
                <Plus aria-hidden className="size-4" /> {criar.isPending ? "Criando…" : "Criar praça"}
              </button>
            </form>
          ) : (
            <p className="text-sm text-ledger-muted">
              Somente quem gerencia remessas pode criar praças.
            </p>
          )}
        </Panel>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="w-72 text-sm">
          <span className="ledger-eyebrow mb-1 block">Buscar praça</span>
          <input
            className="admin-input w-full"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Digite o nome da praça"
          />
        </label>
      </div>

      <Panel flush>
        {pracas.isLoading && (
          <div className="space-y-2 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        )}
        {pracas.isError && (
          <div className="px-6">
            <ErrorState message={traduzir(pracas.error)} onRetry={() => void pracas.refetch()} />
          </div>
        )}
        {pracas.data && filtradas.length === 0 && (
          <div className="px-6">
            <EmptyState
              title="Nenhuma praça encontrada"
              description="Crie uma nova praça acima ou ajuste a busca."
            />
          </div>
        )}
        {filtradas.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-4 border-b border-line-soft px-6 py-4"
          >
            <div className="flex min-w-0 items-center gap-3">
              <MapPin aria-hidden className="size-4 shrink-0 text-ledger-muted" />
              <div className="min-w-0">
                <p className="font-semibold text-ledger-text">{p.nome}</p>
                <p className="text-sm text-ledger-muted">Código {p.codigo}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="tabular-nums text-ledger-muted">
                {p.consultoras} consultora(s) ativa(s)
              </span>
              <StatusBadge tone={p.ativo ? "success" : "neutral"}>
                {p.ativo ? "Ativa" : "Inativa"}
              </StatusBadge>
              {podeGerenciar && (
                <button
                  type="button"
                  className="admin-btn"
                  disabled={alternar.isPending}
                  onClick={() => alternar.mutate(p)}
                  title={p.ativo ? "Desativar praça" : "Reativar praça"}
                >
                  <Power aria-hidden className="size-4" />
                  {p.ativo ? "Desativar" : "Reativar"}
                </button>
              )}
            </div>
          </div>
        ))}
      </Panel>

      <p className="text-xs text-ledger-muted">
        Praças nunca são excluídas: elas são dimensão de BI. Desativar apenas tira a praça das novas
        remessas.
      </p>
    </div>
  );
}
