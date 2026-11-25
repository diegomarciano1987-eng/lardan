import { createFileRoute } from "@tanstack/react-router";
import { ArtigoEditorial } from "@/components/editorial/ArtigoEditorial";
import { GUIA_COMPARATIVO_SEMIJOIAS_LONDRINA } from "@/lib/editorial/guias-londrina";
import { headDoGuia } from "@/lib/editorial/head";

export const Route = createFileRoute("/guia/semijoia-folheado-ou-bijuteria-em-londrina")({
  head: () => headDoGuia(GUIA_COMPARATIVO_SEMIJOIAS_LONDRINA),
  component: () => <ArtigoEditorial guia={GUIA_COMPARATIVO_SEMIJOIAS_LONDRINA} />,
});