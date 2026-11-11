/** Cria o link do teste logo depois da candidatura nova do site (nunca para reenvio: o link é segredo de quem cadastrou primeiro). */
export async function criarTesteDoSite(protocolo: string, site: { experiencia_venda?: string | undefined; horas_semana?: string | undefined }, aceite: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("candidatura_teste_site", { _protocolo: protocolo, _site: site as never, _aceite: aceite });
  if (error) { console.error("[candidatura] teste do site não criado:", error.message); return null; }
  return (data as string | null) ?? null;
}
