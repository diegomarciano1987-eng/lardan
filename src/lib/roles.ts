import type { AppRole } from "@/lib/session";

/** Nome legível de cada papel de acesso. */
export const ROLE_LABEL: Record<AppRole, string> = {
  master: "Master",
  diretoria: "Diretoria",
  marketing: "Marketing",
  suporte: "Suporte",
  financeiro: "Financeiro",
  cobranca: "Cobrança",
  estoque: "Estoque",
  montagem: "Montagem",
  qualidade: "Qualidade",
  representante: "Representante",
  consultora: "Consultora",
};
