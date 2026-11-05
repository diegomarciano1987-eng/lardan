/**
 * Aviso da ZapSign — POST /api/public/zapsign/webhook?chave=<ZAPSIGN_WEBHOOK_SECRET>
 * Cadastrar na ZapSign (Configurações › Integração › Webhooks) com a chave na URL.
 * O conteúdo do aviso NÃO é confiado: o servidor consulta o documento na API
 * da ZapSign e só então atualiza. Documento criado no painel é ligado ao cadastro
 * de quem assinou (CPF, telefone ou e-mail); assinado ganha cópia própria (0228).
 */
import { createFileRoute } from "@tanstack/react-router";

const TAMANHO_MAXIMO = 256 * 1024;

export const Route = createFileRoute("/api/public/zapsign/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { timingSafeEqual } = await import("node:crypto");
        const segredo = process.env["ZAPSIGN_WEBHOOK_SECRET"];
        if (!segredo) return new Response("Não configurado.", { status: 503 });
        const recebido = Buffer.from(new URL(request.url).searchParams.get("chave") ?? "", "utf8");
        const esperado = Buffer.from(segredo, "utf8");
        if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) return new Response("Não autorizado.", { status: 401 });

        const bruto = await request.text();
        if (bruto.length > TAMANHO_MAXIMO) return new Response("Payload grande demais.", { status: 413 });
        let corpo: Record<string, unknown>;
        try {
          const valor: unknown = JSON.parse(bruto);
          if (!valor || typeof valor !== "object" || Array.isArray(valor)) throw new Error("Payload inválido.");
          corpo = valor as Record<string, unknown>;
        } catch { return new Response("Payload inválido.", { status: 400 }); }
        const token = String(corpo["token"] ?? (corpo["doc"] as { token?: string } | undefined)?.token ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(token)) return new Response("ok", { status: 200 });

        try {
          // fonte da verdade: a API, não o aviso. Conhecido → atualiza; do painel → liga a quem assinou; assinado → guarda cópia.
          const { importarDocumento } = await import("@/lib/zapsign/documentos.server");
          await importarDocumento(token);
        } catch {
          return new Response("Falha ao consultar a ZapSign.", { status: 502 });
        }
        return new Response("ok", { status: 200 });
      },
    },
  },
});
