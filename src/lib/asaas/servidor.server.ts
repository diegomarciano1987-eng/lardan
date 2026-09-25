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

import {
  envDoServidor,
  IntegracaoIndisponivel,
  resolverConta,
  transporteDaResolucao,
  type Resolucao,
  type SituacaoBanco,
} from "./configuracao.server";

/** Configuração interna vinda do banco (asaas_exec_config*): só referência de segredo. */
export interface ConfigInterna {
  account_id: string;
  state: string;
  modo: "simulado" | "conectado";
  ambiente: "sandbox" | "producao" | null;
  secret_ref: string | null;
  external_account_id: string | null;
  invoice_host_confirmed: boolean;
}

const deConfig = (c: ConfigInterna): SituacaoBanco => ({
  ok: true,
  situacao: c.state === "simulada" ? "simulada" : c.state === "producao_conectada" ? "producao_configurado" : "sandbox_configurado",
  account_id: c.account_id, state: c.state, modo: c.modo, ambiente: c.ambiente, secret_ref: c.secret_ref,
  invoice_host_confirmed: c.invoice_host_confirmed,
});

async function exigir(r: Resolucao) {
  if (!r.executavel) throw new IntegracaoIndisponivel(r.motivo, r.situacao);
  return transporteDaResolucao(r);
}

export async function transporteDaConfiguracao(config: ConfigInterna): Promise<TransporteAsaas> {
  return exigir(resolverConta(deConfig(config), envDoServidor()));
}

/** Preflight da parcela: conta derivada de parcela → título → empresa. Sem efeito. */
export async function resolverPorParcela(installmentId: string, actor: string): Promise<Resolucao> {
  const executor = await bancoExecutor();
  const sit = await executor.rpc<SituacaoBanco>(ROTINAS_EXECUTOR.preflightParcela, { _installment: installmentId, _actor: actor });
  return resolverConta(sit, envDoServidor());
}

/** Preflight de conta (importação / leitura). Sem efeito. */
export async function resolverPorConta(accountId: string, actor: string, cap: "finance.import.run" | "finance.receivable.manage" | "finance.receivable.view"): Promise<Resolucao> {
  const executor = await bancoExecutor();
  const sit = await executor.rpc<SituacaoBanco>(ROTINAS_EXECUTOR.preflightConta, { _account: accountId, _actor: actor, _cap: cap });
  return resolverConta(sit, envDoServidor());
}

export async function contasResolvidas(actor: string) {
  const executor = await bancoExecutor();
  const lista = await executor.rpc<(SituacaoBanco & { nome: string; account_id: string })[]>(ROTINAS_EXECUTOR.contas, { _actor: actor });
  const env = envDoServidor();
  return lista.map((b) => ({ id: b.account_id, nome: b.nome, r: resolverConta(b, env) }));
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
