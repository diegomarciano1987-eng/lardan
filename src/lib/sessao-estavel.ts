import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { falhaPassageira } from "@/lib/sessao-regras";

// Última pessoa confirmada nesta aba. Serve só para atravessar oscilação de internet;
// o banco valida toda leitura e gravação, então isto nunca concede permissão.
let ultimaConfirmada: User | null = null;
const perfilGarantido = new Set<string>();

export function esquecerSessao() {
  ultimaConfirmada = null;
}

/** Confere a sessão para a porta das áreas internas. null = saiu de verdade. */
export async function conferirSessao(): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser();
  if (data.user) {
    ultimaConfirmada = data.user;
    if (!perfilGarantido.has(data.user.id)) {
      perfilGarantido.add(data.user.id);
      // Garante a ficha do usuário (perfil) no primeiro acesso autenticado desta aba.
      const { error: erroPerfil } = await supabase.rpc("ensure_profile");
      if (erroPerfil) perfilGarantido.delete(data.user.id);
    }
    return data.user;
  }
  if (falhaPassageira(error)) {
    if (ultimaConfirmada) return ultimaConfirmada;
    const { data: local } = await supabase.auth.getSession();
    if (local.session?.user) return local.session.user;
  }
  ultimaConfirmada = null;
  return null;
}
