import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/semijoia-folheado-ou-bijuteria")({
  beforeLoad: () => {
    throw redirect({ to: "/guia/semijoia-folheado-ou-bijuteria", statusCode: 301 });
  },
});
