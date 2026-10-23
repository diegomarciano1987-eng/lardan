import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer, Minus, Plus, Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CONFIG_ETIQUETA, barrasEtiqueta, documentoEtiquetas, svgEtiqueta, textoEtiqueta, type EtiquetaConfig, type EtiquetaItem } from "@/lib/etiquetas";
import { buscarEtiquetas, lerItensEtiquetas, type EtiquetaBusca, type EtiquetaOrigem } from "@/lib/etiquetas-dados";
import { toast } from "sonner";

function lerConfig(): EtiquetaConfig {
  try { const stored = JSON.parse(localStorage.getItem("lardan.etiquetas.argox.alca-direita.v2") ?? "null"); return stored ? { ...CONFIG_ETIQUETA, ...stored } : CONFIG_ETIQUETA; } catch { return CONFIG_ETIQUETA; }
}
/** A janela deve ser aberta no próprio clique (antes de qualquer await) para o navegador não bloquear. */
function abrirJanela() {
  const w = window.open("", "_blank", "width=900,height=650");
  if (!w) throw new Error("O navegador bloqueou a janela de impressão. Permita pop-ups para o LARDAN e tente novamente.");
  return w;
}
function enviar(w: Window, items: EtiquetaItem[]) {
  try { w.document.write(documentoEtiquetas(items, lerConfig())); w.document.close(); w.focus(); w.setTimeout(() => w.print(), 250); }
  catch (e) { w.close(); throw e; }
}
async function imprimirDireto(origens: EtiquetaOrigem[]) {
  let w: Window | null = null;
  try {
    w = abrirJanela();
    const items = (await lerItensEtiquetas(origens)).map((i) => ({ ...i, quantidade: 1 }));
    if (!items.length) throw new Error("Sem dados de peças para imprimir.");
    enviar(w, items);
  } catch (e) { w?.close(); toast.error(e instanceof Error ? e.message : "Não foi possível imprimir a etiqueta."); }
}

/** Botão de 1 clique: imprime 1 etiqueta (uma por variante ativa) sem diálogo de confirmação. */
export function EtiquetaDireta({ origens, label = "Imprimir etiqueta" }: { origens: EtiquetaOrigem[]; label?: string }) {
  return <Button variant="outline" size="icon" title={origens.length ? label : "Sem dados de peças para imprimir"} aria-label={label} disabled={!origens.length} onClick={(e) => { e.stopPropagation(); void imprimirDireto(origens); }}><Printer aria-hidden /></Button>;
}

/** Busca inteligente: bipar código de barras, digitar referência ou nome; Enter com código exato imprime na hora. */
export function EtiquetasBusca({ label = "Imprimir etiquetas" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  const [termo, setTermo] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(termo.trim()), 250); return () => clearTimeout(t); }, [termo]);
  const q = useQuery({ queryKey: ["etiquetas", "busca", debounced], queryFn: () => buscarEtiquetas(debounced), enabled: open && debounced.length >= 2 });
  function imprimir(r: EtiquetaBusca) {
    try { enviar(abrirJanela(), [{ id: r.variantId, nome: r.nome, barcode: r.barcode, referencia: r.referencia, precoCents: r.precoCents, quantidade: 1 }]); toast.success(`Etiqueta enviada: ${r.nome}`); setTermo(""); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível imprimir."); }
  }
  async function enter() {
    const t = termo.trim(); if (t.length < 2) return;
    let w: Window | null = null;
    try {
      w = abrirJanela();
      const rs = await buscarEtiquetas(t);
      const exatos = rs.filter((r) => r.barcode === t || r.referencia?.toUpperCase() === t.toUpperCase());
      if (exatos.length !== 1) { w.close(); setDebounced(t); if (!rs.length) toast.error("Nenhuma peça encontrada."); return; }
      const r = exatos[0]!;
      enviar(w, [{ id: r.variantId, nome: r.nome, barcode: r.barcode, referencia: r.referencia, precoCents: r.precoCents, quantidade: 1 }]);
      toast.success(`Etiqueta enviada: ${r.nome}`); setTermo("");
    } catch (e) { w?.close(); toast.error(e instanceof Error ? e.message : "Não foi possível imprimir."); }
  }
  const rs = q.data ?? [];
  return <>
    <Button variant="outline" onClick={() => setOpen(true)}><Printer aria-hidden />{label}</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="admin-scope z-[150] max-h-[85vh] max-w-2xl overflow-y-auto text-ledger-text">
        <DialogHeader><DialogTitle>Imprimir etiqueta</DialogTitle><DialogDescription>Bipe o código de barras ou digite referência ou nome. Cada clique imprime 1 etiqueta.</DialogDescription></DialogHeader>
        <label className="relative block">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ledger-muted" />
          <input autoFocus className="admin-input w-full pl-9" placeholder="Código de barras, referência ou nome" aria-label="Buscar peça para etiqueta" value={termo} onChange={(e) => setTermo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void enter(); } }} />
        </label>
        {debounced.length < 2 ? <p className="text-sm text-ledger-muted">Digite ao menos 2 caracteres.</p>
          : q.isPending ? <p className="flex items-center gap-2 text-sm text-ledger-muted"><Loader2 className="size-4 animate-spin" />Buscando em todo o catálogo…</p>
          : q.error ? <div role="alert" className="text-sm"><p>Não foi possível buscar.</p><Button variant="outline" onClick={() => void q.refetch()}>Tentar novamente</Button></div>
          : !rs.length ? <p className="text-sm text-ledger-muted">Nenhuma peça encontrada para “{debounced}”.</p>
          : <ul className="divide-y divide-line">{rs.map((r) => <li key={r.variantId} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0"><p className="truncate text-sm font-semibold">{r.nome}</p><p className="text-xs text-ledger-muted">Barras: {r.barcode || "sem código"} · {textoEtiqueta(r.referencia, r.precoCents) || "sem referência"}</p></div>
              <Button size="sm" disabled={!r.barcode} onClick={() => imprimir(r)}><Printer aria-hidden />Imprimir 1</Button>
            </li>)}</ul>}
      </DialogContent>
    </Dialog>
  </>;
}

