import { supabase } from "@/integrations/supabase/client";

export type TipoAviso = "novidade" | "aviso" | "promocao";
export type Aviso = {
  id: string;
  titulo: string;
  corpo: string;
  tipo: TipoAviso;
  critico: boolean;
  imagem_path: string | null;
  link_url: string | null;
  link_rotulo: string | null;
  status: "rascunho" | "publicado" | "arquivado";
  inicio_em: string;
  fim_em: string | null;
  created_at: string;
};
export type AvisoConsultora = Aviso & { imagem_url: string | null; lido: boolean; ciente: boolean };
export type LinhaRelatorio = { user_id: string; nome: string; email: string; lido_em: string | null; ciente_em: string | null };

export const ROTULO_TIPO: Record<TipoAviso, string> = { novidade: "Novidade", aviso: "Aviso", promocao: "Promoção" };

const tab = () => supabase.from("consultant_announcements" as never);

export async function urlsImagens(paths: string[]): Promise<Record<string, string>> {
  const limpos = [...new Set(paths.filter(Boolean))];
  if (!limpos.length) return {};
  const { data } = await supabase.storage.from("avisos").createSignedUrls(limpos, 3600);
  const m: Record<string, string> = {};
  (data ?? []).forEach((d) => { if (d.path && d.signedUrl) m[d.path] = d.signedUrl; });
  return m;
}

/** Avisos publicados e vigentes para a consultora logada, com leitura/ciência. */
export async function meusAvisos(): Promise<AvisoConsultora[]> {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await tab().select("*").eq("status", "publicado").order("inicio_em", { ascending: false }).limit(50);
  if (error) throw error;
  const avisos = (data ?? []) as unknown as Aviso[];
  const { data: lidas } = await supabase
    .from("consultant_announcement_reads" as never)
    .select("announcement_id, ciente_em")
    .eq("user_id", u.user?.id ?? "");
  const mapa = new Map(((lidas ?? []) as { announcement_id: string; ciente_em: string | null }[]).map((l) => [l.announcement_id, l]));
  const urls = await urlsImagens(avisos.map((a) => a.imagem_path ?? ""));
  return avisos.map((a) => ({
    ...a,
    imagem_url: a.imagem_path ? urls[a.imagem_path] ?? null : null,
    lido: mapa.has(a.id),
    ciente: !!mapa.get(a.id)?.ciente_em,
  }));
}

export async function registrarAviso(id: string, ciente: boolean) {
  const disp = typeof navigator !== "undefined" ? navigator.userAgent : null;
  const { error } = await supabase.rpc("aviso_registrar" as never, { _id: id, _ciente: ciente, _dispositivo: disp } as never);
  if (error) throw error;
}

/* ---------- gestão ---------- */

export async function listarAvisosGestao(): Promise<(Aviso & { imagem_url: string | null })[]> {
  const { data, error } = await tab().select("*").order("created_at", { ascending: false });
  if (error) throw error;
  const avisos = (data ?? []) as unknown as Aviso[];
  const urls = await urlsImagens(avisos.map((a) => a.imagem_path ?? ""));
  return avisos.map((a) => ({ ...a, imagem_url: a.imagem_path ? urls[a.imagem_path] ?? null : null }));
}

export async function salvarAviso(a: Partial<Aviso>) {
  const linha = {
    titulo: (a.titulo ?? "").trim(), corpo: a.corpo ?? "", tipo: a.tipo ?? "novidade", critico: !!a.critico,
    imagem_path: a.imagem_path ?? null, link_url: a.link_url?.trim() || null, link_rotulo: a.link_rotulo?.trim() || null,
    status: a.status ?? "rascunho", inicio_em: a.inicio_em ?? new Date().toISOString(), fim_em: a.fim_em ?? null,
  };
  const r = a.id ? await tab().update(linha as never).eq("id", a.id) : await tab().insert(linha as never);
  if (r.error) throw r.error;
}

export async function enviarImagemAviso(arquivo: File): Promise<string> {
  if (!arquivo.type.startsWith("image/")) throw new Error("Escolha uma imagem.");
  if (arquivo.size > 8 * 1024 * 1024) throw new Error("A imagem passa de 8 MB.");
  const ext = (arquivo.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("avisos").upload(path, arquivo, { contentType: arquivo.type });
  if (error) throw error;
  return path;
}

export async function relatorioAviso(id: string): Promise<LinhaRelatorio[]> {
  const { data, error } = await supabase.rpc("aviso_relatorio" as never, { _id: id } as never);
  if (error) throw error;
  return (data ?? []) as unknown as LinhaRelatorio[];
}
