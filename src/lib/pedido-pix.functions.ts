import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validarPixGlobal, type PixPedido } from "./pix-pedido";

export const vincularPixPedidoAsaas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: master, error: erroRole } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "master" });
    if (erroRole || !master) throw new Error("Só o Master vincula o Pix do pedido.");
    const { data: mfa, error: erroMfa } = await context.supabase.rpc("access_mfa_ok");
    if (erroMfa || !mfa) throw new Error("Confirme a autenticação de dois fatores.");
    const { data: salvo, error: erroSalvo } = await context.supabase.rpc("pedido_pix_asaas_ler");
    if (erroSalvo) throw new Error(erroSalvo.message);
    if (salvo) return salvo as unknown as PixPedido;
    const { resolverPorConta, bancoExecutor } = await import("./asaas/servidor.server");
    const { TransporteHttpAsaas } = await import("./asaas/transporte-http.server");
    const accountId = process.env["ASAAS_CONNECTED_ACCOUNT_ID"];
    if (!accountId) throw new Error("Conta Asaas LARDAN não configurada.");
    const resolucao = await resolverPorConta(accountId, context.userId, "finance.receivable.manage");
    if (!resolucao.executavel) throw new Error(resolucao.motivo);
    if (resolucao.transporte.tipo !== "http" || resolucao.transporte.ambiente !== "producao") throw new Error("O pedido exige o Pix da conta de produção.");
    const transporte = new TransporteHttpAsaas({ ...resolucao.transporte, fetch: (url, init) => fetch(url, init) });
    const chave = await transporte.chavePixGlobal();
    const qr = await transporte.criarPixGlobal(chave);
    validarPixGlobal(qr.payload, chave);
    const executor = await bancoExecutor();
    await executor.rpc("pedido_pix_asaas_gravar", { _actor: context.userId, _account: accountId, _qr: qr.id, _chave: chave, _payload: qr.payload });
    const { data, error } = await context.supabase.rpc("pedido_pix_asaas_ler");
    if (error || !data) throw new Error("Não foi possível confirmar o Pix salvo.");
    return data as unknown as PixPedido;
  });