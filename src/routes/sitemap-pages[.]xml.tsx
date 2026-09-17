import { createFileRoute } from "@tanstack/react-router";
import { CABECALHOS_XML, urlsPaginas, xmlUrlset } from "@/lib/sitemap";

export const Route = createFileRoute("/sitemap-pages.xml")({
  server: {
    handlers: {
      GET: async () =>
        new Response(xmlUrlset(await urlsPaginas()), { headers: CABECALHOS_XML }),
    },
  },
});
