/**
 * Informações da remessa (0246): no fim da montagem, uma linha por consultora da praça.
 *  • com maleta: "Informações para o acerto" (o que o representante precisa saber no acerto);
 *  • sem maleta nesta remessa: o motivo (inadimplente, pausa, sem estoque, desistiu, outro) e a observação.
 * O representante vê isso no app (Informações da remessa) e no checklist de acertos.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Panel, StatusBadge } from "@/components/admin/ui";
import { traduzir } from "@/lib/maletas";
import { MOTIVOS_SEM_MALETA, informacoesDaRemessa, salvarInformacaoRemessa, type InformacaoRemessa, type MotivoSemMaleta } from "@/lib/remessas";

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function useInformacoesRemessa(remessaId: string) {
  return useQuery({ queryKey: ["remessas", "informacoes", remessaId], queryFn: () => informacoesDaRemessa(remessaId) });
}
/** Quantas consultoras da praça ficaram sem maleta e sem motivo anotado. */
export const semAnotacao = (l: InformacaoRemessa[] | undefined) => (l ?? []).filter((i) => !i.tem_maleta && !i.sem_maleta_motivo).length;

/** Informações para o acerto dentro do cartão da maleta (uma por consultora). */
export function InfoAcertoInline({ remessaId, partyId, podeEditar }: { remessaId: string; partyId: string; podeEditar: boolean }) {
  const q = useInformacoesRemessa(remessaId);
  const i = (q.data ?? []).find((x) => x.party_id === partyId && x.tem_maleta);
  if (!i) return null;
  return <InfoAcertoCampo remessaId={remessaId} i={i} podeEditar={podeEditar} />;
}

function InfoAcertoCampo({ remessaId, i, podeEditar }: { remessaId: string; i: InformacaoRemessa; podeEditar: boolean }) {
  const qc = useQueryClient();
  const [info, setInfo] = React.useState(i.info_acerto ?? "");
  React.useEffect(() => setInfo(i.info_acerto ?? ""), [i.info_acerto]);
  const mudou = info.trim() !== (i.info_acerto ?? "");
  const salvar = useMutation({
    mutationFn: () => salvarInformacaoRemessa(remessaId, i.party_id, null, info),
    onSuccess: () => { toast.success(`Salvo: ${i.nome}`); void qc.invalidateQueries({ queryKey: ["remessas", "informacoes", remessaId] }); },
    onError: (e) => toast.error(traduzir(e)),
  });
  return (
    <div className="flex w-full flex-wrap items-center gap-2" data-info-acerto="">
      <span className="w-40 shrink-0 text-xs font-semibold text-ledger-muted">
        Informação para o acerto
        {i.debito_vencido_cents > 0 && <span className="block text-destructive">Débito vencido {brl(i.debito_vencido_cents)}</span>}
      </span>
      <input className="admin-input h-9 min-w-64 flex-1 text-sm" maxLength={2000} disabled={!podeEditar} value={info} onChange={(e) => setInfo(e.target.value)}
        aria-label={`Informações para o acerto de ${i.nome}`}
        placeholder="Ex.: cobrar parcela atrasada, trocar brinco com defeito (vai para o representante)" />
      {podeEditar && mudou && (
        <button type="button" className="admin-btn admin-btn-primary h-9 px-4 text-xs" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
          {salvar.isPending ? "Salvando…" : "Salvar"}
        </button>
      )}
    </div>
  );
}

