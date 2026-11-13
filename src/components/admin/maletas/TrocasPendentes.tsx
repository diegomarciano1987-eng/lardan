/**
 * 0324 — Maleta trocada ou devolvida depois da nota autorizada: a parte fiscal é AUTOMÁTICA.
 * O sistema cancela a nota antiga (menos de 23 h, maleta não saiu) ou faz a nota de devolução, e a nota nova
 * sai pelo processo normal. Não existe mais "marcar como resolvida" nem instrução de emissor.
 * Na tela só aparece algo quando o automático NÃO conseguiu (ex.: cadastro sem CPF) — com o motivo.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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
  auto_status: "aguardando" | "processando" | "feito" | "erro" | "manual";
  auto_erro: string | null;
}

const CAMPOS = "id, cycle_id, remessa_id, maleta, consultora_anterior_nome, consultora_nova_nome, nota_numero, criado_em, origem, motivo, auto_status, auto_erro";

/** Trocas abertas da remessa (a nota está sendo trocada sozinha). */
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
    refetchInterval: 60_000,
  });
}

const textoErro = (p: Pendencia) =>
  (p.auto_erro ?? "").startsWith("CONFERIR NA FOCUS")
    ? `A SEFAZ deu uma resposta incerta na nota da troca. Confira em Integrações › Nota fiscal antes de qualquer outra nota.`
    : `A nota da troca não saiu sozinha: ${p.auto_erro ?? "motivo não informado"}`;

/** Ao lado do DANFE: só quando o automático parou e precisa de alguém (ex.: cadastro incompleto). */
export function SeloNotaTroca({ pendencia }: { pendencia: Pendencia }) {
  if (pendencia.auto_status !== "erro") return null;
  return (
    <span role="status" className="inline-flex max-w-96 items-center gap-1.5 rounded-full border border-warning/50 bg-warning/10 px-3 py-1.5 text-xs font-semibold text-ledger-text"
      title={pendencia.auto_erro ?? ""}>
      <AlertTriangle aria-hidden className="size-3.5 shrink-0 text-warning" />
      <span className="truncate">{textoErro(pendencia)}</span>
    </span>
  );
}

/** Página da maleta: mesma regra — nada enquanto o automático trabalha; o motivo se ele parou. */
export function AvisoNotaTrocaMaleta({ cycleId }: { cycleId: string }) {
  const q = useQuery({
    queryKey: ["remessas", "trocas-pendentes", "maleta", cycleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maleta_troca_pendencias" as never)
        .select(CAMPOS)
        .eq("cycle_id", cycleId)
        .eq("status", "aberta")
        .eq("auto_status", "erro");
      if (error) throw error;
      return (data ?? []) as unknown as Pendencia[];
    },
  });
  const lista = q.data ?? [];
  if (lista.length === 0) return null;
  return (
    <div role="status" className="space-y-2 rounded-2xl border border-warning/50 bg-warning/5 p-5 text-sm">
      {lista.map((p) => (
        <p key={p.id} className="flex items-start gap-2 text-ledger-text">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>{textoErro(p)} Assim que o motivo for corrigido, o sistema tenta de novo sozinho.</span>
        </p>
      ))}
    </div>
  );
}

/** 0283: devolução feita por engano — só o Master desfaz; a maleta volta para o representante (depois é só Transferir). */
export function DesfazerDevolucaoMaleta({ cycleId, maleta }: { cycleId: string; maleta: string | null }) {
  const qc = useQueryClient();
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
  const desfazer = useMutation({
    mutationFn: async () => {
      const motivo = window.prompt(`Desfazer a devolução da maleta ${maleta ?? ""}? As peças voltam para a maleta e ela fica de novo com o representante. Escreva o motivo:`, "Devolução registrada por engano");
      if (motivo === null) return null;
      const { data, error } = await supabase.rpc("maleta_devolucao_desfazer", { _cycle: cycleId, _motivo: motivo });
      if (error) throw new Error(error.message);
      return data as unknown as { pecas: number };
    },
    onSuccess: (r) => {
      if (!r) return;
      toast.success(`Devolução desfeita: ${r.pecas} peças voltaram para a maleta. A nota fiscal se ajusta sozinha.`, { duration: 10000 });
      void qc.invalidateQueries({ queryKey: ["remessas"] });
      void qc.invalidateQueries({ queryKey: ["maletas"] });
      void qc.invalidateQueries({ queryKey: ["focus", "notas-maletas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!master.data) return null;
  return (
    <button type="button" className="admin-btn w-full" disabled={desfazer.isPending} onClick={() => desfazer.mutate()}>
      <Undo2 aria-hidden className="size-4" /> {desfazer.isPending ? "Desfazendo…" : "Desfazer devolução (engano)"}
    </button>
  );
}

/** Página da maleta: a nota fiscal é emitida e consultada na linha da maleta, dentro da remessa. */
export function LinkNotaNaRemessa({ cycleId }: { cycleId: string }) {
  const q = useQuery({
    queryKey: ["maletas", "remessa-do-ciclo", cycleId],
    queryFn: async () => {
      const { data, error } = await supabase.from("kit_cycles").select("remessa_id").eq("id", cycleId).maybeSingle();
      if (error) throw error;
      return (data as { remessa_id: string | null } | null)?.remessa_id ?? null;
    },
    staleTime: 300_000,
  });
  if (!q.data) {
    return (
      <p className="rounded-lg border border-line-soft p-3 text-xs text-ledger-muted">
        A nota fiscal desta maleta é feita na página da remessa dela.
      </p>
    );
  }
  return (
    <Link to="/admin/maletas/remessa/$id" params={{ id: q.data }} className="admin-btn w-full"
      title="A nota fiscal de remessa, o DANFE e as notas do acerto ficam na linha desta maleta, na página da remessa.">
      Nota fiscal: abrir na remessa
    </Link>
  );
}
