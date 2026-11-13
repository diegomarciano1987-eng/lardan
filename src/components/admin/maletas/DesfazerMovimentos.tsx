/**
 * 0315 — lugar para desfazer movimento errado de maleta (troca de consultora, troca para abertura,
 * repasse do representante). Lista os movimentos, mostra a prévia do banco e só desfaz com motivo.
 * Nada é apagado: o desfazer vira um movimento de volta no histórico da maleta.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { CircleAlert, History, Search, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { maletaDesfazerMovimento } from "@/lib/maletas-desfazer.functions";
import { traduzir } from "@/lib/maletas";

export interface MovimentoMaleta {
  evento_id: string; cycle_id: string; maleta: string; remessa: number | null; kind: string; quando: string;
  origem: string; de: string | null; de_codigo: string | null; para: string | null; para_codigo: string | null;
  quem: string | null; motivo: string | null; situacao: string; com_quem_esta: string | null;
  aceita: boolean; ultimo: boolean; desfeito_em: string | null; desfeito_motivo: string | null; desfeito_por: string | null;
}
interface Previa { pode: boolean; bloqueio: string | null; passos: string[]; maleta: string; de: string | null; para: string; aceita: boolean }

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const pessoa = (nome: string | null, cod: string | null) => (nome ? (cod ? `${nome} (${cod})` : nome) : "—");
const TIPO: Record<string, string> = {
  "maleta.transferida": "Troca de consultora",
  "maleta.trocada_para_abertura": "Troca pelo representante",
  "maleta.repassada": "Repasse da abertura",
};

export function DesfazerMovimentos({ rep, compacto }: { rep?: string | undefined; compacto?: boolean }) {
  const [busca, setBusca] = React.useState("");
  const [termo, setTermo] = React.useState("");
  const [aberto, setAberto] = React.useState<MovimentoMaleta | null>(null);
  React.useEffect(() => { const t = setTimeout(() => setTermo(busca.trim()), 300); return () => clearTimeout(t); }, [busca]);
  const q = useQuery({
    queryKey: ["maletas", "movimentos", rep ?? "equipe", termo],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("maleta_movimentos_lista" as never, { _busca: termo || null, _rep: rep ?? null, _limite: 100 } as never);
      if (error) throw error;
      return (data ?? []) as unknown as MovimentoMaleta[];
    },
  });
  const linhas = q.data ?? [];

  return (
    <div className="space-y-4">
      <label className="relative block">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por maleta (MAL-00459), nome ou código da consultora, número da remessa"
          aria-label="Buscar movimento de maleta"
          className="h-11 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </label>
      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando movimentos…</p>}
      {q.isError && <p className="text-sm text-destructive">{traduzir(q.error)}</p>}
      {q.isSuccess && linhas.length === 0 && (
        <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
          {termo ? `Nenhum movimento encontrado para “${termo}” nos últimos 120 dias.` : "Nenhum movimento de maleta nos últimos 120 dias."}
        </p>
      )}
      <ul className="space-y-3">
        {linhas.map((m) => (
          <li key={m.evento_id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold">
                  {rep ? m.maleta : <Link to="/admin/maletas/$id" params={{ id: m.cycle_id }} className="admin-link">{m.maleta}</Link>}
                  {m.remessa != null && <span className="ml-2 font-normal text-muted-foreground">Remessa {m.remessa}</span>}
                  <span className="ml-2 font-normal text-muted-foreground">· {TIPO[m.kind] ?? m.kind}</span>
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">De</span> <strong>{pessoa(m.de, m.de_codigo)}</strong>{" "}
                  <span className="text-muted-foreground">para</span> <strong>{pessoa(m.para, m.para_codigo)}</strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  {quando(m.quando)} · feito por {m.quem ?? (m.origem === "representante" ? "representante" : "equipe")}
                  {m.motivo ? ` · “${m.motivo}”` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Hoje está com {m.com_quem_esta ?? "ninguém (abertura)"} · {m.aceita ? "aceita no app" : "ainda sem aceite"}
                </p>
                {m.desfeito_em && (
                  <p className="text-xs font-medium text-success">
                    Desfeito em {quando(m.desfeito_em)}{m.desfeito_por ? ` por ${m.desfeito_por}` : ""} · “{m.desfeito_motivo}”
                  </p>
                )}
              </div>
              {!m.desfeito_em && m.ultimo && (
                <button type="button" className="admin-btn" onClick={() => setAberto(m)}>
                  <Undo2 aria-hidden className="size-4" /> Desfazer
                </button>
              )}
              {!m.desfeito_em && !m.ultimo && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><History aria-hidden className="size-3.5" /> Houve movimento depois deste</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!compacto && linhas.length >= 100 && <p className="text-xs text-muted-foreground">Mostrando os 100 mais recentes. Use a busca para achar um movimento mais antigo.</p>}
      {aberto && <DialogoDesfazer mov={aberto} rep={rep} onFechar={() => setAberto(null)} />}
    </div>
  );
}

function DialogoDesfazer({ mov, rep, onFechar }: { mov: MovimentoMaleta; rep?: string | undefined; onFechar: () => void }) {
  const qc = useQueryClient();
  const desfazerFn = useServerFn(maletaDesfazerMovimento);
  const [motivo, setMotivo] = React.useState("");
  const previa = useQuery({
    queryKey: ["maletas", "movimento-previa", mov.evento_id, rep ?? "equipe"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("maleta_movimento_previa" as never, { _evento: mov.evento_id, _rep: rep ?? null } as never);
      if (error) throw error;
      return data as unknown as Previa;
    },
  });
  const desfazer = useMutation({
    mutationFn: () => desfazerFn({ data: { eventoId: mov.evento_id, cycleId: mov.cycle_id, motivo, rep: rep ?? null } }),
    onSuccess: (r) => {
      const extra = [
        r.aceite_desfeito ? "o aceite errado foi desfeito" : null,
        r.carteira_voltou ? "a carteira da consultora voltou ao que era" : null,
        r.promissoria.nova === "enviada" ? "promissória nova enviada" : null,
        r.promissoria.nova === "falhou" ? `promissória não foi enviada: ${r.promissoria.aviso ?? "tente pela ficha"}` : null,
      ].filter(Boolean).join("; ");
      toast.success(`Desfeito: ${r.maleta ?? "maleta"} voltou para ${r.para ?? "a abertura"}.${extra ? ` ${extra}.` : ""}`);
      void qc.invalidateQueries({ queryKey: ["maletas"] });
      void qc.invalidateQueries({ queryKey: ["rep"] });
      onFechar();
    },
    onError: (e) => toast.error(traduzir(e)),
  });
  const p = previa.data;
  const motivoOk = motivo.trim().length >= 10;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Desfazer movimento da {mov.maleta}</DialogTitle>
          <DialogDescription>Confira o que vai acontecer. Nada é apagado: fica no histórico com o seu nome e o motivo.</DialogDescription>
        </DialogHeader>
        {previa.isLoading && <p className="text-sm text-muted-foreground">Conferindo a maleta…</p>}
        {previa.isError && <p className="text-sm text-destructive">{traduzir(previa.error)}</p>}
        {p && (
          <div className="space-y-4">
            {p.bloqueio ? (
              <p className="flex gap-2 rounded-xl border border-warning p-3 text-sm"><CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />{p.bloqueio}</p>
            ) : (
              <ol className="list-decimal space-y-1.5 pl-5 text-sm">
                {p.passos.map((s) => <li key={s}>{s}</li>)}
              </ol>
            )}
            {p.pode && (
              <>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Por que está desfazendo?</span>
                  <textarea
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder="Ex.: passei a maleta para a consultora errada"
                    className="w-full rounded-xl border border-border bg-background p-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <span className="text-xs text-muted-foreground">Mínimo 10 letras.</span>
                </label>
                <div className="flex justify-end gap-2">
                  <button type="button" className="admin-btn" onClick={onFechar}>Cancelar</button>
                  <button type="button" className="admin-btn-primary inline-flex items-center gap-2" disabled={!motivoOk || desfazer.isPending} onClick={() => desfazer.mutate()}>
                    <Undo2 aria-hidden className="size-4" /> {desfazer.isPending ? "Desfazendo…" : "Desfazer movimento"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
