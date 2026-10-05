import { createFileRoute } from "@tanstack/react-router";
import { ArtigoEditorial } from "@/components/editorial/ArtigoEditorial";
import { GUIA_SEMIJOIA_BIJUTERIA } from "@/lib/editorial/guia-semijoia-folheado-bijuteria";
import { headDoGuia } from "@/lib/editorial/head";

export const Route = createFileRoute("/semijoia-folheado-ou-bijuteria")({
  head: () => headDoGuia(GUIA_SEMIJOIA_BIJUTERIA),
  component: () => <ArtigoEditorial guia={GUIA_SEMIJOIA_BIJUTERIA} />,
});
