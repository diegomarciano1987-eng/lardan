/**
 * Portas de banco do lado do servidor.
 *  bancoDoUsuario: sessão do usuário (RLS e capacidades valem).
 *  bancoExecutor : papel de serviço — somente o executor interno usa.
 */
import type { BancoAsaas } from "./banco";
import { ROTINAS_EXECUTOR } from "./banco";
import type { TransporteAsaas } from "./contrato";

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

export interface ConfigInterna {
  account_id: string;
  state: string;
  modo: "simulado" | "conectado";
  ambiente: "sandbox" | "producao" | null;
  secret_ref: string | null;
  external_account_id: string | null;
  invoice_host_confirmed: boolean;
}

export async function transporteDaConfiguracao(config: ConfigInterna): Promise<TransporteAsaas> {
  if (config.modo === "simulado") {
    if (process.env['LARDAN_DEMO_ISOLADO'] !== "1") throw new Error("Simulação disponível somente no ambiente isolado.");
    const { simuladorDaConta } = await import("./index");
    return simuladorDaConta(config.account_id);
  }
  if (config.ambiente !== "sandbox") throw new Error("Produção permanece bloqueada nesta preparação.");
  if (process.env['ASAAS_EGRESS_ENABLED'] !== "1") throw new Error("Conta preparada, mas a saída externa permanece bloqueada.");
  const ref = config.secret_ref;
  if (!ref || !/^ASAAS_SANDBOX_[A-Z0-9_]{1,48}$/.test(ref)) throw new Error("Referência de credencial sandbox inválida.");
  const chave = process.env[ref];
  if (!chave || !chave.startsWith("$aact_hmlg_")) throw new Error("Credencial sandbox ausente ou incompatível.");
  const contaUnica = process.env['ASAAS_CONNECTED_ACCOUNT_ID'];
  if (!contaUnica || contaUnica !== config.account_id) throw new Error("A conta conectada deste servidor não corresponde ao registro solicitado.");
  const { TransporteHttpAsaas } = await import("./transporte-http.server");
  return new TransporteHttpAsaas({ ambiente: "sandbox", chave });
}

export async function transporteDaConta(accountId: string, operacao: string): Promise<TransporteAsaas> {
  const executor = await bancoExecutor();
  const config = await executor.rpc<ConfigInterna>(ROTINAS_EXECUTOR.config, { _account: accountId, _operacao: operacao });
  return transporteDaConfiguracao(config);
}

export async function transporteDaIntencao(intentId: string, actor: string | null) {
  const executor = await bancoExecutor();
  const config = await executor.rpc<ConfigInterna>(ROTINAS_EXECUTOR.configIntencao, { _intent: intentId, _actor: actor });
  return { executor, transporte: await transporteDaConfiguracao(config), config };
}

export async function transporteDaCobranca(chargeId: string, actor: string | null) {
  const executor = await bancoExecutor();
  const config = await executor.rpc<ConfigInterna>(ROTINAS_EXECUTOR.configCobranca, { _charge: chargeId, _actor: actor });
  return { executor, transporte: await transporteDaConfiguracao(config), config };
}
