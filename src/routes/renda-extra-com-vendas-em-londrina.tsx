import { createFileRoute } from "@tanstack/react-router";
import { ArtigoEditorial } from "@/components/editorial/ArtigoEditorial";
import { GUIA_RENDA_EXTRA_LONDRINA } from "@/lib/editorial/guias-londrina";
import { headDoGuia } from "@/lib/editorial/head";

export const Route = createFileRoute("/renda-extra-com-vendas-em-londrina")({
  head: () => headDoGuia(GUIA_RENDA_EXTRA_LONDRINA),
  component: () => <ArtigoEditorial guia={GUIA_RENDA_EXTRA_LONDRINA} />,
});
