/**
 * Portal do representante → Maletas (0130).
 * Maletas da remessa que saíram com ele (sem consultora): confirma o recebimento e passa
 * para uma consultora ou candidata da carteira dele. A candidata vira consultora; a maleta
 * segue o fluxo normal (ela confirma a entrega, aceita e assina o termo).
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  brl,
  dataBr,
  destinatariasDoRepresentante,
  entregarEmMaos,
  maletasDoRepresentante,
  mensagem,
  receberMaleta,
  repassarMaleta,
  trocarDestinoMaleta,
  type Destinataria,
} from "@/lib/maletas-perdidas";

export function MaletasRepresentante({ rep, onRepasse }: { rep: string; onRepasse?: (r: { partyId: string; nome: string; nova: boolean }) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["rep", rep, "maletas"], queryFn: () => maletasDoRepresentante(rep) });
  const recarregar = () => void qc.invalidateQueries({ queryKey: ["rep", rep, "maletas"] });
  const [trocando, setTrocando] = React.useState<string | null>(null);
  const receber = useMutation({
    mutationFn: (transfer: string) => receberMaleta(transfer),
    onSuccess: () => {
      toast.success("Recebimento confirmado.");
      recarregar();
    },
    onError: (e) => toast.error(mensagem(e)),
  });
  const receberTodas = useMutation({
    mutationFn: async (ids: string[]) => {
      let ok = 0;
      for (const id of ids) { await receberMaleta(id); ok += 1; }
      return ok;
    },
    onSuccess: (n) => { toast.success(`${n} maletas confirmadas com você.`); recarregar(); },
    onError: (e) => { toast.error(mensagem(e)); recarregar(); },
  });
  const entregar = useMutation({
    mutationFn: (cycle: string) => entregarEmMaos(cycle),
    onSuccess: () => { toast.success("Entrega registrada. Agora a consultora confirma que recebeu e confere as peças no app dela."); recarregar(); },
    onError: (e) => toast.error(mensagem(e)),
  });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando maletas…</p>;
  if (q.error) return <p className="text-sm text-destructive">{mensagem(q.error)}</p>;
  const d = q.data!;
  const paraEntregar = d.para_entregar ?? [];
  const vazio = d.a_receber.length + d.sem_consultora.length + d.a_caminho.length + paraEntregar.length === 0;

  return (
    <div className="space-y-6">
      {vazio && (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhuma maleta com você agora. Quando a empresa enviar uma maleta da remessa para você, ela aparece aqui.
        </p>
      )}

      {d.a_receber.length > 0 && (
        <section className="space-y-3">
          <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
            <h3 className="text-base font-semibold">A empresa enviou {d.a_receber.length} {d.a_receber.length === 1 ? "maleta" : "maletas"} para você</h3>
            <p className="mt-1 text-sm text-muted-foreground">Confira se estão todas no carro e confirme. Depois disso elas ficam com você até entregar em mãos a cada consultora.</p>
            {d.a_receber.length > 1 && (
              <button className="mt-3 h-12 w-full rounded-lg bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-50"
                disabled={receberTodas.isPending || receber.isPending}
                onClick={() => receberTodas.mutate(d.a_receber.map((m) => m.transfer_id))}>
                {receberTodas.isPending ? "Confirmando…" : `Recebi todas as ${d.a_receber.length} maletas`}
              </button>
            )}
          </div>
          {d.a_receber.map((m) => (
            <div key={m.transfer_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
              <div>
                <p className="font-medium">{m.consultora ?? (m.abertura_numero ? `Abertura ${m.abertura_numero}` : "Sem consultora (abertura)")}{m.consultora_codigo ? <span className="text-muted-foreground"> · cód. {m.consultora_codigo}</span> : null}</p>
                <p className="text-xs text-muted-foreground">Maleta {m.maleta}{m.remessa ? ` · remessa ${m.remessa}` : ""} · {m.pecas} peças · {brl(m.valor_cents)}</p>
              </div>
              <button className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                disabled={receber.isPending} onClick={() => receber.mutate(m.transfer_id)}>Confirmar que recebi</button>
            </div>
          ))}
        </section>
      )}

      {paraEntregar.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-base font-semibold">Para entregar em mãos ({paraEntregar.length})</h3>
          <p className="text-sm text-muted-foreground">As peças já aparecem na vitrine de cada consultora para ela divulgar. Ela só vende depois que você entregar e ela confirmar que recebeu no app dela.</p>
          {paraEntregar.map((m) => (
            <div key={m.cycle_id} className="space-y-3 rounded-xl border border-border bg-card p-4">
              <div>
                <p className="font-medium">{m.consultora}{m.consultora_codigo ? <span className="text-muted-foreground"> · cód. {m.consultora_codigo}</span> : null}</p>
                <p className="text-xs text-muted-foreground">{[m.cidade, `Maleta ${m.maleta}`, m.remessa ? `remessa ${m.remessa}` : null, `${m.pecas} peças`, brl(m.valor_cents)].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {m.telefone && (
                  <a className="inline-flex h-11 items-center rounded-lg border border-border px-4 text-sm font-medium"
                    href={`https://wa.me/55${m.telefone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "")}`} target="_blank" rel="noreferrer">WhatsApp</a>
                )}
                <button className="h-11 flex-1 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  disabled={entregar.isPending}
                  onClick={() => { if (window.confirm(`Confirmar que entregou a maleta em mãos para ${m.consultora}?`)) entregar.mutate(m.cycle_id); }}>
                  {entregar.isPending && entregar.variables === m.cycle_id ? "Registrando…" : "Entreguei em mãos"}
                </button>
              </div>
              {/* 0273: ele pode deixar esta maleta para uma abertura (outra consultora/candidata) */}
              {trocando === m.cycle_id ? (
                <div className="space-y-2 rounded-lg border border-dashed border-primary/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Usar esta maleta para outra pessoa</p>
                    <button className="h-9 rounded-lg border border-border px-3 text-sm" onClick={() => setTrocando(null)}>Cancelar</button>
                  </div>
                  <p className="text-xs text-muted-foreground">{m.consultora} fica sem esta maleta. Escolha a candidata da abertura (ou outra consultora da sua carteira).</p>
                  <Repasse rep={rep} trocarDe={m.consultora}
                    maleta={{ cycle_id: m.cycle_id, maleta: m.maleta, remessa: m.remessa, praca: null, pecas: m.pecas, valor_cents: m.valor_cents, acerto: null }}
                    onFeito={(r) => { setTrocando(null); recarregar(); if (r) onRepasse?.(r); }} />
                </div>
              ) : (
                <button className="h-10 w-full rounded-lg border border-dashed border-border px-4 text-sm text-muted-foreground"
                  onClick={() => setTrocando(m.cycle_id)}>Não vai ficar com ela? Usar para abertura</button>
              )}
            </div>
          ))}
        </section>
      )}

      {d.sem_consultora.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Com você, sem consultora ({d.sem_consultora.length})</h3>
          {d.sem_consultora.map((m) => (
            <Repasse key={m.cycle_id} rep={rep} maleta={m} onFeito={(r) => { recarregar(); if (r) onRepasse?.(r); }} />
          ))}
        </section>
      )}

      {d.a_caminho.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Entregues por você, aguardando a consultora confirmar</h3>
          {d.a_caminho.map((m) => (
            <div key={m.cycle_id} className="rounded-xl border border-border bg-card p-4 text-sm">
              Maleta {m.maleta}{m.remessa ? ` · remessa ${m.remessa}` : ""} → <span className="font-medium">{m.consultora}</span> · {m.pecas} peças
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Repasse({ rep, maleta, onFeito, trocarDe }: {
  rep: string;
  maleta: { cycle_id: string; maleta: string; remessa: number | null; praca: string | null; pecas: number; valor_cents: number; acerto: string | null };
  onFeito: (r?: { partyId: string; nome: string; nova: boolean }) => void;
  /** 0273: maleta designada a esta consultora, ainda com o representante → troca de destino. */
  trocarDe?: string;
}) {
  const [busca, setBusca] = React.useState("");
  const [escolhida, setEscolhida] = React.useState<Destinataria | null>(null);
  const opcoes = useQuery({
    queryKey: ["rep", rep, "destinatarias", busca],
    queryFn: () => destinatariasDoRepresentante(rep, busca),
    enabled: busca.trim().length >= 2,
  });
  const passar = useMutation({
    mutationFn: () => (trocarDe ? trocarDestinoMaleta : repassarMaleta)(rep, maleta.cycle_id, escolhida!),
    onSuccess: (r) => {
      toast.success(r.nova_consultora ? "Maleta enviada. A candidata agora é sua consultora." : "Maleta enviada para a consultora.");
      onFeito({ partyId: r.consultora_party_id, nome: escolhida?.nome ?? "", nova: r.nova_consultora });
    },
    onError: (e) => toast.error(mensagem(e)),
  });

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div>
        <p className="font-medium">Maleta {maleta.maleta}{maleta.remessa ? ` · remessa ${maleta.remessa}` : ""}{maleta.praca ? ` · ${maleta.praca}` : ""}</p>
        <p className="text-xs text-muted-foreground">{maleta.pecas} peças · {brl(maleta.valor_cents)} · acerto {dataBr(maleta.acerto)}</p>
      </div>
      {escolhida ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Passar para <strong>{escolhida.nome}</strong> ({escolhida.tipo === "candidata" ? "candidata — vira sua consultora" : "consultora"})</span>
          <button className="h-9 rounded-lg border border-border px-3" onClick={() => setEscolhida(null)}>Trocar</button>
          <button className="h-9 rounded-lg bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50"
            disabled={passar.isPending}
            onClick={() => { if (trocarDe && !window.confirm(`${trocarDe} vai ficar sem a maleta ${maleta.maleta} e ${escolhida.nome} recebe no lugar. Confirmar?`)) return; passar.mutate(); }}>
            {passar.isPending ? "Enviando…" : "Confirmar e enviar"}</button>
        </div>
      ) : (
        <div className="space-y-2">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar consultora ou candidata da sua carteira"
            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" />
          {busca.trim().length >= 2 && (
            <div className="max-h-64 overflow-auto rounded-lg border border-border">
              {opcoes.isLoading && <p className="p-3 text-xs text-muted-foreground">Buscando…</p>}
              {opcoes.data?.length === 0 && <p className="p-3 text-xs text-muted-foreground">Ninguém da sua carteira com esse nome.</p>}
              {opcoes.data?.map((o) => (
                <button key={`${o.tipo}-${o.id}`} onClick={() => setEscolhida(o)}
                  className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-muted">
                  <span>{o.nome}{o.cidade ? <span className="text-muted-foreground"> · {o.cidade}</span> : null}</span>
                  <span className="text-xs text-muted-foreground">{o.tipo === "candidata" ? "Candidata" : `Consultora ${o.codigo ?? ""}`}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
