import { createFileRoute, redirect } from "@tanstack/react-router";

/** Endereço curto de campanha: sempre leva à rota canônica da categoria. */
export const Route = createFileRoute("/brincos")({
  beforeLoad: () => {
    throw redirect({ to: "/semijoias/$categoria", params: { categoria: "brincos" }, statusCode: 301 });
  },
});
