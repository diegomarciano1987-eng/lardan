import { createFileRoute } from "@tanstack/react-router";
import { SejaLardanPage } from "@/components/site/seja/SejaLardanPage";
import { paginasLocais } from "@/lib/revenda-local";
import { localHead } from "@/lib/revenda-local-head";

const local = paginasLocais.find((pagina) => pagina.path === "/renda-extra-com-semijoias-em-londrina")!;
export const Route = createFileRoute("/renda-extra-com-semijoias-em-londrina")({
  head: () => localHead(local),
  component: () => <SejaLardanPage local={local} />,
});
