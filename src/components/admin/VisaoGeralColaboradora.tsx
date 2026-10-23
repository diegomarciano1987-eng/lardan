import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ScanBarcode, BriefcaseBusiness } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { supabase } from "@/integrations/supabase/client";
import { useCapabilities } from "@/lib/capabilities";
import { useColabEscopo } from "@/lib/colab-escopo";
import { DateRangeField } from "@/components/premium/DateRangeField";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, ErrorState, Skeleton } from "@/components/admin/ui";
import { isoDia } from "@/lib/remessas";

type Resumo = { pecas: number; maletas: number; retiradas: number; ajustes: number; saldo: number; hoje: number; inicio: string | null; dias: { dia: string; pecas: number; maletas: number }[]; recentes: { created_at: string; origem: string; delta: number; codigo: string; remessa: number | null }[] };
export function VisaoGeralColaboradora() {
  const caps = useCapabilities();
  const escopo = useColabEscopo();
  const [periodo, setPeriodo] = useState<DateRange | undefined>(() => { const date = new Date(); return { from: new Date(date.getFullYear(), date.getMonth(), 1), to: date }; });
  const de = isoDia(periodo?.from); const ate = isoDia(periodo?.to ?? periodo?.from);
  const resumo = useQuery({ queryKey: ["montagem-pessoal", escopo.data?.representante, de, ate], enabled: !!de && !!ate && !!escopo.data?.representante && caps.includes("kit.view"), queryFn: async () => {
    const { data, error } = await supabase.rpc("montagem_meu_resumo", { _de: de ?? "", _ate: ate ?? "" });
    if (error) throw error;
    return data as unknown as Resumo;
  } });
  const d = resumo.data;
  return <div className="space-y-6">
    <PageHeader eyebrow="MEU TRABALHO" title="Visão Geral" actions={<Button variant="outline" onClick={() => void resumo.refetch()} disabled={resumo.isFetching || !escopo.data?.representante}><RefreshCw />Atualizar</Button>} />
    <div className="flex flex-wrap items-center justify-between gap-4"><p className="text-sm text-ledger-muted">{escopo.data?.nome ?? "Sem representante vinculado"}</p><DateRangeField value={periodo} onChange={setPeriodo} /></div>
    {!escopo.data?.representante ? <EmptyState title="Sem dados" description="Nenhum representante vinculado a este acesso." /> : !caps.includes("kit.view") ? <EmptyState title="Sem dados de montagem" description="Consulta de maletas não liberada neste acesso." /> : !de || !ate ? <EmptyState title="Sem período" description="Selecione as datas para consultar seu trabalho." /> : resumo.isPending ? <Skeleton className="h-32" /> : resumo.isError ? <ErrorState message="Não foi possível carregar seu trabalho." onRetry={() => void resumo.refetch()} /> : d && <>
      <div className="grid grid-cols-3 gap-4">{[["Peças no período", d.pecas], ["Maletas bipadas", d.maletas], ["Bipadas hoje no período", d.hoje], ["Peças retiradas", d.retiradas], ["Ajustes manuais", d.ajustes], ["Saldo das operações", d.saldo]].map(([label, value]) => <div key={label} className="rounded-md border border-line bg-surface p-5"><p className="ledger-eyebrow">{label}</p><p className="mt-2 text-3xl font-semibold tabular-nums text-ledger-text">{d.inicio ? value : "—"}</p></div>)}</div>
      {!d.inicio && <EmptyState title="Sem dados de bipagem" description="Ainda não há operações com autoria registrada neste acesso." />}
      {d.inicio && <p className="text-xs text-ledger-muted">Registros pessoais desde {new Date(d.inicio).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Histórico sem autoria não incluído.</p>}
      <div className="grid grid-cols-2 gap-6"><Panel title="Bipagens por dia">{d.dias.length ? <table className="w-full text-sm"><thead><tr className="text-left text-ledger-muted"><th className="py-2">Dia</th><th>Peças</th><th>Maletas</th></tr></thead><tbody>{d.dias.map((dia) => <tr key={dia.dia} className="border-t border-line"><td className="py-3">{dia.dia.split("-").reverse().join("/")}</td><td>{dia.pecas}</td><td>{dia.maletas}</td></tr>)}</tbody></table> : <p className="text-sm text-ledger-muted">Sem dados no período.</p>}</Panel>
      <Panel title="Trabalho recente"><div className="max-h-96 overflow-auto divide-y divide-line">{d.recentes.length ? d.recentes.map((r, i) => <div key={i} className="flex justify-between gap-3 py-3 text-sm"><div><p className="font-semibold">Maleta {r.codigo}{r.remessa ? ` · Remessa ${r.remessa}` : ""}</p><p className="text-xs text-ledger-muted">{new Date(r.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {r.origem}</p></div><strong>{r.delta > 0 ? "+" : ""}{r.delta}</strong></div>) : <p className="text-sm text-ledger-muted">Sem dados no período.</p>}</div></Panel></div>
    </>}
    {caps.includes("kit.view") && <Button asChild variant="outline"><Link to="/admin/maletas"><BriefcaseBusiness />Remessas e maletas</Link></Button>}
    {caps.includes("kit.manage") && <span className="inline-flex items-center gap-2 text-sm text-ledger-muted"><ScanBarcode />Montagem liberada</span>}
  </div>;
}