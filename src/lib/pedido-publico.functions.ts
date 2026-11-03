import { createServerFn } from "@tanstack/react-start";
import type { PedidoPublico } from "@/lib/pedido-publico";

/** Leitura pública pelo link secreto: só primeiro nome da cliente, peças, referências e fotos. */
export const lerPedidoPublico = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(d?.token ?? "")) throw new Error("Link inválido");
    return { token: d.token };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: r, error } = await supabaseAdmin.rpc("pedido_publico", { _token: data.token });
    if (error) throw new Error("Não foi possível abrir o pedido.");
    return (r ?? null) as unknown as PedidoPublico | null;
  });
