/**
 * 0281 — Setor de Qualidade → Recebimento de maletas. Toda maleta que volta para a empresa passa aqui:
 * bipa a etiqueta da maleta (ou confirma pela expedição de retorno do representante). Maleta que não
 * ficou com a consultora: as peças voltam ao estoque na hora. Maleta do acerto: segue para a conferência
 * das peças (a mesma do acerto). Nada aqui emite nota fiscal.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PackageCheck, ScanBarcode, Truck, Users, AlertTriangle } from "lucide-react";
import { Panel, EmptyState, ErrorState, StatusBadge, type StatusTone } from "@/components/admin/ui";
import { ConferenciaPreBaixa } from "@/components/admin/maletas/ConferenciaPreBaixa";
import {
  dataHoraBr, marcarNaoVeio, painelRetorno, quemEra, receberMaletaRetorno, ROTULO_ITEM, ROTULO_MOTIVO,
  type ExpedicaoRetorno, type Recebido, type StatusItemRetorno,
} from "@/lib/retorno-maletas";
import { cn } from "@/lib/utils";

const TOM_ITEM: Record<StatusItemRetorno, StatusTone> = { a_caminho: "info", recebida: "success", nao_veio: "danger", retirado: "neutral" };
const CONF: Record<string, string> = {
  aguardando_pagamento: "Conferir peças (Pix ainda não caiu)", aguardando_conferencia: "Conferir peças",
  encerrada: "Acerto encerrado", pendencia: "Acerto com pendência",
};

export function RecebimentoMaletas() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["qualidade", "recebimento"], queryFn: painelRetorno, refetchInterval: 60_000 });
  const [codigo, setCodigo] = React.useState("");
  const [ultimo, setUltimo] = React.useState<Recebido | null>(null);
  const [conferindo, setConferindo] = React.useState<string | null>(null);
  const campo = React.useRef<HTMLInputElement>(null);
  const atualizar = () => { void qc.invalidateQueries({ queryKey: ["qualidade", "recebimento"] }); void qc.invalidateQueries({ queryKey: ["maletas"] }); };

  const receber = useMutation({
    mutationFn: receberMaletaRetorno,
    onSuccess: (r) => {
      setUltimo(r);
      if (r.repetida) toast.info(`Maleta ${r.maleta} já estava recebida.`);
      else if (r.motivo === "nao_ficou") toast.success(`Maleta ${r.maleta} recebida: ${r.pecas} peças voltaram ao estoque.`);
      else toast.success(`Maleta ${r.maleta} recebida. Agora confira as peças do acerto.`);
      if (r.precisa_conferir) setConferindo(r.cycle_id);
      atualizar();
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => { setCodigo(""); campo.current?.focus(); },
  });

  if (q.isLoading) return <p className="px-6 py-8 text-ledger-muted">Carregando o recebimento…</p>;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  const d = q.data!;
  const aCaminho = d.chegando.reduce((n, e) => n + e.itens.filter((i) => i.status === "a_caminho").length, 0);
  const pendentes = d.pendentes.reduce((n, p) => n + p.quantidade, 0);
  const comReps = d.com_representantes.reduce((n, p) => n + p.quantidade, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Numero rotulo="A caminho da empresa" valor={aCaminho} dica="Maletas nas expedições de retorno dos representantes" destaque={aCaminho > 0} />
        <Numero rotulo="Conferir peças" valor={d.conferir.length} dica="Maletas do acerto que já chegaram" destaque={d.conferir.length > 0} />
        <Numero rotulo="Devem voltar e não foram enviadas" valor={pendentes} dica="Acerto fechado ou devolução pedida, sem expedição" alerta={pendentes > 0} />
        <Numero rotulo="Ainda com os representantes" valor={comReps} dica="Saíram da empresa e ainda não foram entregues à consultora" />
      </div>

      {d.pode_receber && (
        <Panel title="Bipar maleta que chegou">
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); const t = codigo.trim(); if (t) receber.mutate({ codigo: t }); }}>
            <label className="flex min-w-[18rem] flex-1 items-center gap-2 rounded-lg border border-line-soft px-3">
              <ScanBarcode aria-hidden className="size-5 text-ledger-muted" />
              <span className="sr-only">Código da maleta</span>
              <input ref={campo} autoFocus value={codigo} onChange={(e) => setCodigo(e.target.value)} disabled={receber.isPending}
                placeholder="Bipe a etiqueta da maleta ou digite o código (ex.: MAL-00454)" className="h-12 flex-1 bg-transparent text-base outline-none" />
            </label>
            <button type="submit" className="admin-btn admin-btn-primary h-12" disabled={!codigo.trim() || receber.isPending}>
              <PackageCheck aria-hidden className="size-4" /> {receber.isPending ? "Confirmando…" : "Confirmar chegada"}
            </button>
          </form>
          <p className="mt-2 text-xs text-ledger-muted">
            Se a maleta chegou sem o representante ter registrado a expedição (no balcão ou pelos Correios), ela é registrada aqui mesmo.
            A nota fiscal de devolução não sai automática: quando a maleta tinha nota de remessa, fica a pendência para a montagem.
          </p>
          {ultimo && (
            <div className={cn("mt-4 rounded-xl border p-4 text-sm", ultimo.motivo === "nao_ficou" ? "border-success/40 bg-success/5" : "border-info/40 bg-info/5")}>
              <p className="font-semibold">Maleta {ultimo.maleta} · {quemEra(ultimo)}{ultimo.remessa && ultimo.consultora ? ` · remessa ${ultimo.remessa}` : ""}</p>
              <p className="text-ledger-muted">
                {ultimo.repetida ? "Já estava recebida. " : ""}
                {ultimo.motivo === "nao_ficou"
                  ? `${ultimo.pecas} peças voltaram ao estoque e a maleta foi encerrada como devolvida.`
                  : `Acerto feito: ${ultimo.pecas} peças devem ter voltado. ${ultimo.precisa_conferir ? "Confira as peças abaixo." : "Conferência já feita."}`}
              </p>
            </div>
          )}
        </Panel>
      )}
      {!d.pode_receber && <p className="rounded-xl border border-line-soft px-4 py-3 text-sm text-ledger-muted">Seu acesso vê o recebimento, mas confirmar a chegada é da montagem ou da Qualidade.</p>}

      {conferindo && d.pode_conferir && (
        <div className="space-y-2">
          <div className="flex justify-end"><button type="button" className="admin-btn" onClick={() => setConferindo(null)}>Fechar conferência</button></div>
          <ConferenciaPreBaixa key={conferindo} cycleId={conferindo} podeConferir />
        </div>
      )}

      <Panel title={`Conferir peças do acerto (${d.conferir.length})`}>
        {d.conferir.length === 0 ? <EmptyState title="Nada para conferir" description="Quando uma maleta do acerto chegar, ela aparece aqui para conferir as peças." /> : (
          <ul className="divide-y divide-line-soft">
            {d.conferir.map((c) => (
              <li key={c.item_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-semibold">{c.maleta} · {quemEra(c)}</p>
                  <p className="text-ledger-muted">{[c.remessa ? `Remessa ${c.remessa}` : null, c.representante, `${c.pecas} peças devem ter voltado`, `chegou ${dataHoraBr(c.recebida_em)}`].filter(Boolean).join(" · ")}</p>
                </div>
                {d.pode_conferir
                  ? <button type="button" className="admin-btn admin-btn-primary" onClick={() => setConferindo(c.cycle_id)}>{CONF[c.conferencia] ?? "Conferir peças"}</button>
                  : <span className="text-xs text-ledger-muted">A conferência das peças é feita pela montagem.</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Expedições de retorno chegando (${d.chegando.length})`}>
        {d.chegando.length === 0 ? <EmptyState title="Nenhuma expedição a caminho" description="Quando o representante despachar maletas de volta pelo app, a lista aparece aqui." /> : (
          <div className="space-y-4">{d.chegando.map((e) => <Expedicao key={e.id} e={e} podeReceber={d.pode_receber} onFeito={atualizar} receber={(item) => receber.mutate({ item })} />)}</div>
        )}
      </Panel>

      <Panel title="Tudo que precisa voltar para a empresa">
        {d.pendentes.length === 0 ? <EmptyState title="Nada pendente" description="Nenhuma maleta com acerto fechado ou devolução pedida fora de expedição." /> : (
          <div className="space-y-4">
            {d.pendentes.map((p) => (
              <div key={p.representante_party_id ?? "sem"} className="rounded-xl border border-line-soft p-4">
                <p className="flex items-center gap-2 font-semibold"><Users aria-hidden className="size-4" /> {p.representante} · {p.quantidade} maleta(s)
                  {p.nao_veio > 0 && <StatusBadge tone="danger">{p.nao_veio} não veio</StatusBadge>}</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {p.maletas.map((m) => (
                    <li key={m.cycle_id} className={cn("flex flex-wrap justify-between gap-2 rounded-md px-2 py-1", m.nao_veio && "bg-danger/5")}>
                      <span><strong>{m.maleta}</strong> · {quemEra(m)}{m.remessa && m.consultora ? ` · remessa ${m.remessa}` : ""}</span>
                      <span className="text-ledger-muted">{ROTULO_MOTIVO[m.motivo]} · {m.pecas} peças · desde {dataHoraBr(m.desde)}{m.nao_veio ? " · não veio na última expedição" : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {d.com_representantes.length > 0 && (
          <div className="mt-4 rounded-xl border border-dashed border-line-soft p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold"><Truck aria-hidden className="size-4" /> Ainda com os representantes (não entregues à consultora)</p>
            <p className="mt-1 text-ledger-muted">Cada uma precisa ser entregue, usada numa abertura ou devolvida para a empresa.</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {d.com_representantes.map((r) => <li key={r.representante_party_id} className="rounded-full border border-line-soft px-3 py-1">{r.representante}: <strong className="tabular-nums">{r.quantidade}</strong></li>)}
            </ul>
          </div>
        )}
      </Panel>

      <Panel title="Recebidas recentemente">
        {d.recebidas.length === 0 ? <EmptyState title="Nenhuma maleta recebida ainda" description="As maletas confirmadas aqui ficam listadas com data e quem eram." /> : (
          <table className="w-full text-sm">
            <thead className="text-left text-ledger-muted"><tr><th className="py-2 pr-3">Maleta</th><th className="py-2 pr-3">De quem</th><th className="py-2 pr-3">Motivo</th><th className="py-2 pr-3">Peças</th><th className="py-2 pr-3">Chegou</th><th className="py-2">Situação</th></tr></thead>
            <tbody>{d.recebidas.map((r) => (
              <tr key={r.item_id} className="border-t border-line-soft">
                <td className="py-2 pr-3 font-semibold">{r.maleta}</td>
                <td className="py-2 pr-3">{quemEra(r)}<span className="block text-xs text-ledger-muted">{[r.remessa ? `Remessa ${r.remessa}` : null, r.representante].filter(Boolean).join(" · ")}</span></td>
                <td className="py-2 pr-3">{ROTULO_MOTIVO[r.motivo]}</td>
                <td className="py-2 pr-3 tabular-nums">{r.pecas}</td>
                <td className="py-2 pr-3 tabular-nums">{dataHoraBr(r.recebida_em)}</td>
                <td className="py-2">{r.motivo === "nao_ficou" ? "Peças no estoque" : CONF[r.conferencia ?? ""] ?? "—"}</td>
              </tr>))}</tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function Expedicao({ e, podeReceber, receber, onFeito }: { e: ExpedicaoRetorno; podeReceber: boolean; receber: (item: string) => void; onFeito: () => void }) {
  const [faltou, setFaltou] = React.useState<string | null>(null);
  const [motivo, setMotivo] = React.useState("");
  const naoVeio = useMutation({
    mutationFn: () => marcarNaoVeio(faltou!, motivo),
    onSuccess: () => { toast.success("Marcada como não veio. Ela volta a ser pendência do representante."); setFaltou(null); setMotivo(""); onFeito(); },
    onError: (err) => toast.error((err as Error).message),
  });
  return (
    <div className="rounded-xl border border-line-soft p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">Expedição de retorno nº {e.numero} · {e.representante ?? "Sem representante"}</p>
        <p className="text-xs text-ledger-muted">Enviada {dataHoraBr(e.enviada_em)}{e.observacao ? ` · ${e.observacao}` : ""}</p>
      </div>
      <ul className="mt-3 divide-y divide-line-soft text-sm">
        {e.itens.map((i) => (
          <li key={i.item_id} className="space-y-2 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span><strong>{i.maleta}</strong> · {quemEra(i)}{i.remessa && i.consultora ? ` · remessa ${i.remessa}` : ""}
                <span className="block text-xs text-ledger-muted">{ROTULO_MOTIVO[i.motivo]} · {i.pecas} peças{i.ocorrencia ? ` · ${i.ocorrencia}` : ""}</span></span>
              <span className="flex items-center gap-2">
                <StatusBadge tone={TOM_ITEM[i.status]}>{ROTULO_ITEM[i.status]}</StatusBadge>
                {podeReceber && i.status === "a_caminho" && (
                  <>
                    <button type="button" className="admin-btn admin-btn-primary" onClick={() => receber(i.item_id)}>Confirmar chegada</button>
                    <button type="button" className="admin-btn" onClick={() => { setFaltou(i.item_id); setMotivo(""); }}>Não veio</button>
                  </>
                )}
              </span>
            </div>
            {faltou === i.item_id && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/40 p-2">
                <AlertTriangle aria-hidden className="size-4 text-danger" />
                <input className="admin-input flex-1" autoFocus value={motivo} onChange={(ev) => setMotivo(ev.target.value)} placeholder="O que aconteceu (ex.: não estava no malote)" />
                <button type="button" className="admin-btn" onClick={() => setFaltou(null)}>Voltar</button>
                <button type="button" className="admin-btn admin-btn-primary" disabled={motivo.trim().length < 5 || naoVeio.isPending} onClick={() => naoVeio.mutate()}>Confirmar que não veio</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Numero({ rotulo, valor, dica, destaque, alerta }: { rotulo: string; valor: number; dica?: string; destaque?: boolean; alerta?: boolean }) {
  return (
    <div className={cn("ledger-panel px-4 py-3.5", destaque && "ring-1 ring-bronze/50", alerta && "ring-1 ring-danger/50")} title={dica}>
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ledger-muted">{rotulo}</p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", alerta && "text-danger")}>{valor.toLocaleString("pt-BR")}</p>
      {dica && <p className="mt-1 text-xs text-ledger-muted">{dica}</p>}
    </div>
  );
}
