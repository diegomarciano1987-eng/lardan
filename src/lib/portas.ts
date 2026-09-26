import type { AppRole } from "@/lib/session";

export type Porta = "operacao" | "consultora" | "representante";

export const PORTAS: Porta[] = ["operacao", "consultora", "representante"];

const OPERACAO: AppRole[] = [
  "master",
  "diretoria",
  "marketing",
  "suporte",
  "financeiro",
  "cobranca",
  "estoque",
  "montagem",
  "qualidade",
] as AppRole[];

/** Papéis que abrem cada porta do sistema. */
export function portaLiberada(porta: Porta, roles: AppRole[]): boolean {
  if (porta === "operacao") return roles.some((r) => OPERACAO.includes(r));
  if (porta === "consultora") return roles.includes("consultora" as AppRole);
  return roles.includes("representante" as AppRole);
}

export const DESTINO: Record<Porta, "/admin" | "/consultora" | "/representante"> = {
  operacao: "/admin",
  consultora: "/consultora",
  representante: "/representante",
};
