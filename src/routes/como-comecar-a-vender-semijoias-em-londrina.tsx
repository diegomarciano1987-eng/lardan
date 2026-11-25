import { createFileRoute } from "@tanstack/react-router";
import { ArtigoEditorial } from "@/components/editorial/ArtigoEditorial";
import { GUIA_COMECAR_VENDER_LONDRINA } from "@/lib/editorial/guias-londrina";
import { headDoGuia } from "@/lib/editorial/head";

export const Route = createFileRoute("/como-comecar-a-vender-semijoias-em-londrina")({
  head: () => headDoGuia(GUIA_COMECAR_VENDER_LONDRINA),
  component: () => <ArtigoEditorial guia={GUIA_COMECAR_VENDER_LONDRINA} />,
});
