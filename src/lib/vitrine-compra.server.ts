/**
 * 0211 — Laço de limpeza das cobranças de pedido (rota /api/public/vitrine/expirar, a cada 10 minutos):
 *  - compra da vitrine não paga em 60 min: cancela a cobrança no Asaas e devolve a peça para a vitrine;
 *  - pedido cancelado com cobrança ainda em aberto no Asaas: cancela a cobrança (antes continuava pagável).
 * Se o Asaas recusar (ex.: acabou de ser paga), a compra continua de pé e tenta de novo na próxima volta (até 6).
 */
import { cancelarNoAsaas } from "./asaas/cancelar.server";

type Linha = { order_id: string; codigo: string; acao: "expirar" | "cancelar"; charge_id: string | null; external_id: string | null };

export async function limparCobrancasDePedidos() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const rpc = supabaseAdmin.rpc as unknown as (f: string, a?: object) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("pedidos_cobranca_para_cancelar");
  if (error) throw new Error(error.message);
  const { data: cfg } = await supabaseAdmin.from("consultora_cobranca_config" as never).select("ator_user_id").maybeSingle();
  const actor = (cfg as { ator_user_id?: string } | null)?.ator_user_id ?? null;
  const resultado = { expiradas: 0, canceladas: 0, falhas: [] as string[] };
  for (const l of (data ?? []) as Linha[]) {
    let ok = true; let erro: string | null = null;
    if (l.charge_id && l.external_id) {
      if (!actor) { ok = false; erro = "Cobrança Lardan não configurada."; }
      else ({ ok, erro } = await cancelarNoAsaas(l.charge_id, l.external_id, actor));
    }
    const r = await rpc("pedido_cobranca_cancelada", { _order: l.order_id, _ok: ok, _erro: erro });
    if (r.error) { resultado.falhas.push(`${l.codigo}: ${r.error.message}`); continue; }
    if (!ok) resultado.falhas.push(`${l.codigo}: ${erro}`);
    else if (l.acao === "expirar") resultado.expiradas++;
    else resultado.canceladas++;
  }
  return resultado;
}
