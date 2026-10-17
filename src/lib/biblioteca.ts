import { supabase } from "@/integrations/supabase/client";

export const BUCKET_BIBLIOTECA = "biblioteca-lardan";
export type Arte = { id: string; titulo: string; legenda: string; formato: "story" | "feed" | "status"; path: string; publicado: boolean; semana: string; created_at: string };
export const FORMATOS: Record<Arte["formato"], string> = { story: "Story (vertical)", feed: "Feed (quadrado)", status: "Status do WhatsApp" };
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "application/pdf": "pdf" };

export async function listarArtes(soPublicadas: boolean) {
  let q = supabase.from("biblioteca_artes").select("*").order("semana", { ascending: false }).order("created_at", { ascending: false }).limit(120);
  if (soPublicadas) q = q.eq("publicado", true);
  const { data, error } = await q;
  if (error) throw error;
  const artes = (data ?? []) as Arte[];
  const urls = artes.length ? (await supabase.storage.from(BUCKET_BIBLIOTECA).createSignedUrls(artes.map((a) => a.path), 3600)).data ?? [] : [];
  return artes.map((a) => ({ ...a, url: urls.find((u) => u.path === a.path)?.signedUrl ?? null }));
}

export async function enviarArte(arq: File, dados: { titulo: string; legenda: string; formato: Arte["formato"]; semana: string }) {
  const ext = EXT[arq.type];
  if (!ext) throw new Error("Envie JPG, PNG, WEBP, MP4 ou PDF.");
  if (arq.size > 25 * 1024 * 1024) throw new Error("Arquivo acima de 25 MB.");
  const path = `${dados.semana}/${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage.from(BUCKET_BIBLIOTECA).upload(path, arq, { contentType: arq.type, upsert: false });
  if (up.error) throw up.error;
  const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
  const r = await supabase.from("biblioteca_artes").insert({ ...dados, titulo: dados.titulo.trim(), legenda: dados.legenda.trim(), path, created_by: uid });
  if (r.error) { await supabase.storage.from(BUCKET_BIBLIOTECA).remove([path]); throw r.error; }
}

export async function publicarArte(id: string, publicado: boolean) {
  const r = await supabase.from("biblioteca_artes").update({ publicado, updated_at: new Date().toISOString() }).eq("id", id);
  if (r.error) throw r.error;
}
