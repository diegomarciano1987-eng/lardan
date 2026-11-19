import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { conferirSessao } from "@/lib/sessao-estavel";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // 0358: oscilação de internet não derruba quem está trabalhando; só sai quem saiu de verdade.
    const user = await conferirSessao();
    if (!user) throw redirect({ to: "/equipe" });
    return { user };
  },
  component: () => <Outlet />,
});
