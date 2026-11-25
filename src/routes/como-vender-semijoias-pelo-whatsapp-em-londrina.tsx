import { createFileRoute } from "@tanstack/react-router";
import { ArtigoEditorial } from "@/components/editorial/ArtigoEditorial";
import { GUIA_WHATSAPP_LONDRINA } from "@/lib/editorial/guias-londrina";
import { headDoGuia } from "@/lib/editorial/head";

export const Route = createFileRoute("/como-vender-semijoias-pelo-whatsapp-em-londrina")({
  head: () => headDoGuia(GUIA_WHATSAPP_LONDRINA),
  component: () => <ArtigoEditorial guia={GUIA_WHATSAPP_LONDRINA} />,
});
