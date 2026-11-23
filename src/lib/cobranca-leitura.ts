import { useAdminRoles } from "@/components/admin/AdminShell";
import { somenteLeituraCobranca } from "@/lib/portas";

/** true para o jurídico: a Cobrança aparece inteira, mas sem botões que alteram algo. */
export function useCobrancaSomenteLeitura(): boolean {
  return somenteLeituraCobranca(useAdminRoles());
}
