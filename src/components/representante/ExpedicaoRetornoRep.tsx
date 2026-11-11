/**
 * 0281 — app do representante → Maletas: expedição de retorno. A volta faz o mesmo caminho da ida:
 * depois do acerto a consultora entrega a maleta para ele e ele despacha para a empresa; maleta que não
 * ficou com ninguém também volta por aqui. Tudo que estava com ele precisa voltar de alguma forma:
 * a lista mostra o que falta. Na empresa, a Qualidade confirma a chegada de cada maleta.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  dataHoraBr, expedirRetorno, pendentesDoRepresentante, quemEra, retirarDaExpedicao, ROTULO_ITEM, ROTULO_MOTIVO,
  type ExpedicaoRetorno,
} from "@/lib/retorno-maletas";

export function ExpedicaoRetornoRep({ rep }: { rep: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["rep", rep, "retorno"], queryFn: () => pendentesDoRepresentante(rep) });
  const [marcadas, setMarcadas] = React.useState<Set<string>>(new Set());
  const [extras, setExtras] = React.useState<Set<string>>(new Set());
  const [motivo, setMotivo] = React.useState("");
  const [obs, setObs] = React.useState("");
  const iniciou = React.useRef(false);
  React.useEffect(() => {
    if (q.data && !iniciou.current) { iniciou.current = true; setMarcadas(new Set(q.data.a_devolver.map((m) => m.cycle_id))); }
  }, [q.data]);

  const enviar = useMutation({
    mutationFn: () => expedirRetorno(rep, [...marcadas, ...extras], obs.trim() || null, extras.size ? motivo.trim() : null),
    onSuccess: (e) => {
      toast.success(`Expedição de retorno nº ${e.numero} registrada com ${e.itens.length} ${e.itens.length === 1 ? "maleta" : "maletas"}. Leve para a empresa: lá a Qualidade confirma a chegada.`);
      setMarcadas(new Set()); setExtras(new Set()); setMotivo(""); setObs(""); iniciou.current = false;
      void qc.invalidateQueries({ queryKey: ["rep", rep] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (q.isLoading) return null;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  const d = q.data!;
  const aCaminho = d.expedicoes.reduce((n, e) => n + e.itens.filter((i) => i.status === "a_caminho").length, 0);
  const total = marcadas.size + extras.size;
  const alterna = (set: Set<string>, setar: (s: Set<string>) => void, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); setar(n); };
  const nada = d.a_devolver.length + d.com_voce.length + d.expedicoes.length === 0 && d.com_consultoras === 0;
  if (nada) return null;

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
      <div>
        <h3 className="text-base font-semibold">Devolver para a empresa (expedição de retorno)</h3>
        <p className="mt-1 text-sm text-muted-foreground">A volta faz o mesmo caminho da ida: no acerto a consultora entrega a maleta para você e você manda para a empresa. Tudo que saiu com você precisa voltar de alguma forma.</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <Conta rotulo="Para devolver agora" valor={d.a_devolver.length} forte={d.a_devolver.length > 0} />
        <Conta rotulo="A caminho da empresa" valor={aCaminho} />
        <Conta rotulo="Com você, sem entregar" valor={d.com_voce.length} />
        <Conta rotulo="Com as consultoras" valor={d.com_consultoras} dica="voltam no acerto" />
      </div>

      {d.a_devolver.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Marque as maletas que estão com você e vão para a empresa</p>
          {d.a_devolver.map((m) => (
            <label key={m.cycle_id} className={`flex items-start gap-3 rounded-xl border p-3 ${m.nao_veio ? "border-destructive/50 bg-destructive/5" : "border-border"}`}>
              <input type="checkbox" className="mt-1 size-5" checked={marcadas.has(m.cycle_id)} onChange={() => alterna(marcadas, setMarcadas, m.cycle_id)} />
              <span className="text-sm">
                <span className="font-medium">{quemEra(m)}</span>
                <span className="block text-xs text-muted-foreground">Maleta {m.maleta}{m.remessa && m.consultora ? ` · remessa ${m.remessa}` : ""} · {ROTULO_MOTIVO[m.motivo]} · {m.pecas} peças</span>
                {m.nao_veio && <span className="block text-xs text-destructive">A empresa não recebeu esta maleta na última expedição.</span>}
              </span>
            </label>
          ))}
        </div>
      )}

      {d.com_voce.length > 0 && (
        <details className="rounded-xl border border-dashed border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Ainda com você e não entregues ({d.com_voce.length}) — mandar alguma de volta?</summary>
          <p className="mt-2 text-xs text-muted-foreground">Entregue à consultora, use numa abertura ou mande de volta. Marcando aqui, a entrega para ela é cancelada e a maleta volta para a empresa.</p>
          <div className="mt-2 space-y-2">
            {d.com_voce.map((m) => (
              <label key={m.cycle_id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                <input type="checkbox" className="mt-1 size-5" checked={extras.has(m.cycle_id)} onChange={() => alterna(extras, setExtras, m.cycle_id)} />
                <span className="text-sm"><span className="font-medium">{quemEra(m)}</span>
                  <span className="block text-xs text-muted-foreground">Maleta {m.maleta}{m.remessa && m.consultora ? ` · remessa ${m.remessa}` : ""} · {m.pecas} peças</span></span>
              </label>
            ))}
          </div>
          {extras.size > 0 && (
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Por que essas maletas voltam (ex.: consultora não quis ficar)"
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          )}
        </details>
      )}

      {(d.a_devolver.length > 0 || d.com_voce.length > 0) && (
        <div className="space-y-2">
          <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (ex.: levo na segunda, vai pelo ônibus)"
            className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm" />
          <button className="h-12 w-full rounded-lg bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-50"
            disabled={total === 0 || (extras.size > 0 && motivo.trim().length < 5) || enviar.isPending}
            onClick={() => { if (window.confirm(`Registrar a expedição de retorno com ${total} ${total === 1 ? "maleta" : "maletas"}?`)) enviar.mutate(); }}>
            {enviar.isPending ? "Registrando…" : total === 0 ? "Marque as maletas que vão voltar" : `Enviar ${total} ${total === 1 ? "maleta" : "maletas"} para a empresa`}
          </button>
        </div>
      )}

      {d.expedicoes.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Suas expedições de retorno</p>
          {d.expedicoes.map((e) => <Expedicao key={e.id} e={e} rep={rep} />)}
        </div>
      )}
    </section>
  );
}

const ROTULO_EXP: Record<ExpedicaoRetorno["status"], string> = { enviada: "A caminho", recebida: "Recebida pela empresa", com_falta: "Recebida com falta", cancelada: "Cancelada" };

function Expedicao({ e, rep }: { e: ExpedicaoRetorno; rep: string }) {
  const qc = useQueryClient();
  const [tirando, setTirando] = React.useState<string | null>(null);
  const [motivo, setMotivo] = React.useState("");
  const tirar = useMutation({
    mutationFn: () => retirarDaExpedicao(tirando!, motivo),
    onSuccess: () => { toast.success("Maleta tirada da expedição."); setTirando(null); setMotivo(""); void qc.invalidateQueries({ queryKey: ["rep", rep] }); },
    onError: (err) => toast.error((err as Error).message),
  });
  return (
    <div className="rounded-xl border border-border p-3 text-sm">
      <p className="flex flex-wrap justify-between gap-2"><span className="font-semibold">Nº {e.numero} · {ROTULO_EXP[e.status]}</span><span className="text-xs text-muted-foreground">{dataHoraBr(e.enviada_em)}</span></p>
      <ul className="mt-2 space-y-2">
        {e.itens.map((i) => (
          <li key={i.item_id} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{quemEra(i)} <span className="text-xs text-muted-foreground">· {i.maleta}</span></span>
              <span className={`text-xs font-medium ${i.status === "recebida" ? "text-success" : i.status === "nao_veio" ? "text-destructive" : "text-muted-foreground"}`}>{ROTULO_ITEM[i.status]}</span>
            </div>
            {i.status === "a_caminho" && tirando !== i.item_id && (
              <button className="h-9 rounded-lg border border-border px-3 text-xs" onClick={() => { setTirando(i.item_id); setMotivo(""); }}>Tirar da expedição</button>
            )}
            {tirando === i.item_id && (
              <div className="flex gap-2">
                <input value={motivo} onChange={(ev) => setMotivo(ev.target.value)} placeholder="Motivo" className="h-9 flex-1 rounded-lg border border-border bg-background px-2 text-sm" />
                <button className="h-9 rounded-lg border border-border px-3 text-xs" onClick={() => setTirando(null)}>Voltar</button>
                <button className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50" disabled={motivo.trim().length < 5 || tirar.isPending} onClick={() => tirar.mutate()}>Tirar</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Conta({ rotulo, valor, forte, dica }: { rotulo: string; valor: number; forte?: boolean; dica?: string }) {
  return (
    <div className={`rounded-xl border p-3 ${forte ? "border-primary/50 bg-primary/5" : "border-border"}`}>
      <p className="text-xs text-muted-foreground">{rotulo}{dica ? ` (${dica})` : ""}</p>
      <p className="text-xl font-semibold tabular-nums">{valor}</p>
    </div>
  );
}
