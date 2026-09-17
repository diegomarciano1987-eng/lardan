import { createFileRoute } from "@tanstack/react-router";
import { ArtigoEditorial } from "@/components/editorial/ArtigoEditorial";
import { GUIA_WHATSAPP } from "@/lib/editorial/guia-whatsapp";
import { headDoGuia } from "@/lib/editorial/head";

export const Route = createFileRoute("/como-vender-semijoias-pelo-whatsapp")({
  head: () => headDoGuia(GUIA_WHATSAPP),
  component: () => <ArtigoEditorial guia={GUIA_WHATSAPP} />,
});
