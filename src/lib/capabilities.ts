import { createContext, useContext } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Matriz única de permissões. Espelha exatamente public.role_capabilities
 * no banco; a interface apenas esconde o que o banco já recusa.
 */
export type Capability =
  | "catalog.view"
  | "catalog.manage"
  | "catalog.publish"
  | "catalog.cost.view"
  | "stock.view"
  | "stock.operate"
  | "stock.adjust"
  | "stock.cost.view"
  | "imports.run"
  | "finance.view"
  | "finance.operate"
  | "finance.approve"
  | "site.manage"
  | "showcase.view"
  | "showcase.publish"
  | "showcase.bulk"
  | "showcase.home"
  | "showcase.schedule"
  | "users.manage"
  | "audit.view"
  | "partners.view"
  | "partners.manage"
  | "leads.view"
  | "registry.view"
  | "registry.manage"
  | "registry.doc.view"
  | "registry.finance.view";

/** Capacidades do usuário logado, decididas pelo banco (my_capabilities). */
export async function fetchMyCapabilities(): Promise<Capability[]> {
  const { data, error } = await supabase.rpc("my_capabilities");
  if (error) throw error;
  return ((data as { capability: string }[] | null) ?? []).map(
    (r) => r.capability as Capability,
  );
}

export const CapabilitiesContext = createContext<Capability[]>([]);
export const useCapabilities = () => useContext(CapabilitiesContext);

export function can(caps: Capability[], needed: Capability) {
  return caps.includes(needed);
}

export function canAny(caps: Capability[], needed: Capability[]) {
  return needed.some((c) => caps.includes(c));
}
