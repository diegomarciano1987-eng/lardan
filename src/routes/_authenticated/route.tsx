import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/acesso" });
    // Garante a ficha do usuário (perfil) no primeiro acesso autenticado.
    await supabase.rpc("ensure_profile");
    return { user: data.user };
  },
  component: () => <Outlet />,
});
