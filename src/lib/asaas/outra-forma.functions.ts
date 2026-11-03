/** "Pago por outra forma": baixa oficial + cancelamento da cobrança no Asaas. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = (f: string, a: object) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
type Ctx = { supabase: { rpc: Rpc }; userId: string };
const BUCKET = "extratos-bancarios";
const FORMAS = ["pix", "dinheiro", "transferencia", "cartao_maquininha", "outro"] as const;

export const marcarPagoOutraForma = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { chargeId: string; contaId: string; data: string; valorCents: number; forma: string; observacao?: string;
    arquivo?: { nome: string; tipo: string; base64: string } | null }) => {
    if (!/^[0-9a-f-]{36}$/i.test(d?.chargeId ?? "") || !/^[0-9a-f-]{36}$/i.test(d?.contaId ?? "")) throw new Error("Escolha a conta onde o dinheiro entrou.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.data)) throw new Error("Informe a data do pagamento.");
    if (!Number.isInteger(d.valorCents) || d.valorCents <= 0) throw new Error("Informe o valor recebido.");
    if (!(FORMAS as readonly string[]).includes(d.forma)) throw new Error("Escolha a forma de pagamento.");
    if (d.arquivo) {
      if (!/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(d.arquivo.tipo)) throw new Error("Comprovante: envie foto (PNG/JPG) ou PDF.");
      if (d.arquivo.base64.length > 14_000_000) throw new Error("Comprovante maior que 10 MB.");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const pode = await c.supabase.rpc("asaas_ator_pode", { _actor: c.userId, _cap: "finance.receivable.manage" });
    if (pode.error || !pode.data) throw new Error("Sem acesso ao financeiro para dar baixa.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let caminho: string | null = null;
    if (data.arquivo) {
      const ext = data.arquivo.tipo === "application/pdf" ? "pdf" : data.arquivo.tipo.split("/")[1];
      caminho = `asaas-outra-forma/${data.chargeId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const bin = Uint8Array.from(atob(data.arquivo.base64), (ch) => ch.charCodeAt(0));
      const up = await supabaseAdmin.storage.from(BUCKET).upload(caminho, bin, { contentType: data.arquivo.tipo });
      if (up.error) throw new Error("Não foi possível guardar o comprovante: " + up.error.message);
    }
    const r = await c.supabase.rpc("asaas_pago_outra_forma", {
      _charge: data.chargeId, _conta: data.contaId, _data: data.data, _valor: data.valorCents, _forma: data.forma,
      _comprovante: caminho, _obs: data.observacao ?? null,
    });
    if (r.error) {
      if (caminho) await supabaseAdmin.storage.from(BUCKET).remove([caminho]);
      throw new Error(r.error.message);
    }
    const baixa = r.data as { id: string };
    return { baixaId: baixa.id, ...(await cancelar(baixa.id, c.userId)) };
  });

async function cancelar(baixaId: string, actor: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: b } = await supabaseAdmin.from("asaas_baixas_outra_forma").select("charge_id, cancel_status").eq("id", baixaId).maybeSingle();
  if (!b) throw new Error("Baixa não encontrada.");
  if (b.cancel_status === "cancelado") return { cancelado: true, erro: null as string | null };
  const { data: ch } = await supabaseAdmin.from("asaas_charges").select("external_id").eq("id", b.charge_id).maybeSingle();
  const { cancelarNoAsaas } = await import("./cancelar.server");
  const r = await cancelarNoAsaas(b.charge_id, ch?.external_id ?? "", actor);
  const rpc = supabaseAdmin.rpc as unknown as Rpc;
  await rpc("asaas_outra_forma_cancelamento", { _id: baixaId, _ok: r.ok, _erro: r.erro });
  return { cancelado: r.ok, erro: r.erro };
}

export const retentarCancelamentoOutraForma = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { baixaId: string }) => { if (!/^[0-9a-f-]{36}$/i.test(d?.baixaId ?? "")) throw new Error("Baixa inválida."); return d; })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const pode = await c.supabase.rpc("asaas_ator_pode", { _actor: c.userId, _cap: "finance.receivable.manage" });
    if (pode.error || !pode.data) throw new Error("Sem acesso ao financeiro.");
    return cancelar(data.baixaId, c.userId);
  });
