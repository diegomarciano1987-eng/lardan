import { lerCalibracaoGlobal } from "@/lib/etiquetas-calibracao";
import { imprimirDireto, lerEstacao } from "@/lib/argox-direta";
import { comandosEtiquetas } from "@/lib/etiquetas-raw";
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
import { LadosEtiqueta, useLadosEtiqueta } from "@/components/admin/LadosEtiqueta";

/**
 * Envio direto: a etiqueta é montada num quadro invisível da própria página e
 * confirma a impressora indicada pela estação antes do diálogo do navegador.
 * Nenhuma aba ou PDF extra é aberto pelo LARDAN. A escolha física permanece
 * no navegador; impressão silenciosa não é segura com dois destinos.
 */
export async function enviarParaImpressora(items: EtiquetaItem[], duplicar = false) {
  const validos = items.filter((i) => i.quantidade > 0);
  if (!validos.length) throw new Error("Sem dados de peças para imprimir.");
  for (const i of validos) {
    try { barrasEtiqueta(i.barcode ?? ""); } catch (e) { throw new Error(`${i.nome}: ${e instanceof Error ? e.message : "código inválido."}`); }
  }
  const est = lerEstacao();
  // 0342: 1 lado é o padrão; 2 lados só quando o seletor ao lado da impressora foi marcado.
  await imprimirDireto(comandosEtiquetas(validos, await lerCalibracaoGlobal(), est.linguagem, { duplicar }), est);
  return { n: validos.reduce((s, i) => s + i.quantidade, 0), duplicar };
}
const avisoLados = (duplicar: boolean) => (duplicar ? " em 2 lados. A próxima volta para 1 lado" : "");

/** Envia e devolve true quando a etiqueta foi enviada (para o seletor voltar a 1 lado). */
async function imprimirOrigens(origens: EtiquetaOrigem[], umaCada: boolean, copias = 1, duplicar = false): Promise<boolean> {
  try {
    const items = (await lerItensEtiquetas(origens)).map((i) => (umaCada ? { ...i, quantidade: copias } : i));
    const { n } = await enviarParaImpressora(items, duplicar);
    const lados = avisoLados(duplicar);
    if (n) toast.success(n === 1 ? `Impressão de 1 etiqueta preparada${lados}.` : `Impressão de ${n} etiquetas preparada${lados}.`);
    return true;
  } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível imprimir a etiqueta."); return false; }
}

/** Botão de 1 clique: 1 etiqueta (uma por variante ativa) direto para a impressora, com 1/2 lados ao lado. */
export function EtiquetaDireta({ origens, label = "Imprimir etiqueta" }: { origens: EtiquetaOrigem[]; label?: string }) {
  const [duplicar, setDuplicar] = useLadosEtiqueta();
  return <span className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
    <Button variant="outline" size="icon" title={origens.length ? label : "Sem dados de peças para imprimir"} aria-label={label} disabled={!origens.length} onClick={() => { void imprimirOrigens(origens, true, 1, duplicar).then((ok) => { if (ok) setDuplicar(false); }); }}><Printer aria-hidden /></Button>
    <LadosEtiqueta mini value={duplicar} onChange={setDuplicar} />
  </span>;
}

