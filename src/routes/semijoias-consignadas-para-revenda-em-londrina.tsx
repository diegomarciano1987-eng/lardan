import { createFileRoute } from "@tanstack/react-router";
import { ArtigoEditorial } from "@/components/editorial/ArtigoEditorial";
import { GUIA_CONSIGNADO_LONDRINA } from "@/lib/editorial/guias-londrina";
import { headDoGuia } from "@/lib/editorial/head";

export const Route = createFileRoute("/semijoias-consignadas-para-revenda-em-londrina")({
  head: () => headDoGuia(GUIA_CONSIGNADO_LONDRINA),
  component: () => <ArtigoEditorial guia={GUIA_CONSIGNADO_LONDRINA} />,
});
