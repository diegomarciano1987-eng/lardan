/**
 * 0211 — Compra de verdade na vitrine pública da consultora (sem login).
 * O banco (vitrine_comprar, só servidor) valida vitrine, cliente, CPF, peças e limites; a cobrança sai pelo mesmo
 * motor oficial do Asaas usado no app da consultora, em nome da Lardan. A baixa vem só pelo aviso do Asaas.
 */
import { createServerFn } from "@tanstack/react-start";

type Forma = "pix" | "cartao";
const BILLING: Record<Forma, "PIX" | "CREDIT_CARD"> = { pix: "PIX", cartao: "CREDIT_CARD" };

export interface EntradaCompra {
  slug: string;
  chave: string;
  forma: Forma;
  cliente: { nome: string; telefone: string; cpf: string; email?: string | null };
  itens: { variant_id: string; quantidade: number }[];
}
export interface ResultadoCompra {
  codigo: string;
  token: string;
  forma: Forma;
  total_cents: number;
  expira_em: string | null;
  consultora: string;
  url: string | null;
  copia: string | null;
  qr: string | null;
}

async function rpcAdmin<T = unknown>(f: string, a: object): Promise<T> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as unknown as { rpc: (f: string, a: object) => PromiseLike<{ data: unknown; error: { message: string } | null }> }).rpc(f, a);
  if (error) throw new Error(error.message.replace(/^.*?:\s*(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/, ""));
  return data as T;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const vitrineComprar = createServerFn({ method: "POST" })
  .inputValidator((d: EntradaCompra): EntradaCompra => {
    if (!d || typeof d !== "object") throw new Error("Dados inválidos.");
    const slug = String(d.slug ?? "").toLowerCase().trim().slice(0, 60);
    const chave = String(d.chave ?? "").trim();
    if (!/^[a-z0-9-]{2,60}$/.test(slug)) throw new Error("Vitrine inválida.");
    if (!/^[A-Za-z0-9-]{16,80}$/.test(chave)) throw new Error("Tente de novo.");
    if (d.forma !== "pix" && d.forma !== "cartao") throw new Error("Escolha Pix ou cartão.");
    const itens = Array.isArray(d.itens) ? d.itens.slice(0, 30).map((i) => ({ variant_id: String(i?.variant_id ?? ""), quantidade: Math.trunc(Number(i?.quantidade ?? 0)) })) : [];
    if (!itens.length || itens.some((i) => !UUID.test(i.variant_id) || i.quantidade < 1 || i.quantidade > 10)) throw new Error("Escolha as peças de novo.");
    const c = d.cliente ?? ({} as EntradaCompra["cliente"]);
    return {
      slug, chave, forma: d.forma, itens,
      cliente: {
        nome: String(c.nome ?? "").slice(0, 80),
        telefone: String(c.telefone ?? "").replace(/\D/g, "").slice(0, 11),
        cpf: String(c.cpf ?? "").replace(/\D/g, "").slice(0, 11),
        email: c.email ? String(c.email).trim().slice(0, 120) : null,
      },
    };
  })
  .handler(async ({ data }): Promise<ResultadoCompra> => {
    const t = await rpcAdmin<{
      order_id: string; codigo: string; token: string; total_cents: number; installment_id: string; actor: string;
      forma: Forma; vencimento: string; expira_em: string | null; consultora_user: string | null; consultora_nome: string | null; repetido?: boolean;
    }>("vitrine_comprar", { _slug: data.slug, _cliente: data.cliente, _itens: data.itens, _forma: data.forma, _chave: data.chave });

    const { solicitarCobranca } = await import("./asaas/operacoes");
    const { bancoExecutor } = await import("./asaas/servidor.server");
    const { envDoServidor } = await import("./asaas/configuracao.server");
    let rr: { charge_id?: string | null; invoice_url?: string | null; external_id?: string | null; simulado?: boolean } = {};
    try {
      const executor = await bancoExecutor();
      const usuario = { rpc: <T,>(_f: string, a: Record<string, unknown>) => rpcAdmin<T>("consultora_asaas_preparar", { _actor: t.actor, _payload: a["_payload"] }) };
      const r = await solicitarCobranca(usuario as never, executor, t.actor, { installmentId: t.installment_id, billingType: BILLING[t.forma], dueDate: t.vencimento }, { env: envDoServidor() });
      if ((r as { state: string }).state === "indisponivel") throw new Error((r as { aviso?: string }).aviso || "Pagamento indisponível no momento.");
      rr = r as typeof rr;
      await rpcAdmin("consultora_pagamento_registrar", { _order: t.order_id, _charge: rr.charge_id ?? null, _url: rr.invoice_url ?? null });
    } catch (e) {
      // sem cobrança válida a compra não segura a peça: cancela o que tiver saído no Asaas e libera na hora
      if (!t.repetido && rr.charge_id && rr.external_id) {
        const { cancelarNoAsaas } = await import("./asaas/cancelar.server");
        await cancelarNoAsaas(rr.charge_id, rr.external_id, t.actor).catch(() => undefined);
      }
      if (!t.repetido) await rpcAdmin("pedido_cobranca_cancelada", { _order: t.order_id, _ok: true, _erro: `falha ao gerar cobrança: ${(e as Error).message}` }).catch(() => undefined);
      throw new Error("Não foi possível gerar o pagamento agora. Tente de novo em instantes ou fale com a consultora pelo WhatsApp.");
    }

    let copia: string | null = null; let qr: string | null = null;
    if (t.forma === "pix" && rr.external_id && !rr.simulado) {
      try {
        const { resolverPorParcela } = await import("./asaas/servidor.server");
        const { transporteDaResolucao } = await import("./asaas/configuracao.server");
        const tr = (await transporteDaResolucao(await resolverPorParcela(t.installment_id, t.actor))) as unknown as { pixQrCode?: (id: string) => Promise<{ payload: string | null; encodedImage: string | null }> };
        const px = await tr.pixQrCode?.(rr.external_id);
        copia = px?.payload ?? null; qr = px?.encodedImage ? `data:image/png;base64,${px.encodedImage}` : null;
      } catch (e) { console.error("pix qrcode vitrine", (e as Error).message); }
    }

    if (!t.repetido && t.consultora_user) {
      try {
        const { enviarAvisoPush } = await import("./push/notificar.server");
        await enviarAvisoPush({
          titulo: "Nova compra na sua vitrine 🛍️",
          corpo: `Pedido ${t.codigo} · ${(t.total_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · aguardando o pagamento da cliente.`,
          url: "/consultora?aba=pedidos",
          tag: `vitrine-${t.order_id}`,
        }, t.consultora_user);
      } catch (e) { console.error("push vitrine", (e as Error).message); }
    }

    return {
      codigo: t.codigo, token: t.token, forma: t.forma, total_cents: Number(t.total_cents), expira_em: t.expira_em,
      consultora: t.consultora_nome || "a consultora", url: rr.invoice_url ?? null, copia, qr,
    };
  });
