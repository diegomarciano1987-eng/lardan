import { createFileRoute } from "@tanstack/react-router";

// Expõe o ID de medição do Google Analytics (valor público por natureza:
// aparece no HTML de qualquer site que use gtag.js). A chave fica salva
// como segredo do projeto e é lida apenas no servidor.
export const Route = createFileRoute("/api/public/ga-config")({
  server: {
    handlers: {
      GET: async () => {
        const id = (process.env["GOOGLE_ANALYTICS_MEASUREMENT_ID"] ?? "").trim();
        return Response.json(
          { id: id || null },
          { headers: { "cache-control": "public, max-age=300" } },
        );
      },
    },
  },
});
