import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Percent, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/maletas";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Ganhos = {
  maleta: boolean; configurado: boolean; vendido_cents?: number; pecas_vendidas?: number; pecas_total?: number;
  acerto?: string | null; hoje?: string; faixa?: { titulo: string; percentual: number } | null; comissao_cents?: number;
  repasse_cents?: number | null; proxima?: { titulo: string; percentual: number; falta_cents: number; min_cents: number } | null;
};
type Linha = { min_cents: number; percentual: number; titulo: string };

const dias = (de: string, ate: string) => Math.round((new Date(ate + "T12:00:00").getTime() - new Date(de + "T12:00:00").getTime()) / 86400000);
const dataBR = (s: string) => new Date(s + "T12:00:00").toLocaleDateString("pt-BR");

export function TabelaComissao({ aberta, fechar }: { aberta: boolean; fechar: () => void }) {
  const q = useQuery({ queryKey: ["consultora", "comissao-tabela"], enabled: aberta, queryFn: async () => {
    const { data, error } = await supabase.rpc("consultora_comissao_tabela" as never); if (error) throw error; return data as unknown as Linha[];
  } });
  return (
    <Dialog open={aberta} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-3xl">Minha comissão</DialogTitle>
          <DialogDescription className="text-[1.02rem]">Percentual sobre as peças vendidas e pagas da sua maleta, pelo total vendido no ciclo.</DialogDescription>
        </DialogHeader>
        {q.isLoading && <p className="text-base">Carregando…</p>}
        {q.data?.length === 0 && <p className="text-base">A LARDAN ainda não configurou a tabela de comissão.</p>}
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {q.data?.map((l) => (
            <li key={l.min_cents} className="flex items-center justify-between gap-3 p-4 text-[1.05rem]">
              <span><strong>{l.titulo || "Faixa"}</strong><span className="block text-[0.95rem] text-muted-foreground">vendendo a partir de {brl(l.min_cents)}</span></span>
              <strong className="num text-xl">{Number(l.percentual).toLocaleString("pt-BR")}%</strong>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** Card "Quanto eu ganho" + barra de meta + contagem do acerto (estimativa; acerto oficial é do financeiro). */
export function GanhosConsultora() {
  const [tabela, setTabela] = React.useState(false);
  const q = useQuery({ queryKey: ["consultora", "ganhos"], queryFn: async () => {
    const { data, error } = await supabase.rpc("consultora_ganhos" as never); if (error) throw error; return data as unknown as Ganhos;
  } });
  const g = q.data;
  if (!g || !g.maleta) return null;
  const vendido = g.vendido_cents ?? 0;
  const alvo = g.proxima?.min_cents ?? null;
  const progresso = alvo ? Math.min(100, Math.round((vendido / alvo) * 100)) : 100;
  const pctPecas = g.pecas_total ? Math.round(((g.pecas_vendidas ?? 0) / g.pecas_total) * 100) : 0;
  const faltam = g.acerto && g.hoje ? dias(g.hoje, g.acerto) : null;

  return (
    <section aria-labelledby="ganhos" className="rounded-3xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 id="ganhos" className="flex items-center gap-2 text-xl font-semibold"><Wallet className="size-6 text-primary" aria-hidden /> Quanto eu ganho</h2>
        <button type="button" onClick={() => setTabela(true)} className="admin-btn min-h-12 text-base"><Percent className="size-4" aria-hidden /> Minha comissão</button>
      </div>
      {!g.configurado ? (
        <p className="mt-4 text-[1.05rem]">Comissão ainda não configurada pela LARDAN. Você vendeu <strong className="num">{brl(vendido)}</strong> nesta maleta.</p>
      ) : (
        <>
          <p className="mt-4 text-[1.02rem] text-muted-foreground">Comissão estimada nesta maleta</p>
          <p className="num font-numeric text-5xl font-semibold leading-tight">{brl(g.comissao_cents ?? 0)}</p>
          <p className="mt-1 text-[1.02rem]">Vendido e pago: <strong className="num">{brl(vendido)}</strong>{g.faixa ? <> · faixa <strong>{g.faixa.titulo || "atual"}</strong> ({Number(g.faixa.percentual).toLocaleString("pt-BR")}%)</> : " · ainda abaixo da primeira faixa"}</p>
          {g.repasse_cents != null && <p className="text-[1.02rem]">A repassar à LARDAN (estimado): <strong className="num">{brl(g.repasse_cents)}</strong></p>}
          <div className="mt-4">
            <div className="h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progresso} aria-label="Meta da próxima faixa">
              <div className="h-full rounded-full bg-acao" style={{ width: `${progresso}%` }} />
            </div>
            <p className="mt-2 text-[1rem]">{g.proxima ? <>Faltam <strong className="num">{brl(g.proxima.falta_cents)}</strong> para a faixa {g.proxima.titulo || "seguinte"} ({Number(g.proxima.percentual).toLocaleString("pt-BR")}%).</> : "Você está na faixa mais alta."}</p>
          </div>
        </>
      )}
      <p className="mt-4 flex items-center gap-2 rounded-2xl bg-muted/60 px-4 py-3 text-[1.02rem]">
        <CalendarClock className="size-5 shrink-0 text-primary" aria-hidden />
        <span>{g.acerto ? <>Acerto em <strong>{dataBR(g.acerto)}</strong>{faltam != null ? (faltam > 0 ? ` (faltam ${faltam} dia${faltam === 1 ? "" : "s"})` : faltam === 0 ? " (hoje)" : " (vencido)") : ""} · </> : ""}você já vendeu <strong>{pctPecas}%</strong> da maleta ({g.pecas_vendidas}/{g.pecas_total} peças).</span>
      </p>
      <p className="mt-2 text-[0.92rem] text-muted-foreground">Estimativa. O valor oficial sai no acerto feito pela LARDAN.</p>
      <TabelaComissao aberta={tabela} fechar={() => setTabela(false)} />
    </section>
  );
}
