import { createFileRoute, redirect } from "@tanstack/react-router";

/** Endereço antigo: abre "Pagar e receber" já em A receber, preservando período e busca. */
export const Route = createFileRoute("/_authenticated/admin/financeiro/receber")({
  validateSearch: (s: Record<string, unknown>) => s,
  beforeLoad: ({ search }) => {
    const s = search as Record<string, unknown>;
    const str = (k: string) => (typeof s[k] === "string" && s[k] ? (s[k] as string) : undefined);
    throw redirect({
      to: "/admin/financeiro/pagar-receber",
      search: {
        natureza: "receber",
        ...(str("de") ? { de: str("de") } : {}),
        ...(str("ate") ? { ate: str("ate") } : {}),
        ...(str("busca") ? { busca: str("busca") } : {}),
        ...(s["visao"] === "parcela" ? {} : str("busca") ? { visao: "titulo" as const } : {}),
      } as never,
      replace: true,
    });
  },
});
