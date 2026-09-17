import { createFileRoute } from "@tanstack/react-router";
import { ArtigoEditorial } from "@/components/editorial/ArtigoEditorial";
import { GUIA_CONSIGNADO } from "@/lib/editorial/guia-consignado";
import { headDoGuia } from "@/lib/editorial/head";

export const Route = createFileRoute("/semijoias-consignadas-para-revenda")({
  head: () => headDoGuia(GUIA_CONSIGNADO),
  component: () => <ArtigoEditorial guia={GUIA_CONSIGNADO} />,
});
