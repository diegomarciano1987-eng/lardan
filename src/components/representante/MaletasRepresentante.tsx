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
  maletasDoRepresentante,
  mensagem,
  receberMaleta,
  repassarMaleta,
  type Destinataria,
} from "@/lib/maletas-perdidas";

export function MaletasRepresentante({ rep }: { rep: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["rep", rep, "maletas"], queryFn: () => maletasDoRepresentante(rep) });
  const recarregar = () => void qc.invalidateQueries({ queryKey: ["rep", rep, "maletas"] });
  const receber = useMutation({
    mutationFn: (transfer: string) => receberMaleta(transfer),
    onSuccess: () => {
      toast.success("Recebimento confirmado.");
      recarregar();
    },
    onError: (e) => toast.error(mensagem(e)),
  });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando maletas…</p>;
  if (q.error) return <p className="text-sm text-destructive">{mensagem(q.error)}</p>;
  const d = q.data!;
  const vazio = d.a_receber.length + d.sem_consultora.length + d.a_caminho.length === 0;

  return (
    <div className="space-y-6">
      {vazio && (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhuma maleta com você agora. Quando a empresa enviar uma maleta da remessa para você, ela aparece aqui.
        </p>
      )}

      {d.a_receber.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">A caminho de você</h3>
          {d.a_receber.map((m) => (
            <div key={m.transfer_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
              <div>
                <p className="font-medium">Maleta {m.maleta}{m.remessa ? ` · remessa ${m.remessa}` : ""}</p>
                <p className="text-xs text-muted-foreground">{m.pecas} peças · {brl(m.valor_cents)}{m.consultora ? ` · para ${m.consultora}` : " · sem consultora"}</p>
              </div>
              <button className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                disabled={receber.isPending} onClick={() => receber.mutate(m.transfer_id)}>Confirmar que recebi</button>
            </div>
          ))}
        </section>
      )}

      {d.sem_consultora.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Com você, sem consultora ({d.sem_consultora.length})</h3>
          {d.sem_consultora.map((m) => (
            <Repasse key={m.cycle_id} rep={rep} maleta={m} onFeito={recarregar} />
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

function Repasse({ rep, maleta, onFeito }: {
  rep: string;
  maleta: { cycle_id: string; maleta: string; remessa: number | null; praca: string | null; pecas: number; valor_cents: number; acerto: string | null };
  onFeito: () => void;
}) {
  const [busca, setBusca] = React.useState("");
  const [escolhida, setEscolhida] = React.useState<Destinataria | null>(null);
  const opcoes = useQuery({
    queryKey: ["rep", rep, "destinatarias", busca],
    queryFn: () => destinatariasDoRepresentante(rep, busca),
    enabled: busca.trim().length >= 2,
  });
  const passar = useMutation({
    mutationFn: () => repassarMaleta(rep, maleta.cycle_id, escolhida!),
    onSuccess: (r) => {
      toast.success(r.nova_consultora ? "Maleta enviada. A candidata agora é sua consultora." : "Maleta enviada para a consultora.");
      onFeito();
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
            disabled={passar.isPending} onClick={() => passar.mutate()}>{passar.isPending ? "Enviando…" : "Confirmar e enviar"}</button>
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
