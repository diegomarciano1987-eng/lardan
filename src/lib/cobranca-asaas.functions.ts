/**
 * Cobrança no Asaas a partir da tela de cobrança: parcelas de acordo e disparo em lote.
 * O usuário só solicita; o executor oficial cria a cobrança e grava o resultado.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { erroAmigavel } from "./cobranca-lote-erros";

type Forma = "PIX" | "BOLETO" | "CREDIT_CARD" | "UNDEFINED";
const FORMAS: Forma[] = ["PIX", "BOLETO", "CREDIT_CARD", "UNDEFINED"];
type Rpc = { rpc: (f: string, a: object) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
type Ctx = { supabase: Rpc; userId: string };
const uuid = /^[0-9a-f-]{36}$/i;
const msgBruta = (e: unknown) => (e instanceof Error ? e.message : String(e));
const msg = (e: unknown) => { const b = msgBruta(e); console.error("[cobranca-lote]", b); return erroAmigavel(b); };

export interface ItemLote { tipo: "acordo" | "parcela"; id: string; nome?: string }
export interface ResultadoItem { tipo: string; id: string; nome?: string; ok: boolean; cobrancas: number; links: string[]; erro?: string }

async function executarIntencoes(ids: string[], actor: string) {
  const { executarIntencao } = await import("./asaas/cobranca");
  const { transporteDaIntencao } = await import("./asaas/servidor.server");
  const links: string[] = []; const erros: string[] = [];
  for (const id of ids) {
    try {
      const r = await transporteDaIntencao(id, actor);
      const x = await executarIntencao(r.executor, r.transporte, id, { actor });
      if (x.invoice_url) links.push(x.invoice_url);
      else if (x.state !== "criada") erros.push(x.erro || `Situação: ${x.state}`);
    } catch (e) { erros.push(msg(e)); }
  }
  return { links, erros };
}

async function cobrarAcordo(c: Ctx, simId: string, forma: Forma, entrada: boolean) {
  const { data, error } = await c.supabase.rpc("cob_acordo_cobrancas_preparar", { _sim: simId, _forma: forma, _incluir_entrada: entrada });
  if (error) throw new Error(error.message);
  const itens = (data ?? []) as { intent_id: string; reaproveitada: boolean }[];
  const r = await executarIntencoes(itens.map((i) => i.intent_id), c.userId);
  return { cobrancas: itens.length, ...r };
}

async function cobrarParcela(c: Ctx, installmentId: string, forma: Forma) {
  const { solicitarCobranca } = await import("./asaas/operacoes");
  const { bancoDe, bancoExecutor } = await import("./asaas/servidor.server");
  const { envDoServidor } = await import("./asaas/configuracao.server");
  const r = (await solicitarCobranca(bancoDe(c.supabase as never), await bancoExecutor(), c.userId, { installmentId, billingType: forma } as never, { env: envDoServidor() })) as
    { state: string; aviso?: string; invoice_url?: string | null; erro?: string | null };
  if (r.state === "indisponivel") throw new Error(r.aviso || "Asaas indisponível.");
  if (!r.invoice_url && r.erro) throw new Error(r.erro);
  return { cobrancas: 1, links: r.invoice_url ? [r.invoice_url] : [], erros: [] as string[] };
}

export const gerarCobrancasAcordo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { simId: string; forma: Forma; incluirEntrada: boolean }) => {
    if (!uuid.test(d?.simId ?? "")) throw new Error("Acordo inválido.");
    if (!FORMAS.includes(d.forma)) throw new Error("Forma inválida.");
    return { simId: d.simId, forma: d.forma, incluirEntrada: !!d.incluirEntrada };
  })
  .handler(async ({ data, context }) => {
    const r = await cobrarAcordo(context as unknown as Ctx, data.simId, data.forma, data.incluirEntrada);
    return { cobrancas: r.cobrancas, links: r.links, erros: r.erros };
  });

/** Disparo em lote: cada item é independente; falha de um não para os outros. */
export const dispararLoteAsaas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { itens: ItemLote[]; forma: Forma }) => {
    if (!Array.isArray(d?.itens) || d.itens.length === 0) throw new Error("Selecione ao menos um item.");
    if (d.itens.length > 200) throw new Error("No máximo 200 itens por disparo.");
    if (!FORMAS.includes(d.forma)) throw new Error("Forma inválida.");
    for (const i of d.itens) if (!uuid.test(i.id) || !["acordo", "parcela"].includes(i.tipo)) throw new Error("Item inválido.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const { data: pode } = await c.supabase.rpc("cob_pode", { _u: c.userId });
    if (!pode) throw new Error("Sem permissão de cobrança.");
    const out: ResultadoItem[] = [];
    for (const it of data.itens) {
      try {
        const r = it.tipo === "acordo" ? await cobrarAcordo(c, it.id, data.forma, false) : await cobrarParcela(c, it.id, data.forma);
        out.push({ tipo: it.tipo, id: it.id, ...(it.nome ? { nome: it.nome } : {}), ok: r.erros.length === 0, cobrancas: r.cobrancas, links: r.links, ...(r.erros.length ? { erro: r.erros.join("; ") } : {}) });
      } catch (e) {
        out.push({ tipo: it.tipo, id: it.id, ...(it.nome ? { nome: it.nome } : {}), ok: false, cobrancas: 0, links: [], erro: msg(e) });
      }
    }
    await c.supabase.rpc("cob_lote_registrar", { _forma: data.forma, _resultado: out });
    return out;
  });
