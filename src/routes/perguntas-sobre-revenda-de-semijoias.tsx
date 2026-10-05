import { createFileRoute } from "@tanstack/react-router";
import { ArtigoEditorial } from "@/components/editorial/ArtigoEditorial";
import { GUIA_PERGUNTAS_REVENDA } from "@/lib/editorial/guia-perguntas-revenda";
import { headDoGuia } from "@/lib/editorial/head";

export const Route = createFileRoute("/perguntas-sobre-revenda-de-semijoias")({
  head: () => headDoGuia(GUIA_PERGUNTAS_REVENDA),
  component: () => <ArtigoEditorial guia={GUIA_PERGUNTAS_REVENDA} />,
});
