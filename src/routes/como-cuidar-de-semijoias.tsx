import { createFileRoute } from "@tanstack/react-router";
import { ArtigoEditorial } from "@/components/editorial/ArtigoEditorial";
import { GUIA_CUIDADOS } from "@/lib/editorial/guia-cuidados";
import { headDoGuia } from "@/lib/editorial/head";

export const Route = createFileRoute("/como-cuidar-de-semijoias")({
  head: () => headDoGuia(GUIA_CUIDADOS),
  component: () => <ArtigoEditorial guia={GUIA_CUIDADOS} />,
});