const CONFIG_KEY = "lardan.etiquetas.argox.alca-direita.v2";
export function EtiquetasImprimir({ origens, label = "Etiquetas", compact = false, onOpenChange }: { origens: EtiquetaOrigem[]; label?: string; compact?: boolean; onOpenChange?: (open: boolean) => void }) {
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
    <Button variant="outline" size={compact ? "icon" : "default"} title={origens.length ? label : "Sem dados de peças para imprimir"} aria-label={label} disabled={!origens.length} onClick={(e) => { e.stopPropagation(); setOpen(true); onOpenChange?.(true); setNotice(""); setError(""); }}>
      <Printer aria-hidden />{compact ? null : label}
    </Button>
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); onOpenChange?.(value); }}>
      <DialogContent className="admin-scope z-[150] max-h-[85vh] max-w-3xl overflow-y-auto text-ledger-text">
        <DialogHeader><DialogTitle>Etiquetas de peças</DialogTitle><DialogDescription>Argox OS-214 Plus · base 95 × 12 mm · 1 coluna · alça à direita · BOPP / resina</DialogDescription></DialogHeader>
        {query.isPending ? <p>Carregando peças…</p> : query.error ? <div role="alert"><p>Não foi possível carregar as peças.</p><Button variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button></div> : !items.length ? <p>Sem dados de peças para imprimir.</p> : <>
          <div className="max-h-64 overflow-auto divide-y divide-line">
            {items.map((item) => <div key={item.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0"><p className="truncate text-sm font-semibold">{item.nome}</p><p className="text-xs text-ledger-muted">Barras: {item.barcode || "sem código"} · Referência: {textoEtiqueta(item.referencia, item.precoCents) || "sem referência"}</p></div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="ghost" size="icon" aria-label={`Diminuir ${item.nome}`} onClick={() => setItems((old) => old.map((i) => i.id === item.id ? { ...i, quantidade: Math.max(0, i.quantidade - 1) } : i))}><Minus /></Button>
                <input className="admin-input w-20 text-center" aria-label={`Quantidade ${item.nome}`} type="number" min={0} max={3000} step={1} value={item.quantidade} onChange={(e) => { const n = Number(e.target.value); setItems((old) => old.map((i) => i.id === item.id ? { ...i, quantidade: n } : i)); }} />
                <Button variant="ghost" size="icon" aria-label={`Aumentar ${item.nome}`} onClick={() => setItems((old) => old.map((i) => i.id === item.id ? { ...i, quantidade: i.quantidade + 1 } : i))}><Plus /></Button>
              </div>
            </div>)}
          </div>
          {sample && <div className="rounded-md border border-line bg-surface-muted p-4 text-center"><p className="mb-2 truncate text-xs font-semibold">{sample.nome}</p><div className="flex justify-center" dangerouslySetInnerHTML={{ __html: svgEtiqueta(sample.barcode ?? "") }} /><p className="mt-2 text-xs">{textoEtiqueta(sample.referencia || sample.barcode, sample.precoCents)}</p></div>}
          <details className="rounded-md border border-line p-4"><summary className="cursor-pointer text-sm font-semibold">Ajustes desta estação</summary>
            <div className="mt-4 grid grid-cols-2 gap-4">
              {([["entreLinhas", "Espaço entre linhas (mm)"], ["margemEsquerda", "Margem esquerda (mm)"], ["margemSuperior", "Margem superior (mm)"]] as const).map(([key, title]) => <label key={key} className="grid gap-2 text-xs">{title}<input className="admin-input" type="number" min={0} max={10} step={0.1} value={config[key]} onChange={(e) => setConfig((c) => ({ ...c, [key]: Number(e.target.value) }))} /></label>)}
            </div>
          </details>
          <p className="text-xs text-ledger-muted">Suporte 100 mm · passo 15 mm · impressão nos 30 mm à esquerda; alça sem impressão. Escolha a Argox desta estação, escala 100%, margens zero e sem cabeçalhos/rodapés. Valide uma etiqueta e a leitura antes do lote.</p>
          {invalid.length > 0 && <div role="alert" className="text-sm text-destructive">{invalid.map((msg, i) => <p key={i}>{msg}</p>)}</div>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {notice && <p role="status" className="text-sm text-ledger-muted">{notice}</p>}
          <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">{total} {total === 1 ? "etiqueta · 1 linha" : "etiquetas" + ` · ${total} linhas`}</span><Button disabled={!total || invalid.length > 0 || query.isFetching} onClick={print}><Printer />Abrir impressão</Button></div>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}