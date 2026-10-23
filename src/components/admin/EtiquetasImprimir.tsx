import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { CONFIG_ETIQUETA, barrasEtiqueta, documentoEtiquetas, svgEtiqueta, type EtiquetaConfig, type EtiquetaItem } from "@/lib/etiquetas";
import { lerItensEtiquetas, type EtiquetaOrigem } from "@/lib/etiquetas-dados";

const CONFIG_KEY = "lardan.etiquetas.argox.v1";
export function EtiquetasImprimir({ origens, label = "Etiquetas", compact = false }: { origens: EtiquetaOrigem[]; label?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<EtiquetaConfig>(CONFIG_ETIQUETA);
  const [items, setItems] = useState<EtiquetaItem[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const query = useQuery({ queryKey: ["etiquetas", origens], queryFn: () => lerItensEtiquetas(origens), enabled: open && origens.length > 0 });
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "null");
      if (stored) setConfig({ ...CONFIG_ETIQUETA, ...stored });
    } catch { /* Invalid station calibration falls back to defaults. */ }
  }, []);
  useEffect(() => { if (query.data) setItems(query.data); }, [query.data]);
  const selected = items.filter((i) => i.quantidade > 0);
  const total = selected.reduce((sum, item) => sum + item.quantidade, 0);
  const invalid = selected.map((i) => {
    try { barrasEtiqueta(i.barcode ?? ""); return null; } catch (e) { return `${i.nome}: ${e instanceof Error ? e.message : "Código inválido."}`; }
  }).filter(Boolean);
  const sample = selected.find((i) => { try { barrasEtiqueta(i.barcode ?? ""); return true; } catch { return false; } });
  function print() {
    setError(""); setNotice("");
    try {
      const html = documentoEtiquetas(items, config);
      const w = window.open("", "_blank", "width=900,height=650");
      if (!w) throw new Error("O navegador bloqueou a janela de impressão. Permita pop-ups para o LARDAN e tente novamente.");
      w.document.write(html); w.document.close();
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      w.focus();
      w.setTimeout(() => w.print(), 250);
      setNotice("Janela de impressão aberta. O sistema não confirma se a impressora imprimiu ou se o envio foi cancelado.");
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível preparar as etiquetas."); }
  }
  return <>
    <Button variant="outline" size={compact ? "icon" : "default"} title={label} aria-label={label} disabled={!origens.length} onClick={(e) => { e.stopPropagation(); setOpen(true); setNotice(""); setError(""); }}>
      <Printer aria-hidden />{compact ? null : label}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="admin-scope max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Etiquetas de peças</DialogTitle><DialogDescription>Argox OS-214 Plus · 25 × 12 mm · 3 pistas · 203 DPI</DialogDescription></DialogHeader>
        {query.isPending ? <p>Carregando peças…</p> : query.error ? <div role="alert"><p>Não foi possível carregar as peças.</p><Button variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button></div> : !items.length ? <p>Sem dados de peças para imprimir.</p> : <>
          <div className="max-h-64 overflow-auto divide-y divide-line">
            {items.map((item) => <div key={item.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0"><p className="truncate text-sm font-semibold">{item.nome}</p><p className="text-xs text-ledger-muted">Barras: {item.barcode || "sem código"} · Referência: {item.referencia || "sem referência"}</p></div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="ghost" size="icon" aria-label={`Diminuir ${item.nome}`} onClick={() => setItems((old) => old.map((i) => i.id === item.id ? { ...i, quantidade: Math.max(0, i.quantidade - 1) } : i))}><Minus /></Button>
                <input className="admin-input w-20 text-center" aria-label={`Quantidade ${item.nome}`} type="number" min={0} max={3000} step={1} value={item.quantidade} onChange={(e) => { const n = Number(e.target.value); setItems((old) => old.map((i) => i.id === item.id ? { ...i, quantidade: n } : i)); }} />
                <Button variant="ghost" size="icon" aria-label={`Aumentar ${item.nome}`} onClick={() => setItems((old) => old.map((i) => i.id === item.id ? { ...i, quantidade: i.quantidade + 1 } : i))}><Plus /></Button>
              </div>
            </div>)}
          </div>
          {sample && <div className="rounded-md border border-line bg-surface-muted p-4 text-center"><p className="mb-2 truncate text-xs font-semibold">{sample.nome}</p><div className="flex justify-center" dangerouslySetInnerHTML={{ __html: svgEtiqueta(sample.barcode ?? "") }} /><p className="mt-2 text-xs">{sample.referencia || sample.barcode}</p></div>}
          <details className="rounded-md border border-line p-4"><summary className="cursor-pointer text-sm font-semibold">Ajustes desta estação</summary>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <label className="grid gap-2 text-xs">Primeira pista<SmartSelect value={String(config.primeiraPista)} onChange={(v) => setConfig((c) => ({ ...c, primeiraPista: Number(v) }))} options={[1,2,3].map((n) => ({ value: String(n), label: `Pista ${n}` }))} /></label>
              {([["entrePistas", "Espaço entre pistas (mm)"], ["entreLinhas", "Espaço entre linhas (mm)"], ["margemEsquerda", "Margem esquerda (mm)"], ["margemSuperior", "Margem superior (mm)"]] as const).map(([key, title]) => <label key={key} className="grid gap-2 text-xs">{title}<input className="admin-input" type="number" min={0} max={10} step={0.1} value={config[key]} onChange={(e) => setConfig((c) => ({ ...c, [key]: Number(e.target.value) }))} /></label>)}
            </div>
          </details>
          <p className="text-xs text-ledger-muted">No diálogo, escolha a Argox conectada neste computador, escala 100%, margens zero e sem cabeçalhos/rodapés. O papel deve ter a largura das três pistas; confira os espaços do rolo nos ajustes antes do primeiro lote.</p>
          {invalid.length > 0 && <div role="alert" className="text-sm text-destructive">{invalid.map((msg, i) => <p key={i}>{msg}</p>)}</div>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {notice && <p role="status" className="text-sm text-ledger-muted">{notice}</p>}
          <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">{total} {total === 1 ? "etiqueta" : "etiquetas"} · {Math.ceil((total + config.primeiraPista - 1) / 3)} {Math.ceil((total + config.primeiraPista - 1) / 3) === 1 ? "linha" : "linhas"}</span><Button disabled={!total || invalid.length > 0 || query.isFetching} onClick={print}><Printer />Abrir impressão</Button></div>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}