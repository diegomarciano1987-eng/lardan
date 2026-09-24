import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/tmp-ar-load")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (request.headers.get("x-k") !== "k9f2ar77x1q") return new Response("no", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const body = (await request.json()) as { op: string; rows?: unknown[] };
        if (body.op === "load") {
          const { error } = await supabaseAdmin
            .from("financial_import_ar_stage" as never)
            .upsert(body.rows as never, { onConflict: "chave", ignoreDuplicates: true });
          return Response.json({ error: error?.message ?? null });
        }
        const { data, error } = await supabaseAdmin.rpc(
          "fin_import_ar_apply" as never,
          { _lote: "ar-2026-09-24", _limite: 400 } as never,
        );
        return Response.json({ data, error: error?.message ?? null });
      },
    },
  },
});