/** Campo de cópias + impressora: sai N etiquetas da mesma peça, uma atrás da outra. */
export function EtiquetaComQuantidade({ origens, label = "Imprimir etiqueta" }: { origens: EtiquetaOrigem[]; label?: string }) {
  const [qtd, setQtd] = useState("1");
  const [duplicar, setDuplicar] = useLadosEtiqueta();
  const n = Math.min(500, Math.max(1, Math.floor(Number(qtd)) || 1));
  const imprimir = () => void imprimirOrigens(origens, true, n, duplicar).then((ok) => { if (ok) setDuplicar(false); });
  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <input
        type="text"
        inputMode="numeric"
        aria-label={`Quantidade de etiquetas — ${label}`}
        title="Quantas etiquetas imprimir"
        value={qtd}
        onChange={(e) => setQtd(e.target.value.replace(/\D/g, "").slice(0, 3))}
        onBlur={() => setQtd(String(n))}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); imprimir(); } }}
        className="admin-input num h-9 w-14 text-center"
      />
      <Button variant="outline" size="icon" title={origens.length ? `${label} (${n})` : "Sem dados de peças para imprimir"} aria-label={`${label} (${n})`} disabled={!origens.length} onClick={imprimir}><Printer aria-hidden /></Button>
      <LadosEtiqueta mini value={duplicar} onChange={setDuplicar} />
    </div>
  );
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
  async function imprimir(r: EtiquetaBusca, duplicar = false): Promise<boolean> {
    try { const { n } = await enviarParaImpressora([{ id: r.variantId, nome: r.nome, barcode: r.barcode, referencia: r.referencia, precoCents: r.precoCents, aro: r.aro, quantidade: 1 }], duplicar); if (n) { toast.success(`Impressão preparada: ${r.nome}${avisoLados(duplicar)}.`); setTermo(""); } return true; }
    catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível imprimir."); return false; }
  }
  async function enter() {
    const t = termo.trim(); if (t.length < 2) return;
    try {
      const rs = await buscarEtiquetas(t);
      const exatos = rs.filter((r) => r.barcode === t || r.referencia?.toUpperCase() === t.toUpperCase());
      if (exatos.length !== 1) { setDebounced(t); if (!rs.length) toast.error("Nenhuma peça encontrada."); return; }
      void imprimir(exatos[0]!);
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
              <div className="min-w-0"><p className="truncate text-sm font-semibold">{r.nome}</p><p className="text-xs text-ledger-muted">Barras: {r.barcode || "sem código"} · {textoEtiqueta(r.referencia, r.precoCents) || "sem referência"}{r.aro ? ` · Aro ${r.aro}` : ""}</p></div>
              <ImprimirUmComLados disabled={!r.barcode} onImprimir={(d) => imprimir(r, d)} />
            </li>)}</ul>}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3"><span className="text-xs text-ledger-muted">1 lado é o padrão. Para 2 lados, marque 2 lados ao lado da impressora.</span><AjustesEstacao /></div>
      </DialogContent>
    </Dialog>
  </>;
}

function ImprimirUmComLados({ disabled, onImprimir }: { disabled: boolean; onImprimir: (duplicar: boolean) => Promise<boolean> }) {
  const [duplicar, setDuplicar] = useLadosEtiqueta();
  return <span className="inline-flex shrink-0 items-center gap-1.5">
    <Button size="sm" disabled={disabled} onClick={() => { void onImprimir(duplicar).then((ok) => { if (ok) setDuplicar(false); }); }}><Printer aria-hidden />Imprimir 1</Button>
    <LadosEtiqueta mini value={duplicar} onChange={setDuplicar} />
  </span>;
}

/**
 * Botão de impressão usado em ficha, estoque, maleta, remessa e montagem.
 * Um clique manda direto para a impressora: 1 por peça, ou a quantidade da
 * maleta/remessa quando a origem traz quantidade. Confirma o destino antes do diálogo do navegador.
 */
export function EtiquetasImprimir({ origens, label = "Etiquetas", compact = false }: { origens: EtiquetaOrigem[]; label?: string; compact?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [enviando, setEnviando] = useState(false);
  const [duplicar, setDuplicar] = useLadosEtiqueta();
  const botao = (
    <Button variant="outline" size={compact ? "icon" : "default"} title={origens.length ? label : "Sem dados de peças para imprimir"} aria-label={label} disabled={!origens.length || enviando}
      onClick={(e) => { e.stopPropagation(); setEnviando(true); void imprimirOrigens(origens, false, 1, duplicar).then((ok) => { if (ok) setDuplicar(false); }).finally(() => setEnviando(false)); }}>
      {enviando ? <Loader2 aria-hidden className="animate-spin" /> : <Printer aria-hidden />}{compact ? null : label}
    </Button>
  );
  // 0342: todo ícone de impressora (lista ou botão grande) tem o seu 1/2 lados colado ao lado; 1 lado sempre marcado.
  return <span className={compact ? "inline-flex items-center gap-1.5" : "inline-flex flex-wrap items-center gap-2"} onClick={(e) => e.stopPropagation()}>{botao}<LadosEtiqueta mini={compact} value={duplicar} onChange={setDuplicar} /></span>;
}
