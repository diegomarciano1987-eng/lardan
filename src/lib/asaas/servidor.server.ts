/**
 * Portas de banco do lado do servidor.
 *  bancoDoUsuario: sessão do usuário (RLS e capacidades valem).
 *  bancoExecutor : papel de serviço — somente o executor interno usa.
 */
import type { BancoAsaas } from "./banco";

type RpcCliente = { rpc: (fn: never, args: never) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

export function bancoDe(cliente: RpcCliente): BancoAsaas {
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>) {
      const { data, error } = await cliente.rpc(fn as never, args as never);
      if (error) throw new Error(error.message);
      return data as T;
    },
  };
}

export async function bancoExecutor(): Promise<BancoAsaas> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return bancoDe(supabaseAdmin as unknown as RpcCliente);
}
