import { createFileRoute, redirect } from "@tanstack/react-router";

/** Endereço curto de campanha: sempre leva à rota canônica da categoria. */
export const Route = createFileRoute("/pulseiras")({
  beforeLoad: () => {
    throw redirect({ to: "/semijoias/$categoria", params: { categoria: "pulseiras" }, statusCode: 301 });
  },
});
