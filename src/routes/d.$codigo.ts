import { createFileRoute } from "@tanstack/react-router";

/**
 * LARDAN — endereço curto do dossiê da candidatura.
 *
 * O representante recebe apenas https://www.lardan.com.br/d/XXXXXXXXXXXX.
 * O arquivo continua em balde privado: aqui o servidor confere o código,
 * a validade e o cancelamento, e entrega o PDF sem nunca expor o caminho
 * interno nem o link assinado. Cada abertura fica registrada.
 */
export const Route = createFileRoute("/d/$codigo")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const codigo = params.codigo;
        const recusa = () =>
          new Response("Link inválido ou expirado.", {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
          });

        if (!/^[0-9A-Za-z]{8,24}$/.test(codigo)) return recusa();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: link } = await supabaseAdmin
          .from("dossie_links")
          .select("code, storage_path, expires_at, revoked_at, opened_count")
          .eq("code", codigo)
          .maybeSingle();

        if (!link || link.revoked_at || new Date(link.expires_at).getTime() < Date.now()) {
          return recusa();
        }

        const { data: arquivo, error } = await supabaseAdmin.storage
          .from("candidaturas")
          .download(link.storage_path);
        if (error || !arquivo) return recusa();

        await supabaseAdmin
          .from("dossie_links")
          .update({ opened_count: (link.opened_count ?? 0) + 1, last_opened_at: new Date().toISOString() })
          .eq("code", link.code);

        return new Response(await arquivo.arrayBuffer(), {
          headers: {
            "content-type": "application/pdf",
            "content-disposition": 'inline; filename="candidatura-lardan.pdf"',
            "cache-control": "no-store, private",
            "x-robots-tag": "noindex, nofollow",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