/** Lista só quem ficou sem maleta nesta remessa (o motivo). Quem tem maleta anota dentro do cartão da maleta. */
export function InformacoesRemessa({ remessaId, podeEditar }: { remessaId: string; podeEditar: boolean }) {
  const q = useInformacoesRemessa(remessaId);
  const [filtro, setFiltro] = React.useState<"sem" | "pendentes">("sem");
  const l = (q.data ?? []).filter((i) => !i.tem_maleta);
  if (q.isSuccess && l.length === 0) return null;
  const pend = semAnotacao(l);
  const vis = l.filter((i) => filtro === "sem" || !i.sem_maleta_motivo);
  return (
    <Panel title="Consultoras da praça sem maleta nesta remessa">
      <div className="space-y-4 text-sm">
        <p className="text-ledger-muted">
          Anote por que cada uma ficou sem maleta. As informações para o acerto de quem tem maleta ficam no próprio cartão da maleta, acima.
        </p>
        <div className="flex flex-wrap gap-2">
          {([["sem", `Sem maleta (${l.length})`], ["pendentes", `Sem motivo (${pend})`]] as const).map(([id, r]) => (
            <button key={id} type="button" onClick={() => setFiltro(id)} className={`admin-btn h-9 px-3 text-xs ${filtro === id ? "admin-btn-primary" : ""}`}>{r}</button>
          ))}
        </div>
        {q.isLoading && <p className="text-ledger-muted">Carregando consultoras da praça…</p>}
        {q.error && <p className="text-destructive">{traduzir(q.error)}</p>}
        <ul className="divide-y divide-line-soft rounded-xl border border-line-soft">
          {vis.map((i) => <Linha key={i.party_id} remessaId={remessaId} i={i} podeEditar={podeEditar} />)}
        </ul>
      </div>
    </Panel>
  );
}

function Linha({ remessaId, i, podeEditar }: { remessaId: string; i: InformacaoRemessa; podeEditar: boolean }) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = React.useState<MotivoSemMaleta | "">(i.sem_maleta_motivo ?? "");
  const [info, setInfo] = React.useState(i.info_acerto ?? "");
  const mudou = (motivo || null) !== (i.sem_maleta_motivo ?? null) || info.trim() !== (i.info_acerto ?? "");
  const salvar = useMutation({
    mutationFn: () => salvarInformacaoRemessa(remessaId, i.party_id, i.tem_maleta ? null : (motivo || null), info),
    onSuccess: () => { toast.success(`Salvo: ${i.nome}`); void qc.invalidateQueries({ queryKey: ["remessas", "informacoes", remessaId] }); },
    onError: (e) => toast.error(traduzir(e)),
  });
  return (
    <li className="grid gap-3 p-4 md:grid-cols-[16rem_1fr_auto] md:items-start">
      <div className="min-w-0">
        <p className="font-semibold text-ledger-text">{i.nome}{i.codigo ? <span className="ml-1 text-xs font-normal text-ledger-muted">{i.codigo}</span> : null}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {i.tem_maleta ? <StatusBadge tone="success">Maleta {i.maleta ?? ""}</StatusBadge> : <StatusBadge tone={i.sem_maleta_motivo ? "neutral" : "warning"}>Sem maleta</StatusBadge>}
          {i.debito_vencido_cents > 0 && <StatusBadge tone="danger">Débito vencido {brl(i.debito_vencido_cents)}</StatusBadge>}
        </div>
        {i.atualizado_por_nome && <p className="mt-1 text-xs text-ledger-muted">por {i.atualizado_por_nome}{i.updated_at ? ` em ${new Date(i.updated_at).toLocaleDateString("pt-BR")}` : ""}</p>}
      </div>
      <div className="grid gap-2">
        {!i.tem_maleta && (
          <select className="admin-input" value={motivo} disabled={!podeEditar} onChange={(e) => setMotivo(e.target.value as MotivoSemMaleta | "")} aria-label={`Motivo de ${i.nome} ficar sem maleta`}>
            <option value="">Por que ficou sem maleta?</option>
            {MOTIVOS_SEM_MALETA.map((m) => <option key={m.id} value={m.id}>{m.rotulo}</option>)}
          </select>
        )}
        <textarea className="admin-input min-h-16" maxLength={2000} disabled={!podeEditar} value={info} onChange={(e) => setInfo(e.target.value)}
          placeholder={i.tem_maleta ? "Informações para o acerto (ex.: cobrar parcela atrasada, trocar brinco com defeito, falar sobre nova praça)" : "Observação (ex.: só volta quando quitar o boleto de outubro)"} />
      </div>
      {podeEditar && (
        <button type="button" className="admin-btn admin-btn-primary h-10 px-4 text-xs" disabled={!mudou || salvar.isPending || (motivo === "outro" && !info.trim())} onClick={() => salvar.mutate()}>
          {salvar.isPending ? "Salvando…" : "Salvar"}
        </button>
      )}
    </li>
  );
}
