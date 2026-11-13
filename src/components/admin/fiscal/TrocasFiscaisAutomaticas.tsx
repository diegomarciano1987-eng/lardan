/**
 * 0324 — Somente leitura: o que a troca automática de nota fez (maleta trocada ou devolvida depois da nota).
 * Não tem botão de resolver: o sistema cancela ou devolve a nota antiga e a nota nova sai pela fila normal.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ErrorState, Panel, Skeleton, StatusBadge, type StatusTone } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";

interface Troca {
  id: string;
  cycle_id: string;
  maleta: string | null;
  status: "aberta" | "resolvida";
  origem: string | null;
  anterior: string | null;
  nova: string | null;
  nota_numero: string | null;
  auto_status: "aguardando" | "processando" | "feito" | "erro" | "manual";
  auto_acao: "cancelar" | "devolucao" | null;
  auto_erro: string | null;
  proxima_em: string;
  resolvido_em: string | null;
  observacao: string | null;
  devolucao: { ref: string; status: string; numero: string | null } | null;
  nova_remessa: { ref: string; status: string; numero: string | null } | null;
}

const hora = (d: string) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function situacao(t: Troca): { tom: StatusTone; texto: string } {
  if (t.status === "resolvida") return { tom: "success", texto: "Concluída" };
  if (t.auto_status === "erro") return { tom: "danger", texto: "Parou" };
  if (t.auto_status === "processando") return { tom: "info", texto: t.auto_acao === "cancelar" ? "Cancelando" : "Devolução na SEFAZ" };
  return { tom: "neutral", texto: `Começa ${hora(t.proxima_em)}` };
}

export function TrocasFiscaisAutomaticas() {
  const q = useQuery({
    queryKey: ["focus", "trocas-automaticas"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fiscal_trocas_lista" as never);
      if (error) throw error;
      return (data ?? []) as unknown as Troca[];
    },
    refetchInterval: 60_000,
  });
  return (
    <Panel title="Notas de maletas trocadas ou devolvidas (automático)">
      <p className="mb-4 max-w-3xl text-sm text-ledger-muted">
        Quando uma maleta muda de consultora ou volta para a empresa depois da nota, o sistema cancela a nota antiga
        (se ela tem menos de 23 horas e a maleta não saiu) ou faz a nota de devolução. Depois a nota nova sai sozinha
        para quem ficou com a maleta. Espera 10 minutos depois do último movimento, para um engano desfeito na hora não gerar nota.
      </p>
      {q.isLoading ? <Skeleton className="h-24" /> : q.error ? <ErrorState title="Não foi possível carregar as trocas." /> : (q.data ?? []).length === 0 ? (
        <p className="text-sm text-ledger-muted">Sem trocas nos últimos 30 dias.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {(q.data ?? []).map((t) => {
            const s = situacao(t);
            return (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-64 flex-1 space-y-1">
                  <p className="font-semibold text-ledger-text">
                    <Link to="/admin/maletas/$id" params={{ id: t.cycle_id }} className="hover:underline">{t.maleta ?? "Maleta"}</Link>
                    {": "}{t.anterior ?? "—"} → {t.origem === "devolucao" ? "devolvida à empresa" : t.nova ?? "—"}
                  </p>
                  <p className="text-xs text-ledger-muted">
                    Nota antiga nº {t.nota_numero ?? "—"}
                    {t.auto_acao === "cancelar" ? " · cancelamento" : t.auto_acao === "devolucao" ? " · nota de devolução" : ""}
                    {t.devolucao?.numero ? ` nº ${t.devolucao.numero}` : ""}
                    {t.nova_remessa ? ` · nota nova ${t.nova_remessa.numero ? `nº ${t.nova_remessa.numero}` : "na SEFAZ"}` : ""}
                    {t.resolvido_em ? ` · ${hora(t.resolvido_em)}` : ""}
                  </p>
                  {t.status === "aberta" && t.auto_erro && <p className="text-xs text-danger">{t.auto_erro}</p>}
                </div>
                <StatusBadge tone={s.tom}>{s.texto}</StatusBadge>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
