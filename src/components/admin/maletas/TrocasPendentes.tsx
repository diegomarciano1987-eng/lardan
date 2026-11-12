/**
 * 0274 — Maletas que o representante passou para uma abertura depois da nota fiscal já emitida
 * em nome da consultora original. A troca já valeu; a montagem faz a parte fiscal
 * (devolução da original + nota nova da abertura) e marca aqui como resolvida.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/admin/ui";

export interface Pendencia {
  id: string;
  cycle_id: string;
  remessa_id: string | null;
  maleta: string | null;
  consultora_anterior_nome: string | null;
  consultora_nova_nome: string | null;
  nota_numero: string | null;
  criado_em: string;
  origem: string | null;
  motivo: string | null;
}

const CAMPOS = "id, cycle_id, remessa_id, maleta, consultora_anterior_nome, consultora_nova_nome, nota_numero, criado_em, origem, motivo";
export const ANCORA_NOTAS_TROCA = "notas-a-resolver";

/** Pendências fiscais de troca abertas na remessa (mesma consulta do painel; usada também nas linhas das maletas). */
export function useTrocasPendentes(remessaId: string) {
  return useQuery({
    queryKey: ["remessas", "trocas-pendentes", remessaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maleta_troca_pendencias" as never)
        .select(CAMPOS)
        .eq("remessa_id", remessaId)
        .eq("status", "aberta")
        .order("criado_em");
      if (error) throw error;
      return (data ?? []) as unknown as Pendencia[];
    },
  });
}

const novaDe = (p: Pendencia) => (p.origem === "devolucao" ? "a empresa (devolvida)" : p.consultora_nova_nome ?? "—");

/** Selo ao lado do botão DANFE: a nota mostrada ainda é da consultora anterior. */
export function SeloNotaTroca({ pendencia }: { pendencia: Pendencia }) {
  return (
    <a href={`#${ANCORA_NOTAS_TROCA}`}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-warning/50 bg-warning/10 px-3 text-xs font-semibold text-ledger-text hover:bg-warning/20"
      title={`A nota nº ${pendencia.nota_numero ?? "—"} foi emitida para ${pendencia.consultora_anterior_nome ?? "a consultora anterior"} e não muda de nome. Veja os passos no quadro "Maletas transferidas".`}>
      <AlertTriangle aria-hidden className="size-3.5 text-warning" />
      Nota em nome de {pendencia.consultora_anterior_nome ?? "outra consultora"} · como resolver
    </a>
  );
}

