/**
 * Liga os avisos do Asaas (e-mail, SMS, WhatsApp) no cadastro da cliente em
 * cada conta Asaas vinculada. Vale para os PRÓXIMOS lembretes das cobranças
 * que ela já tem; o Asaas não reenvia avisos que já passaram.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: never; userId: string };

export const ligarAvisosCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { partyId: string }) => {
    if (!d?.partyId) throw new Error("Cliente obrigatória.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const { bancoDe, bancoExecutor, resolverPorConta } = await import("./servidor.server");
    const { transporteDaResolucao } = await import("./configuracao.server");
    const pode = await bancoDe(c.supabase).rpc<boolean>("has_capability", { _user_id: c.userId, _cap: "finance.receivable.manage" });
    if (!pode) throw new Error("Você não tem permissão para alterar avisos do Asaas.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: vinc, error } = await supabaseAdmin
      .from("asaas_customers" as never)
      .select("account_id, external_id")
      .eq("party_id", data.partyId)
      .eq("match_status", "vinculado");
    if (error) throw new Error(error.message);
    const lista = (vinc ?? []) as { account_id: string; external_id: string }[];
    if (!lista.length) return { ligados: 0, falhas: [] as string[], semCadastro: true };

    const contato = await (await bancoExecutor()).rpc<{ email: string | null; celular: string | null }>("asaas_exec_contato", { _party: data.partyId }).catch(() => null);
    let ligados = 0;
    const falhas: string[] = [];
    for (const v of lista) {
      try {
        const r = await resolverPorConta(v.account_id, c.userId, "finance.receivable.manage");
        if (!r.executavel) { falhas.push("A conta Asaas não está conectada agora."); continue; }
        const t = (await transporteDaResolucao(r)) as unknown as { ativarAvisos?: (id: string, d: object) => Promise<void> };
        if (!t.ativarAvisos) { falhas.push("Conta em modo de demonstração: nada foi alterado no Asaas."); continue; }
        await t.ativarAvisos(v.external_id, contato ?? {});
        ligados++;
      } catch (e) {
        falhas.push(e instanceof Error ? e.message : "O Asaas não respondeu.");
      }
    }
    await supabaseAdmin.from("audit_logs" as never).insert({ actor_id: c.userId, action: "asaas.avisos_ligados", entity: "party", entity_id: data.partyId, payload: { ligados, falhas } } as never).then(() => undefined, () => undefined);
    return { ligados, falhas, semCadastro: false };
  });
