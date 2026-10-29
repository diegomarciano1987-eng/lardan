import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Assina o pedido do QZ Tray (impressão direta Argox). Só usuário logado; a chave privada nunca sai do servidor. */
export const assinarQz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { texto: string }) => {
    if (typeof d?.texto !== "string" || d.texto.length > 20000) throw new Error("Pedido inválido.");
    return d;
  })
  .handler(async ({ data, context }) => {
    // Só a equipe que imprime etiquetas (maletas, catálogo, estoque) recebe assinatura: com ela qualquer página
    // conseguiria mandar comandos para a Argox de uma estação Lardan sem o aviso do QZ Tray.
    const uid = context.userId;
    const [kits, catalogo, estoque, diretoria, master] = await Promise.all([
      context.supabase.rpc("can_manage_kits", { _user_id: uid }),
      context.supabase.rpc("can_manage_catalog", { _user_id: uid }),
      context.supabase.rpc("has_role", { _user_id: uid, _role: "estoque" }),
      context.supabase.rpc("has_role", { _user_id: uid, _role: "diretoria" }),
      context.supabase.rpc("has_role", { _user_id: uid, _role: "master" }),
    ]);
    if (![kits, catalogo, estoque, diretoria, master].some((r) => !r.error && r.data === true)) {
      throw new Error("Sem permissão para impressão direta.");
    }
    const b64 = process.env["QZ_PRIVATE_KEY"];
    if (!b64) throw new Error("Impressão direta não configurada.");
    const der = Uint8Array.from(atob(b64.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(data.texto)));
    let s = ""; for (const b of sig) s += String.fromCharCode(b);
    return { assinatura: btoa(s) };
  });