/** Aviso na página da maleta quando ela mudou de dona depois da nota. */
export function AvisoNotaTrocaMaleta({ cycleId }: { cycleId: string }) {
  const q = useQuery({
    queryKey: ["remessas", "trocas-pendentes", "maleta", cycleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maleta_troca_pendencias" as never)
        .select(CAMPOS)
        .eq("cycle_id", cycleId)
        .eq("status", "aberta")
        .order("criado_em");
      if (error) throw error;
      return (data ?? []) as unknown as Pendencia[];
    },
  });
  const lista = q.data ?? [];
  if (lista.length === 0) return null;
  return (
    <div role="status" className="space-y-3 rounded-2xl border border-warning/50 bg-warning/5 p-5 text-sm">
      {lista.map((p) => (
        <div key={p.id} className="space-y-2">
          <p className="flex items-center gap-2 font-semibold text-ledger-text">
            <AlertTriangle aria-hidden className="size-4 text-warning" />
            Maleta passou de {p.consultora_anterior_nome ?? "—"} para {novaDe(p)}, mas a nota nº {p.nota_numero ?? "sem número"} continua em nome de {p.consultora_anterior_nome ?? "—"}.
          </p>
          <p className="max-w-3xl text-ledger-muted">
            Nota autorizada não muda de nome. No emissor: faça a nota de devolução de {p.consultora_anterior_nome ?? "quem estava com a maleta"}
            {p.origem === "devolucao" ? "" : ` e a nota nova de remessa para ${p.consultora_nova_nome ?? "quem ficou com a maleta"}`}; depois marque como resolvida na página da remessa.
          </p>
          {p.remessa_id && (
            <Link to="/admin/maletas/remessa/$id" params={{ id: p.remessa_id }} hash={ANCORA_NOTAS_TROCA} className="admin-btn h-9 px-3 text-xs">
              Ir para a remessa e resolver
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

export function TrocasPendentes({ remessaId, podeResolver }: { remessaId: string; podeResolver: boolean }) {
  const qc = useQueryClient();
  const q = useTrocasPendentes(remessaId);
  const [obs, setObs] = React.useState<Record<string, string>>({});
  const resolver = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("maleta_troca_pendencia_resolver" as never, { _id: id, _obs: obs[id] || null } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Pendência marcada como resolvida."); void qc.invalidateQueries({ queryKey: ["remessas", "trocas-pendentes"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const master = useQuery({
    queryKey: ["eu", "master"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const { data } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "master" });
      return data === true;
    },
    staleTime: 300_000,
  });
  // 0283: devolução feita por engano — o Master desfaz e a maleta volta para o representante (depois é só Transferir)
  const desfazer = useMutation({
    mutationFn: async (p: Pendencia) => {
      const motivo = window.prompt(`Desfazer a devolução da maleta ${p.maleta ?? ""}? As peças voltam para a maleta e ela fica de novo com o representante. Escreva o motivo:`, "Entreguei a maleta para a consultora errada");
      if (motivo === null) return null;
      const { data, error } = await supabase.rpc("maleta_devolucao_desfazer", { _cycle: p.cycle_id, _motivo: motivo });
      if (error) throw new Error(error.message);
      return data as unknown as { pecas: number };
    },
    onSuccess: (r) => {
      if (!r) return;
      toast.success(`Devolução desfeita: ${r.pecas} peças voltaram para a maleta. Agora use "Transferir" na maleta para passar para a consultora certa.`, { duration: 10000 });
      void qc.invalidateQueries({ queryKey: ["remessas"] });
      void qc.invalidateQueries({ queryKey: ["maletas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lista = q.data ?? [];
  if (lista.length === 0) return null;
  return (
    <div id={ANCORA_NOTAS_TROCA} className="scroll-mt-24">
    <Panel title={`Maletas transferidas — nota fiscal a resolver (${lista.length})`}>
      <p className="mb-3 max-w-3xl text-sm text-ledger-muted">
        Estas maletas mudaram de consultora depois que a nota de remessa já tinha saído em nome de outra.
        A troca já valeu na rua e no app. Por isso o botão DANFE da maleta ainda abre a nota antiga: nota autorizada não muda de nome.
      </p>
      <ol className="mb-4 max-w-3xl list-decimal space-y-1 pl-5 text-sm text-ledger-text">
        <li>No emissor, faça a <strong>nota de devolução</strong> em nome da consultora anterior (anula a remessa dela).</li>
        <li>Faça a <strong>nota nova de remessa</strong> em nome de quem ficou com a maleta (não precisa quando a maleta voltou para a empresa).</li>
        <li>Escreva os números das notas novas na observação e clique em <strong>Marcar como resolvida</strong>.</li>
      </ol>
      <div className="space-y-3">
        {lista.map((p) => (
          <div key={p.id} className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-line-soft bg-surface p-4">
            <div className="min-w-64 flex-1">
              <p className="font-semibold text-ledger-text">
                <Link to="/admin/maletas/$id" params={{ id: p.cycle_id }} className="hover:underline">{p.maleta ?? "Maleta"}</Link>: {p.consultora_anterior_nome ?? "—"} → {p.origem === "devolucao" ? "devolvida à empresa" : p.consultora_nova_nome ?? "—"}
              </p>
              <p className="text-xs text-ledger-muted">
                Nota de remessa nº {p.nota_numero ?? "sem número"} em nome de {p.consultora_anterior_nome ?? "—"} · {p.origem === "devolucao" ? "maleta devolvida à empresa (fazer a nota de devolução)" : p.origem === "equipe" ? "transferida pela equipe" : "trocada pelo representante"} em {new Date(p.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
              </p>
              {p.motivo && <p className="text-xs text-ledger-muted">Motivo: {p.motivo}</p>}
            </div>
            {master.data && p.origem === "devolucao" && (
              <button type="button" className="admin-btn h-9 px-3 text-xs" disabled={desfazer.isPending} onClick={() => desfazer.mutate(p)}>
                Desfazer devolução (engano)
              </button>
            )}
            {podeResolver && (
              <div className="flex flex-wrap items-center gap-2">
                <input className="admin-input h-9 w-64 text-sm" placeholder="Observação (nº das notas novas)" value={obs[p.id] ?? ""}
                  onChange={(e) => setObs((o) => ({ ...o, [p.id]: e.target.value }))} />
                <button type="button" className="admin-btn admin-btn-primary h-9 px-3 text-xs" disabled={resolver.isPending}
                  onClick={() => { if (window.confirm("As notas desta troca são feitas pela montagem no emissor (o sistema não emite sozinho). Confirmar que a nota de devolução e a nota nova já foram feitas?")) resolver.mutate(p.id); }}>
                  Marcar como resolvida
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Panel>
    </div>
  );
}
