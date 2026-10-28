import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Assina o pedido do QZ Tray (impressão direta Argox). Só usuário logado; a chave privada nunca sai do servidor. */
export const assinarQz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { texto: string }) => {
    if (typeof d?.texto !== "string" || d.texto.length > 20000) throw new Error("Pedido inválido.");
    return d;
  })
  .handler(async ({ data }) => {
    const b64 = process.env.QZ_PRIVATE_KEY;
    if (!b64) throw new Error("Impressão direta não configurada.");
    const der = Uint8Array.from(atob(b64.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(data.texto)));
    let s = ""; for (const b of sig) s += String.fromCharCode(b);
    return { assinatura: btoa(s) };
  });
