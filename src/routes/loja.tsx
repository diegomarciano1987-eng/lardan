import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/loja")({
  beforeLoad: () => { throw redirect({ to: "/pdv" }); },
});
