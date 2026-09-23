import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { EmptyState, Panel, StatusBadge } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { supabase } from "@/integrations/supabase/client";
import { demoImportar } from "@/lib/asaas/demo.functions";

const ROTULO: Record<string, string> = {
  novo: "Novo recebimento",
  historico: "Histórico informativo",
  cliente_ambiguo: "Cliente sem vínculo",
  duplicidade_suspeita: "Possível duplicidade",
  ja_existe: "Já importado",
  vinculo_sugerido: "Resolvido",
  saldo_inicial: "Saldo devedor inicial",
  efetivado: "Efetivado",
};

interface Linha {
  id: string;
  external_id: string;
  classificacao: string;
  acao: string;
  motivo: string | null;
  title_id: string | null;
  payload: { valueCents?: number; dueDate?: string; customerName?: string | null; customer?: string };
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

function EscolherPessoa({ onEscolher }: { onEscolher: (id: string) => void }) {
  const [termo, setTermo] = React.useState("");
  const [valor, setValor] = React.useState<string>();
  const q = useQuery({
    queryKey: ["asaas", "pessoas", termo],
    queryFn: async () => {
      let consulta = supabase.from("parties").select("id, display_name").order("display_name").limit(30);
      if (termo.trim()) consulta = consulta.ilike("display_name", `%${termo.trim()}%`);
      const { data, error } = await consulta;
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <SmartSelect
      options={(q.data ?? []).map((p) => ({ value: p.id, label: p.display_name ?? p.id }))}
      value={valor}
      onChange={(v) => { setValor(v); onEscolher(v); }}
      onSearch={setTermo}
      loading={q.isFetching}
      placeholder="Escolher pessoa pelo cadastro"
      searchPlaceholder="Buscar pessoa…"
      emptyLabel="Nenhuma pessoa encontrada"
      className="min-w-[16rem]"
    />
  );
}

export function AsaasImportacao({ contaId }: { contaId: string | undefined }) {
  const importar = useServerFn(demoImportar);
  const qc = useQueryClient();
  const [runId, setRunId] = React.useState<string | null>(null);
  const [resumo, setResumo] = React.useState<{ total: number; resumo: Record<string, number>; paginas: number; trazidos: number } | null>(null);
  const [relatorio, setRelatorio] = React.useState<Record<string, unknown> | null>(null);
  const [pessoa, setPessoa] = React.useState<Record<string, string>>({});

  // Lote em andamento: quem aprova é outra pessoa, em outra sessão.
  const ultimo = useQuery({
    queryKey: ["asaas", "lote-aberto"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asaas_import_runs" as never)
        .select("id, status, approved_at")
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return ((data ?? []) as unknown as { id: string; status: string; approved_at: string | null }[])[0] ?? null;
    },
  });
  React.useEffect(() => {
    if (!runId && ultimo.data) setRunId(ultimo.data.id);
  }, [runId, ultimo.data]);

  const linhas = useQuery({
    queryKey: ["asaas", "stage", runId],
    enabled: !!runId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asaas_import_stage" as never)
        .select("id, external_id, classificacao, acao, motivo, title_id, payload")
        .eq("run_id", runId!)
        .eq("tipo", "cobranca")
        .in("classificacao", ["cliente_ambiguo", "duplicidade_suspeita", "vinculo_sugerido"])
        .order("external_id");
      if (error) throw error;
      return (data ?? []) as unknown as Linha[];
    },
  });

  const consultar = useMutation({
    mutationFn: () => importar({ data: { accountId: contaId! } }),
    onSuccess: (r) => {
      setRunId(r.lote.run_id);
      setRelatorio(null);
      setResumo(r.previa ? { total: r.previa.total, resumo: r.previa.resumo, paginas: r.busca.paginas, trazidos: r.busca.trazidos } : null);
      void qc.invalidateQueries({ queryKey: ["asaas", "stage"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resolver = useMutation({
    mutationFn: (p: { stage: string; acao: string; party?: string | null; title?: string | null }) =>
      rpc("asaas_import_resolver", { _stage: p.stage, _acao: p.acao, _party: p.party ?? null, _title: p.title ?? null, _motivo: "Revisão humana na prévia" }),
    onSuccess: async () => {
      if (runId) {
        const previa = await rpc<{ total: number; resumo: Record<string, number> }>("asaas_import_previa", { _run: runId });
        setResumo((r) => (r ? { ...r, total: previa.total, resumo: previa.resumo } : r));
      }
      void linhas.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const aprovar = useMutation({
    mutationFn: () => rpc<{ repetida: boolean; itens?: number }>("asaas_import_aprovar", { _run: runId, _motivo: "Aprovado na tela" }),
    onSuccess: (r) => toast.success(r.repetida ? "Lote já estava aprovado." : `Lote aprovado (${r.itens} cobranças).`),
    onError: (e: Error) => toast.error(e.message),
  });

  const efetivar = useMutation({
    mutationFn: () => rpc<Record<string, unknown>>("asaas_import_efetivar", { _run: runId, _limite: 500 }),
    onSuccess: (r) => { setRelatorio(r); void qc.invalidateQueries({ queryKey: ["asaas", "painel"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <Panel title="Prévia de importação">
        <p className="text-sm text-ledger-muted">
          A consulta usa o provedor simulado do servidor. A prévia classifica cada cobrança e não cria título, parcela nem baixa.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" disabled={!contaId || consultar.isPending} onClick={() => consultar.mutate()}
            className="rounded-lg border border-bronze px-4 py-2 text-sm font-semibold text-bronze disabled:opacity-50">
            {consultar.isPending ? "Consultando…" : "Consultar pelo adaptador"}
          </button>
          <button type="button" disabled={!runId || aprovar.isPending} onClick={() => aprovar.mutate()}
            className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:border-bronze disabled:opacity-50">
            Aprovar lote
          </button>
          <button type="button" disabled={!runId || efetivar.isPending} onClick={() => efetivar.mutate()}
            className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:border-bronze disabled:opacity-50">
            Efetivar localmente
          </button>
        </div>
        {resumo && (
          <div className="mt-5" data-testid="previa-resumo">
            <p className="text-sm font-semibold">{resumo.total} cobranças em {resumo.paginas} páginas</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(resumo.resumo).map(([k, n]) => (
                <StatusBadge key={k} tone={k === "cliente_ambiguo" || k === "duplicidade_suspeita" ? "warning" : "info"}>
                  {ROTULO[k] ?? k}: {n}
                </StatusBadge>
              ))}
            </div>
          </div>
        )}
        {relatorio && (
          <div className="mt-5 rounded-lg border border-line px-4 py-3 text-sm" data-testid="relatorio">
            <p className="font-semibold">Relatório da efetivação</p>
            <p className="mt-1 text-ledger-muted">
              Títulos criados: {String(relatorio["titulos_criados"])} · Vinculados: {String(relatorio["vinculados"])} ·
              Só espelho: {String(relatorio["somente_espelho"])} · Ignorados: {String(relatorio["ignorados"])}
            </p>
            <p className="mt-1 text-xs text-ledger-muted">{String(relatorio["aviso"] ?? "")}</p>
          </div>
        )}
      </Panel>

      {runId && (
        <Panel title="Revisão de clientes e duplicidades">
          {(linhas.data ?? []).length === 0 ? (
            <EmptyState title="Nada a revisar" description="Nenhuma pendência de cliente ou duplicidade neste lote." />
          ) : (
            <ul className="space-y-3 text-sm">
              {(linhas.data ?? []).map((l) => (
                <li key={l.id} className="rounded-lg border border-line px-4 py-3" data-testid={`pendencia-${l.classificacao}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{l.payload.customerName ?? l.payload.customer} · {(Number(l.payload.valueCents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · {l.payload.dueDate}</span>
                    <StatusBadge tone={l.classificacao === "vinculo_sugerido" ? "success" : "warning"}>{ROTULO[l.classificacao] ?? l.classificacao}</StatusBadge>
                  </div>
                  <p className="mt-1 text-ledger-muted">{l.motivo}</p>
                  {l.classificacao === "cliente_ambiguo" && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <EscolherPessoa onEscolher={(id) => setPessoa((p) => ({ ...p, [l.id]: id }))} />
                      <button type="button" disabled={!pessoa[l.id]} onClick={() => resolver.mutate({ stage: l.id, acao: "criar_titulo", party: pessoa[l.id] ?? null })}
                        className="rounded-lg border border-bronze px-3 py-1.5 text-xs font-semibold text-bronze disabled:opacity-50">
                        Criar título para esta pessoa
                      </button>
                      <button type="button" onClick={() => resolver.mutate({ stage: l.id, acao: "so_espelho" })}
                        className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold">Manter só no espelho</button>
                    </div>
                  )}
                  {l.classificacao === "duplicidade_suspeita" && (
                    <div className="mt-3 flex flex-wrap gap-3">
                      <button type="button" onClick={() => resolver.mutate({ stage: l.id, acao: "vincular", title: l.title_id })}
                        className="rounded-lg border border-bronze px-3 py-1.5 text-xs font-semibold text-bronze">
                        Vincular ao título já lançado
                      </button>
                      <button type="button" onClick={() => resolver.mutate({ stage: l.id, acao: "so_espelho" })}
                        className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold">Manter só no espelho</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}
