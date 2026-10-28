import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer, Search, Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { barrasEtiqueta, documentoEtiquetas, lerCalibracao, textoEtiqueta, type EtiquetaItem } from "@/lib/etiquetas";
import { imprimirHtml } from "@/lib/imprimir-html";
import { CalibracaoArgox } from "@/components/admin/CalibracaoArgox";
import { buscarEtiquetas, lerItensEtiquetas, type EtiquetaBusca, type EtiquetaOrigem } from "@/lib/etiquetas-dados";
import { toast } from "sonner";

/**
 * Envio direto: a etiqueta é montada num quadro invisível da própria página e
 * confirma a impressora indicada pela estação antes do diálogo do navegador.
 * Nenhuma aba ou PDF extra é aberto pelo LARDAN. A escolha física permanece
 * no navegador; impressão silenciosa não é segura com dois destinos.
 */
export async function enviarParaImpressora(items: EtiquetaItem[]) {
  const validos = items.filter((i) => i.quantidade > 0);
  if (!validos.length) throw new Error("Sem dados de peças para imprimir.");
  for (const i of validos) {
    try { barrasEtiqueta(i.barcode ?? ""); } catch (e) { throw new Error(`${i.nome}: ${e instanceof Error ? e.message : "código inválido."}`); }
  }
  imprimirHtml(documentoEtiquetas(validos, lerCalibracao()));
  return validos.reduce((s, i) => s + i.quantidade, 0);
}

async function imprimirOrigens(origens: EtiquetaOrigem[], umaCada: boolean) {
  try {
    const items = (await lerItensEtiquetas(origens)).map((i) => (umaCada ? { ...i, quantidade: 1 } : i));
    const n = await enviarParaImpressora(items);
    if (n) toast.success(n === 1 ? "Impressão de 1 etiqueta preparada." : `Impressão de ${n} etiquetas preparada.`);
  } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível imprimir a etiqueta."); }
}

/** Botão de 1 clique: 1 etiqueta (uma por variante ativa) direto para a impressora. */
export function EtiquetaDireta({ origens, label = "Imprimir etiqueta" }: { origens: EtiquetaOrigem[]; label?: string }) {
  return <Button variant="outline" size="icon" title={origens.length ? label : "Sem dados de peças para imprimir"} aria-label={label} disabled={!origens.length} onClick={(e) => { e.stopPropagation(); void imprimirOrigens(origens, true); }}><Printer aria-hidden /></Button>;
}

function AjustesEstacao() {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><Settings2 aria-hidden />Calibrar e testar Argox</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="admin-scope z-[160] max-h-[90vh] max-w-3xl overflow-y-auto text-ledger-text">
        <DialogHeader><DialogTitle>Calibrar e testar a Argox</DialogTitle><DialogDescription>Vale só para este computador.</DialogDescription></DialogHeader>
        <CalibracaoArgox />
      </DialogContent>
    </Dialog>
  </>;
}

/** Busca inteligente: bipar código de barras, digitar referência ou nome; Enter com código exato imprime na hora. */
export function EtiquetasBusca({ label = "Imprimir etiquetas" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  const [termo, setTermo] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(termo.trim()), 250); return () => clearTimeout(t); }, [termo]);
  const q = useQuery({ queryKey: ["etiquetas", "busca", debounced], queryFn: () => buscarEtiquetas(debounced), enabled: open && debounced.length >= 2 });
  async function imprimir(r: EtiquetaBusca) {
    try { const n = await enviarParaImpressora([{ id: r.variantId, nome: r.nome, barcode: r.barcode, referencia: r.referencia, precoCents: r.precoCents, quantidade: 1 }]); if (n) { toast.success(`Impressão preparada: ${r.nome}`); setTermo(""); } }
    catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível imprimir."); }
  }
  async function enter() {
    const t = termo.trim(); if (t.length < 2) return;
    try {
      const rs = await buscarEtiquetas(t);
      const exatos = rs.filter((r) => r.barcode === t || r.referencia?.toUpperCase() === t.toUpperCase());
      if (exatos.length !== 1) { setDebounced(t); if (!rs.length) toast.error("Nenhuma peça encontrada."); return; }
      imprimir(exatos[0]!);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível imprimir."); }
  }
  const rs = q.data ?? [];
  return <>
    <Button variant="outline" onClick={() => setOpen(true)}><Printer aria-hidden />{label}</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="admin-scope z-[150] max-h-[85vh] max-w-2xl overflow-y-auto text-ledger-text">
        <DialogHeader><DialogTitle>Imprimir etiqueta</DialogTitle><DialogDescription>Bipe o código de barras ou digite referência ou nome. Cada clique abre a impressão de 1 etiqueta.</DialogDescription></DialogHeader>
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
        <div className="flex justify-end border-t border-line pt-3"><AjustesEstacao /></div>
      </DialogContent>
    </Dialog>
  </>;
}

/**
 * Botão de impressão usado em ficha, estoque, maleta, remessa e montagem.
 * Um clique manda direto para a impressora: 1 por peça, ou a quantidade da
 * maleta/remessa quando a origem traz quantidade. Confirma o destino antes do diálogo do navegador.
 */
export function EtiquetasImprimir({ origens, label = "Etiquetas", compact = false }: { origens: EtiquetaOrigem[]; label?: string; compact?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [enviando, setEnviando] = useState(false);
  return (
    <Button variant="outline" size={compact ? "icon" : "default"} title={origens.length ? label : "Sem dados de peças para imprimir"} aria-label={label} disabled={!origens.length || enviando}
      onClick={(e) => { e.stopPropagation(); setEnviando(true); void imprimirOrigens(origens, false).finally(() => setEnviando(false)); }}>
      {enviando ? <Loader2 aria-hidden className="animate-spin" /> : <Printer aria-hidden />}{compact ? null : label}
    </Button>
  );
}
