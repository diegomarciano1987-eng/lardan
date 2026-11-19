import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Minus, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { brl, detalhePedido, traduzir, type PedidoResumo } from "@/lib/maletas";
import { buscarPecas, type Peca } from "@/lib/consultora";
import { comReferencia, useReferencias } from "@/lib/referencias-pecas";

/**
 * 0353 (Diego, 19/11/2026): editar a venda enquanto a cliente não pagou — tirar, acrescentar ou mudar a
 * quantidade das peças e trocar a forma de pagamento. Cobrança antiga ainda não paga é cancelada no servidor.
 */
type Linha = { cycle_id: string; variant_id: string; nome: string; detalhe: string | null; preco: number; qtd: number; max: number | null };

async function editarVenda(pedido: string, itens: { cycle_id: string; variant_id: string; quantidade: number }[] | null) {
  const { data, error } = await supabase.rpc("consultora_pedido_editar" as never, { _order: pedido, _itens: itens } as never);
  if (error) throw error;
  return data as unknown as { total_cents: number; pecas: number; cobranca_cancelada: boolean };
}

export const podeEditarVenda = (p: PedidoResumo) => p.channel === "consultora" && p.payment_status !== "pago" && !["concluido", "cancelado"].includes(p.status);

export function EditarVenda({ pedido, aoFechar }: { pedido: PedidoResumo | null; aoFechar: () => void }) {
  const qc = useQueryClient();
  const [linhas, setLinhas] = React.useState<Linha[] | null>(null);
  const [busca, setBusca] = React.useState("");
  const [termo, setTermo] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setTermo(busca), 300); return () => clearTimeout(t); }, [busca]);
  React.useEffect(() => { setLinhas(null); setBusca(""); }, [pedido?.id]);

  const det = useQuery({ queryKey: ["consultora", "pedido", pedido?.id], queryFn: () => detalhePedido(pedido!.id), enabled: !!pedido });
  React.useEffect(() => {
    if (!det.data || linhas) return;
    setLinhas(det.data.itens.filter((i) => i.cycle_id).map((i) => ({
      cycle_id: i.cycle_id!, variant_id: i.variant_id, nome: i.product_name, detalhe: i.variant_label, preco: i.unit_price_cents, qtd: i.quantity, max: null,
    })));
  }, [det.data, linhas]);
  const pecas = useQuery({ queryKey: ["consultora", "pecas", "editar", termo], queryFn: () => buscarPecas(termo), enabled: !!pedido && termo.trim().length >= 2 });
  const refs = useReferencias([...(linhas ?? []).map((l) => l.variant_id), ...(pecas.data ?? []).map((p) => p.variant_id)]);

  const chave = (l: { cycle_id: string; variant_id: string }) => `${l.cycle_id}:${l.variant_id}`;
  const mudar = (k: string, d: number) => setLinhas((ls) => (ls ?? []).map((l) => (chave(l) === k ? { ...l, qtd: Math.max(0, Math.min(l.max ?? 99, l.qtd + d)) } : l)));
  const acrescentar = (p: Peca) => setLinhas((ls) => {
    const l = ls ?? [];
    const k = chave(p);
    const ja = l.find((x) => chave(x) === k);
    if (ja) return l.map((x) => (chave(x) === k ? { ...x, qtd: Math.min(x.qtd + 1, (x.max ?? 99)) } : x));
    toast.success("Peça acrescentada.");
    return [...l, { cycle_id: p.cycle_id, variant_id: p.variant_id, nome: p.produto, detalhe: p.variante, preco: p.preco_cents, qtd: 1, max: p.disponivel }];
  });
  const ativas = (linhas ?? []).filter((l) => l.qtd > 0);
  const total = ativas.reduce((s, l) => s + l.preco * l.qtd, 0);
  const temCobranca = pedido?.payment_status === "pendente";

  const fim = (r: { cobranca_cancelada: boolean }, texto: string) => {
    toast.success(r.cobranca_cancelada ? `${texto} A cobrança antiga foi cancelada: gere a nova em "Ver peças e pagamento".` : texto);
    void qc.invalidateQueries({ queryKey: ["consultora"] });
    void qc.invalidateQueries({ queryKey: ["consultora-pagamento"] });
    void qc.invalidateQueries({ queryKey: ["consultora-pedidos"] });
    aoFechar();
  };
  const salvar = useMutation({
    mutationFn: () => editarVenda(pedido!.id, ativas.map((l) => ({ cycle_id: l.cycle_id, variant_id: l.variant_id, quantidade: l.qtd }))),
    onSuccess: (r) => fim(r, `Venda atualizada: ${brl(r.total_cents)}.`),
    onError: (e) => toast.error(traduzir(e)),
  });
  const trocarForma = useMutation({
    mutationFn: () => editarVenda(pedido!.id, null),
    onSuccess: (r) => fim(r, "Pronto: escolha a nova forma de pagamento."),
    onError: (e) => toast.error(traduzir(e)),
  });

  return (
    <Dialog open={!!pedido} onOpenChange={(v) => { if (!v) aoFechar(); }}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar venda {pedido?.code}</DialogTitle>
          <DialogDescription>{pedido?.customer_name} · dá para mudar enquanto a cliente não pagou.</DialogDescription>
        </DialogHeader>

        {temCobranca && (
          <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4">
            <strong className="block text-[1.02rem]">Esta venda já tem uma cobrança ainda não paga.</strong>
            <span className="mt-1 block text-[0.98rem] text-muted-foreground">Ao salvar, ela é cancelada e você gera a nova com o valor certo.</span>
            <Button type="button" variant="outline" className="mt-3 min-h-12 w-full" disabled={trocarForma.isPending} onClick={() => trocarForma.mutate()}>
              {trocarForma.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null} Trocar só a forma de pagamento
            </Button>
          </div>
        )}

        {det.isLoading || !linhas ? (
          <p className="flex items-center gap-2 py-6 text-muted-foreground"><LoaderCircle className="size-5 animate-spin" aria-hidden /> Carregando peças…</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {linhas.map((l) => (
              <li key={chave(l)} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4 ${l.qtd === 0 ? "opacity-50" : ""}`}>
                <span className="min-w-0">
                  <strong className="block break-words text-[1.02rem]">{comReferencia(refs.data?.get(l.variant_id), l.nome)}</strong>
                  <span className="block text-[0.95rem] text-muted-foreground">{l.detalhe ? `${l.detalhe} · ` : ""}{brl(l.preco)} cada{l.qtd === 0 ? " · sai da venda" : ""}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Button type="button" variant="outline" size="icon" className="size-11" aria-label={l.qtd <= 1 ? `Tirar ${l.nome}` : `Diminuir ${l.nome}`} onClick={() => mudar(chave(l), -1)} disabled={l.qtd === 0}>
                    {l.qtd <= 1 ? <Trash2 aria-hidden /> : <Minus aria-hidden />}
                  </Button>
                  <span className="w-8 text-center text-lg font-semibold tabular-nums" aria-live="polite">{l.qtd}</span>
                  <Button type="button" variant="outline" size="icon" className="size-11" aria-label={`Aumentar ${l.nome}`} onClick={() => mudar(chave(l), 1)}><Plus aria-hidden /></Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2">
          <label className="relative block">
            <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <input type="search" className="admin-input min-h-13 pl-12 text-[1.02rem]" placeholder="Acrescentar peça: referência, nome ou código" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar peça da sua maleta para acrescentar" />
          </label>
          {termo.trim().length >= 2 && (
            pecas.isFetching ? <p className="text-muted-foreground">Buscando…</p>
            : (pecas.data ?? []).length === 0 ? <p className="text-muted-foreground">Nenhuma peça livre na sua maleta com essa busca.</p>
            : (
              <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-2xl border border-border">
                {(pecas.data ?? []).slice(0, 30).map((p) => (
                  <li key={chave(p)}>
                    <button type="button" className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-left hover:bg-muted" onClick={() => acrescentar(p)} disabled={p.disponivel <= 0}>
                      <span className="min-w-0"><span className="block break-words font-semibold">{comReferencia(refs.data?.get(p.variant_id), p.produto)}</span>
                        <span className="block text-[0.92rem] text-muted-foreground">{brl(p.preco_cents)} · {p.disponivel} livre(s)</span></span>
                      <Plus aria-hidden className="size-5 text-primary" />
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-3 border-t border-border pt-4">
          <span className="text-lg text-muted-foreground">Novo valor</span>
          <strong className="text-2xl font-semibold tabular-nums">{brl(total)}</strong>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Button type="button" variant="outline" className="min-h-12" onClick={aoFechar}>Voltar</Button>
          <Button type="button" className="min-h-12" disabled={salvar.isPending || !linhas || ativas.length === 0} onClick={() => salvar.mutate()}>
            {salvar.isPending ? "Salvando…" : "Salvar venda"}
          </Button>
        </div>
        {linhas && ativas.length === 0 && <p className="text-[0.95rem] text-muted-foreground">A venda precisa de pelo menos uma peça. Para desistir, use "Cancelar pedido".</p>}
      </DialogContent>
    </Dialog>
  );
}
