import { supabase } from "@/integrations/supabase/client";

export interface MyProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  display_name: string | null;
  job_title: string | null;
  phone: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Perfil do usuário logado. Cria o registro no primeiro acesso. */
export async function fetchMyProfile(): Promise<MyProfile | null> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, email, full_name, display_name, job_title, phone, avatar_url, is_active, created_at, updated_at",
    )
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (data) return data as MyProfile;

  const { data: criado, error: insErr } = await supabase
    .from("profiles")
    .insert({ id: user.id, email: user.email ?? null })
    .select(
      "id, email, full_name, display_name, job_title, phone, avatar_url, is_active, created_at, updated_at",
    )
    .single();
  if (insErr) throw insErr;
  return criado as MyProfile;
}

export async function updateMyProfile(patch: {
  full_name?: string | null;
  display_name?: string | null;
  job_title?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
}) {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error("Sessão expirada.");
  const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
  if (error) throw error;
}

/** Envia a foto para o balde privado `avatars`, na pasta do próprio usuário. */
export async function uploadAvatar(file: File) {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error("Sessão expirada.");
  if (file.size > 5 * 1024 * 1024) throw new Error("A imagem deve ter no máximo 5 MB.");

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;

  await updateMyProfile({ avatar_url: path });
  return path;
}

export async function removeAvatar(path: string | null) {
  if (path) await supabase.storage.from("avatars").remove([path]);
  await updateMyProfile({ avatar_url: null });
}

/** Link temporário de leitura da foto (o balde é privado). */
export async function signedAvatarUrl(path: string | null, seconds = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("avatars").createSignedUrl(path, seconds);
  if (error) return null;
  return data.signedUrl;
}

/** Troca de senha com reconferência da senha atual. */
export async function changePassword(current: string, next: string) {
  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email;
  if (!email) throw new Error("Sessão expirada.");
  if (next.length < 8) throw new Error("A nova senha precisa de pelo menos 8 caracteres.");

  const { error: reauth } = await supabase.auth.signInWithPassword({
    email,
    password: current,
  });
  if (reauth) throw new Error("Senha atual incorreta.");

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) throw error;
}
