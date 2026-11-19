/**
 * 0355 — Botão "Relatório de acertos" no topo de Remessas: escolhe o período, agrupa por praça ou por representante,
 * mostra a prévia e imprime A4 (lista com logo + uma página de anotações por consultora, 6 linhas cada).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { format, addDays, startOfWeek } from "date-fns";
import type { DateRange } from "react-day-picker";
import { CalendarClock, Printer } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateRangeField } from "@/components/premium/DateRangeField";
import { confirmarImpressora } from "@/components/admin/ConfirmarImpressora";
import { agruparAcertos, dataBR, htmlRelatorioAcertos, lerRelatorioAcertos, telefoneBR, type AgruparPor } from "@/lib/relatorio-acertos";
import logo from "@/assets/lardan-logo-completa.png.asset.json";

const iso = (d: Date) => format(d, "yyyy-MM-dd");
function proximaSemana(): DateRange {
  const seg = addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), 7);
  return { from: seg, to: addDays(seg, 6) };
}

async function imprimirHtml(html: string) {
  if (!await confirmarImpressora("a4")) return;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none";
  document.body.appendChild(frame);
  const d = frame.contentDocument, w = frame.contentWindow;
  if (!d || !w) { frame.remove(); toast.error("Não foi possível preparar a impressão."); return; }
  d.open(); d.write(html); d.close();
  w.addEventListener("afterprint", () => window.setTimeout(() => frame.remove(), 1000), { once: true });
  const imagens = Array.from(d.images).map((img) => (img.complete ? Promise.resolve() : new Promise<void>((ok) => { img.onload = img.onerror = () => ok(); })));
  void Promise.race([Promise.all(imagens), new Promise<void>((ok) => window.setTimeout(ok, 2500))]).then(() => { w.focus(); w.print(); });
}

export function RelatorioAcertos() {
  const { user } = useRouteContext({ from: "/_authenticated" });
  const [aberto, setAberto] = React.useState(false);
  const [periodo, setPeriodo] = React.useState<DateRange | undefined>(proximaSemana);
  const [por, setPor] = React.useState<AgruparPor>("praca");
  const de = periodo?.from ? iso(periodo.from) : null;
  const ate = periodo?.to ? iso(periodo.to) : de;
  const q = useQuery({ queryKey: ["remessas", "relatorio-acertos", de, ate], enabled: aberto && !!de && !!ate, queryFn: () => lerRelatorioAcertos(de!, ate!), retry: false });
  const grupos = q.data ? agruparAcertos(q.data.linhas, por) : [];
  const operador = (user as { user_metadata?: { full_name?: string } }).user_metadata?.full_name || user.email || "equipe Lardan";

  return (
    <>
      <button type="button" className="admin-btn" onClick={() => setAberto(true)} title="Imprimir a lista de quem acerta no período, para a ligação antes do acerto.">
        <CalendarClock aria-hidden className="size-4" /> Relatório de acertos
      </button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Relatório de acertos</DialogTitle>
            <DialogDescription>Todas as consultoras com maleta na rua que acertam no período, por praça ou por representante. Sai em A4 com o logo e, nas páginas seguintes, espaço para anotar cada uma.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="grid gap-1.5 text-sm font-medium">Acertos entre
              <DateRangeField value={periodo} onChange={setPeriodo} placeholder="Escolha o período" />
            </label>
            <div role="radiogroup" aria-label="Agrupar por" className="inline-flex rounded-full border border-line p-1">
              {([["praca", "Por praça"], ["representante", "Por representante"]] as const).map(([v, r]) => (
                <button key={v} type="button" role="radio" aria-checked={por === v} onClick={() => setPor(v)}
                  className={`h-9 rounded-full px-4 text-sm font-semibold ${por === v ? "bg-primary text-primary-foreground" : "text-ledger-muted"}`}>{r}</button>
              ))}
            </div>
          </div>
          {!de ? <p className="text-sm text-ledger-muted">Escolha o período do acerto.</p>
            : q.isLoading ? <p className="text-sm text-ledger-muted" role="status">Buscando os acertos…</p>
            : q.isError ? <p className="text-sm text-destructive" role="alert">{(q.error as Error).message}</p>
            : q.data && (
              <div className="space-y-3">
                <p className="text-sm"><strong>{q.data.linhas.length}</strong> maletas para acertar de {dataBR(q.data.de)} a {dataBR(q.data.ate)} · {grupos.length} {por === "praca" ? "praças" : "representantes"}</p>
                {q.data.linhas.length === 0 ? <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ledger-muted">Nenhum acerto neste período.</p> : (
                  <div className="max-h-[45vh] overflow-auto rounded-xl border border-line-soft">
                    {grupos.map((g) => (
                      <div key={g.titulo}>
                        <p className="sticky top-0 bg-surface-muted px-4 py-2 text-sm font-semibold">{g.titulo} <span className="font-normal text-ledger-muted">· {g.itens.length}</span></p>
                        <table className="w-full text-xs">
                          <tbody>{g.itens.map((l) => (
                            <tr key={`${l.fonte}:${l.maleta}:${l.remessa}:${l.codigo}`} className="border-t border-line-soft">
                              <td className="px-4 py-1.5 tabular-nums">{dataBR(l.acerto)}</td>
                              <td className="px-2 py-1.5">{l.codigo ? <span className="font-semibold tabular-nums text-ledger-muted">[Cód. {l.codigo}] </span> : null}{l.consultora}</td>
                              <td className="px-2 py-1.5 tabular-nums">{telefoneBR(l.telefone)}</td>
                              <td className="px-2 py-1.5">{l.cidade ?? "—"}</td>
                              <td className="px-2 py-1.5">{por === "praca" ? l.representante : l.praca}</td>
                              <td className="px-4 py-1.5 tabular-nums">{l.maleta}{l.fonte === "smalldata" ? " · SmallData" : ""}</td>
                            </tr>))}</tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex justify-end">
                  <button type="button" className="admin-btn admin-btn-primary" disabled={q.data.linhas.length === 0}
                    onClick={() => void imprimirHtml(htmlRelatorioAcertos(q.data!, por, { logoUrl: new URL(logo.url, window.location.origin).href, operador, impressoEm: new Date() }))}>
                    <Printer aria-hidden className="size-4" /> Imprimir relatório
                  </button>
                </div>
              </div>
            )}
        </DialogContent>
      </Dialog>
    </>
  );
}
