import { createFileRoute } from "@tanstack/react-router";
import { ArtigoEditorial } from "@/components/editorial/ArtigoEditorial";
import { GUIA_COMECAR_VENDER } from "@/lib/editorial/guia-comecar-vender";
import { headDoGuia } from "@/lib/editorial/head";

export const Route = createFileRoute("/como-comecar-a-vender-semijoias")({
  head: () => headDoGuia(GUIA_COMECAR_VENDER),
  component: () => <ArtigoEditorial guia={GUIA_COMECAR_VENDER} />,
});
