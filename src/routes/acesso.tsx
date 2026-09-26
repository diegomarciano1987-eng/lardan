import { createFileRoute, redirect } from "@tanstack/react-router";

// Endereço antigo: o acesso da equipe agora fica em /equipe.
export const Route = createFileRoute("/acesso")({
  beforeLoad: () => {
    throw redirect({ to: "/equipe", replace: true });
  },
});
