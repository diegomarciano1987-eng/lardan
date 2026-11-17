/**
 * 0332 — foto (opcional) da promissória assinada no papel. O banco confere quem pode e registra
 * (promissoria_papel_registrar, com a sessão do usuário); só depois o servidor guarda a foto no
 * armazenamento privado "assinaturas" e anota o caminho. Sem foto, o registro vale do mesmo jeito.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const UUID = /^[0-9a-f-]{36}$/i;
const MAX_BYTES = 6 * 1024 * 1024;

export const promissoriaPapelComFoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { rep: string | null; cycleId: string; foto?: string | null; tipo?: string | null; obs?: string | null }) => {
    if (!UUID.test(d?.cycleId ?? "")) throw new Error("Maleta inválida.");
    if (d.rep && !UUID.test(d.rep)) throw new Error("Representante inválido.");
    const tipo = d.tipo === "image/png" ? "image/png" : d.tipo === "image/webp" ? "image/webp" : "image/jpeg";
    if (d.foto && d.foto.length > Math.ceil(MAX_BYTES * 1.37)) throw new Error("Foto grande demais (máximo 6 MB).");
    return { rep: d.rep ?? null, cycleId: d.cycleId, foto: d.foto ?? null, tipo, obs: (d.obs ?? "").slice(0, 500) || null };
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as { supabase: { rpc: Rpc } };
    const { data: r, error } = await c.supabase.rpc("promissoria_papel_registrar", { _rep: data.rep, _cycle: data.cycleId, _obs: data.obs });
    if (error) throw new Error(error.message);
    const reg = r as { id: string; repetida: boolean; party_id: string };
    let foto = false;
    if (data.foto) {
      const bytes = Uint8Array.from(atob(data.foto), (ch) => ch.charCodeAt(0));
      if (bytes.length > MAX_BYTES) throw new Error("Foto grande demais (máximo 6 MB).");
      const ext = data.tipo === "image/png" ? "png" : data.tipo === "image/webp" ? "webp" : "jpg";
      const caminho = `${reg.party_id}/promissoria-papel/${data.cycleId}-${reg.id}.${ext}`;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const up = await supabaseAdmin.storage.from("assinaturas").upload(caminho, bytes, { contentType: data.tipo, upsert: true });
      if (!up.error) {
        const u = await supabaseAdmin.from("promissorias_papel" as never).update({ foto_path: caminho } as never).eq("id" as never, reg.id as never);
        foto = !u.error;
      }
    }
    return { id: reg.id, repetida: reg.repetida, foto };
  });
