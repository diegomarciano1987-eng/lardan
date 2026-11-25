import { createFileRoute } from "@tanstack/react-router";
import { ArtigoEditorial } from "@/components/editorial/ArtigoEditorial";
import { GUIA_PERGUNTAS_REVENDA_LONDRINA } from "@/lib/editorial/guias-londrina";
import { headDoGuia } from "@/lib/editorial/head";

export const Route = createFileRoute("/perguntas-sobre-revenda-de-semijoias-em-londrina")({
  head: () => headDoGuia(GUIA_PERGUNTAS_REVENDA_LONDRINA),
  component: () => <ArtigoEditorial guia={GUIA_PERGUNTAS_REVENDA_LONDRINA} />,
});
