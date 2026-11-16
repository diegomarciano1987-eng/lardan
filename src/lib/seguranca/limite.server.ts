/**
 * 0326 — Limites contra envio em massa nas portas públicas (só servidor).
 * O IP vem dos cabeçalhos da infraestrutura (Cloudflare), nunca do corpo do pedido.
 * Se o banco não responder, o pedido segue (o limite nunca derruba o site por falha própria).
 */
import { getRequestHeader } from "@tanstack/react-start/server";

/** IP real de quem chamou: Cloudflare → proxy. */
export function ipCliente(): string | null {
  const cf = getRequestHeader("cf-connecting-ip");
  if (cf) return cf.trim().slice(0, 64);
  const real = getRequestHeader("x-real-ip");
  if (real) return real.trim().slice(0, 64);
  const fwd = getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd ? fwd.slice(0, 64) : null;
}

/** true = pode seguir. Conta mais um uso da chave na janela. */
export async function dentroDoLimite(chave: string, max: number, janelaSeg: number): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as unknown as { rpc: (f: string, a: object) => PromiseLike<{ data: unknown; error: unknown }> }).rpc(
      "seguranca_limite",
      { _chave: chave, _max: max, _janela_seg: janelaSeg },
    );
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

/** Confere várias chaves; para na primeira que estourar. */
export async function exigirLimites(regras: [chave: string | null, max: number, janelaSeg: number][], mensagem: string) {
  for (const [chave, max, janela] of regras) {
    if (!chave) continue;
    if (!(await dentroDoLimite(chave, max, janela))) throw new Error(mensagem);
  }
}
