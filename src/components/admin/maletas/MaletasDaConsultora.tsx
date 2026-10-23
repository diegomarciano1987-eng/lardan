/**
 * Maletas de uma consultora: as do Lardan (com o motivo quando ela não vê no app),
 * as que estão na rua só pelo SmallData e cadastros repetidos da mesma pessoa.
 * Usado no cockpit da consultora e no cadastro da pessoa. Só leitura.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { EmptyState, ErrorState, Panel, Skeleton, StatusBadge, formatBRLFromCents } from "@/components/admin/ui";
import { maletasDaConsultora } from "@/lib/maletas-visibilidade";
import { PularAcertoSmallData } from "@/components/admin/maletas/PularAcertoSmallData";

const dataBr = (v?: string | null) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "—");
const SITUACAO: Record<string, string> = {
  rascunho: "Rascunho", montagem: "Em montagem", conferida: "Conferida", expedida: "Expedida", transito: "Em trânsito",
  recebida: "Recebida (conferir)", operacao: "Com a consultora", acerto: "Em acerto",
};

export function MaletasDaConsultora({ partyId }: { partyId: string }) {
  const q = useQuery({ queryKey: ["maletas", "consultora", partyId], queryFn: () => maletasDaConsultora(partyId) });
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  const d = q.data!;
  const nada = d.lardan.length === 0 && d.smalldata.length === 0;

  return (
    <div className="space-y-4">
      {!d.pessoa.login_ativo && (
        <p className="flex items-start gap-2 rounded-xl border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-ledger-text">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          {d.pessoa.tem_login ? "O login desta consultora está desativado: ela não vê maleta nenhuma no app." : "Esta consultora não tem login no app: nenhuma maleta aparece para ela."}
        </p>
      )}
      {d.mesma_pessoa.length > 0 && (
        <div className="rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm">
          <p className="flex items-center gap-2 font-semibold text-ledger-text">
            <AlertTriangle aria-hidden className="size-4 text-danger" /> Há outro cadastro que parece ser a mesma pessoa
          </p>
          <p className="mt-1 text-ledger-muted">Se a maleta estiver em um cadastro e o login no outro, ela não aparece no app. Confira e unifique os cadastros.</p>
          <ul className="mt-2 space-y-1">
            {d.mesma_pessoa.map((o) => (
              <li key={o.party_id}>
                <Link to="/admin/cadastros/pessoas/$id" params={{ id: o.party_id }} className="admin-link">{o.nome}{o.codigo ? ` · ${o.codigo}` : ""}</Link>
                <span className="text-ledger-muted"> — {o.motivo} · {o.tem_login ? "tem login" : "sem login"} · {o.maletas_abertas} maleta(s) aberta(s) · {o.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Panel title="Maletas no Lardan" flush>
        {d.lardan.length === 0 ? (
          <p className="px-6 py-4 text-sm text-ledger-muted">Nenhuma maleta aberta no Lardan para este cadastro.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="border-b border-line-soft text-left text-xs uppercase tracking-[0.08em] text-ledger-muted">
                <tr>
                  <th className="px-4 py-2.5">Maleta</th>
                  <th className="px-4 py-2.5">Remessa</th>
                  <th className="px-4 py-2.5">Situação</th>
                  <th className="px-4 py-2.5">Saída · acerto</th>
                  <th className="px-4 py-2.5 text-right">Peças</th>
                  <th className="px-4 py-2.5 text-right">Valor</th>
                  <th className="px-4 py-2.5">No app dela</th>
                </tr>
              </thead>
              <tbody>
                {d.lardan.map((m) => (
                  <tr key={m.cycle_id} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-2.5 font-medium">
                      <Link to="/admin/maletas/$id" params={{ id: m.cycle_id }} className="admin-link">{m.kit}</Link>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{m.remessa ?? "—"}</td>
                    <td className="px-4 py-2.5">{SITUACAO[m.status] ?? m.status}</td>
                    <td className="px-4 py-2.5 tabular-nums">{dataBr(m.saida)} · {dataBr(m.vencimento)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{m.pecas ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{m.valor_cents ? formatBRLFromCents(m.valor_cents) : "—"}</td>
                    <td className="px-4 py-2.5">
                      {m.motivo_invisivel ? (
                        <span className="text-warning">Não aparece: {m.motivo_invisivel}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 aria-hidden className="size-4" /> Aparece</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="No SmallData (ainda sem acerto)" flush>
        {d.smalldata.length === 0 ? (
          <p className="px-6 py-4 text-sm text-ledger-muted">
            {d.pessoa.codigos_smalldata.length ? "Nenhuma maleta do SmallData sem acerto." : "Este cadastro não está ligado a nenhuma consultora do SmallData."}
          </p>
        ) : (
          <>
            <p className="px-6 pt-4 text-sm text-ledger-muted">
              Estas maletas saíram pelo sistema antigo e só existem no histórico: a consultora não as vê no app do Lardan até a carga das maletas na rua.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[58rem] text-sm">
                <thead className="border-b border-line-soft text-left text-xs uppercase tracking-[0.08em] text-ledger-muted">
                  <tr>
                    <th className="px-4 py-2.5">Remessa</th>
                    <th className="px-4 py-2.5">Situação</th>
                    <th className="px-4 py-2.5">Praça · representante</th>
                    <th className="px-4 py-2.5">Saída · vencimento</th>
                    <th className="px-4 py-2.5 text-right">Peças</th>
                    <th className="px-4 py-2.5 text-right">Valor enviado</th>
                    <th className="px-4 py-2.5 text-right">Dias na rua</th>
                    <th className="px-4 py-2.5">NF remessa</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {d.smalldata.map((m) => (
                    <tr key={`${m.remessa}-${m.kit}`} className="border-b border-line-soft last:border-0">
                      <td className="px-4 py-2.5 font-medium tabular-nums">{m.remessa}{m.kit > 1 ? ` · kit ${m.kit}` : ""}</td>
                      <td className="px-4 py-2.5">
                        {m.situacao ?? (m.situacao_codigo != null ? `Situação ${m.situacao_codigo}` : "—")}
                        {m.na_rua === false && <span className="text-ledger-muted"> · fora da rua</span>}
                      </td>
                      <td className="px-4 py-2.5 text-ledger-muted">{[m.praca, m.representante].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {dataBr(m.emissao)} · {dataBr(m.vencimento)} {m.atrasada && <StatusBadge tone="danger">vencida</StatusBadge>}
                        {m.vencimento_original && m.vencimento_original !== m.vencimento && (
                          <span className="block text-xs text-ledger-muted">acerto pulado (era {dataBr(m.vencimento_original)})</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{m.pecas}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatBRLFromCents(m.valor_enviado_cents)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{m.dias_na_rua ?? "—"}</td>
                      <td className="px-4 py-2.5 tabular-nums">{m.nf_remessa ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        {m.codcli != null && <PularAcertoSmallData remessa={m.remessa} codcli={m.codcli} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
      {nada && d.mesma_pessoa.length === 0 && (
        <EmptyState title="Nenhuma maleta aberta" description="Nem no Lardan nem no SmallData há maleta sem acerto para este cadastro." />
      )}
    </div>
  );
}
