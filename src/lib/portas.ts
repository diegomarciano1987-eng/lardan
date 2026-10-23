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

/**
 * Papéis que abrem cada porta do sistema.
 * Colaboradora com acesso por código (colab = meu_acesso_colab()) entra pelos módulos liberados.
 * Consultora e representante também têm permissões (kit.view, kit.accept…), mas não são da operação:
 * por isso só permissões não bastam (0136).
 */
export function portaLiberada(porta: Porta, roles: AppRole[], caps: string[] = [], colab = false): boolean {
  if (porta === "operacao") return roles.some((r) => OPERACAO.includes(r)) || (colab && caps.length > 0);
  if (porta === "consultora") return roles.includes("consultora" as AppRole);
  return roles.includes("representante" as AppRole);
}

export const DESTINO: Record<Porta, "/admin" | "/consultora" | "/representante"> = {
  operacao: "/admin",
  consultora: "/consultora",
  representante: "/representante",
};

/** Colaboradora por código: sem papel de equipe, só módulos liberados. */
export function soModulos(roles: AppRole[]): boolean {
  return !roles.some((r) => OPERACAO.includes(r));
}

/** Tela inicial da operação: colaboradora com maletas abre direto em Maletas. */
export function inicioOperacao(roles: AppRole[], caps: string[]): string {
  if (!soModulos(roles)) return "/admin";
  if (caps.includes("kit.view")) return "/admin/maletas";
  if (caps.includes("registry.view")) return "/admin/cadastros/pessoas";
  if (caps.includes("catalog.view")) return "/admin/cadastros/produtos";
  if (caps.includes("collection.view")) return "/admin/cobranca";
  if (caps.includes("candidaturas.view")) return "/admin/candidaturas";
  return "/admin/maletas";
}
