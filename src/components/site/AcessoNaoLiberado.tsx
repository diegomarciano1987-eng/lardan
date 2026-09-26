import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Tela exibida quando a conta conectada não tem permissão para a área. */
export function AcessoNaoLiberado() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function sair() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/equipe", replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-md text-center">
        <p className="brand-eyebrow mb-4">Sistema Lardan</p>
        <h1 className="font-display text-3xl text-foreground">Acesso não liberado</h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Seu acesso não está liberado para esta área. Se você faz parte da equipe, peça o convite
          ao responsável.
        </p>
        <button
          type="button"
          onClick={() => void sair()}
          className="mt-8 rounded-full bg-primary px-8 py-3 text-[0.75rem] tracking-[0.22em] uppercase text-primary-foreground hover:opacity-90"
        >
          Sair e voltar
        </button>
      </div>
    </main>
  );
}
