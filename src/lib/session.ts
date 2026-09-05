import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole =
  | "master"
  | "diretoria"
  | "marketing"
  | "suporte"
  | "financeiro"
  | "cobranca"
  | "estoque"
  | "montagem"
  | "qualidade"
  | "representante"
  | "consultora";

/** Sessão do navegador. Nunca decide permissão sozinha: o banco valida tudo. */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
}

/** Papéis do usuário logado, lidos pelo banco (função my_roles). */
export async function fetchMyRoles(): Promise<AppRole[]> {
  const { data, error } = await supabase.rpc("my_roles");
  if (error) throw error;
  return ((data as AppRole[] | null) ?? []).slice();
}

export const CONTENT_ROLES: AppRole[] = ["master", "diretoria", "marketing"];
export const LEAD_ROLES: AppRole[] = ["master", "diretoria", "marketing", "suporte"];

export function hasAny(roles: AppRole[], allowed: AppRole[]) {
  return roles.some((r) => allowed.includes(r));
}
