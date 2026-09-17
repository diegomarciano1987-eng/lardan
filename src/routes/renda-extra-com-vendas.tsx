import { createFileRoute } from "@tanstack/react-router";
import { ArtigoEditorial } from "@/components/editorial/ArtigoEditorial";
import { GUIA_RENDA_EXTRA } from "@/lib/editorial/guia-renda-extra";
import { headDoGuia } from "@/lib/editorial/head";

export const Route = createFileRoute("/renda-extra-com-vendas")({
  head: () => headDoGuia(GUIA_RENDA_EXTRA),
  component: () => <ArtigoEditorial guia={GUIA_RENDA_EXTRA} />,
});
