/** Download do assinado + finalização atômica. Usado pelo aviso e pela reprocessamento. */
import { baixarAssinado, type ModoClicksign } from "./api.server";
import { sha256Hex } from "./termo.server";

export const BUCKET_TERMOS = "termos-maleta";

export async function finalizarAssinado(requestId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: r, error } = await supabaseAdmin
    .from("kit_signature_requests")
    .select("id, cycle_id, estado, modo, envelope_id, document_id")
    .eq("id", requestId)
    .maybeSingle();
  if (error || !r) return { ok: false, erro: "termo não encontrado" };
  if (r.estado === "finalizado") return { ok: true, repetida: true };
  if (r.estado !== "assinado" || !r.envelope_id || !r.document_id) return { ok: false, erro: "termo não assinado" };
  try {
    const bytes = await baixarAssinado(r.modo as Exclude<ModoClicksign, "desligado">, r.envelope_id, r.document_id);
    const sha = await sha256Hex(bytes);
    const caminho = `${r.cycle_id}/${r.id}/assinado.pdf`;
    const up = await supabaseAdmin.storage.from(BUCKET_TERMOS).upload(caminho, bytes, { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error("falha ao guardar o arquivo assinado");
    const fin = await supabaseAdmin.rpc("kit_assinatura_finalizar", { _request: r.id, _signed_path: caminho, _signed_sha256: sha });
    if (fin.error) throw new Error(fin.error.message);
    return { ok: true };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : "falha no download";
    await supabaseAdmin.rpc("kit_assinatura_falha_download", { _request: r.id, _motivo: motivo });
    return { ok: false, erro: motivo };
  }
}
