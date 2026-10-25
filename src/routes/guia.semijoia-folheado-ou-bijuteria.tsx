import { createFileRoute } from "@tanstack/react-router";
import { ArtigoEditorial } from "@/components/editorial/ArtigoEditorial";
import { GUIA_COMPARATIVO_SEMIJOIAS } from "@/lib/editorial/guia-comparativo-semijoias";
import { headDoGuia } from "@/lib/editorial/head";

export const Route = createFileRoute("/guia/semijoia-folheado-ou-bijuteria")({
  head: () => headDoGuia(GUIA_COMPARATIVO_SEMIJOIAS),
  component: () => <ArtigoEditorial guia={GUIA_COMPARATIVO_SEMIJOIAS} />,
});