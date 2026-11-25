import { createFileRoute } from "@tanstack/react-router";
import { SejaLardanPage } from "@/components/site/seja/SejaLardanPage";
import { paginasLocais } from "@/lib/revenda-local";
import { localHead } from "@/lib/revenda-local-head";

const local = paginasLocais.find((pagina) => pagina.path === "/revenda-de-semijoias-em-apucarana")!;
export const Route = createFileRoute("/revenda-de-semijoias-em-apucarana")({
  head: () => localHead(local),
  component: () => <SejaLardanPage local={local} />,
});
