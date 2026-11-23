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
  if (porta === "operacao") return roles.some((r) => OPERACAO.includes(r)) || somenteLeituraCobranca(roles) || (colab && caps.length > 0);
  if (porta === "consultora") return roles.includes("consultora" as AppRole);
  return roles.includes("representante" as AppRole);
}

export const DESTINO: Record<Porta, "/admin" | "/consultora" | "/representante"> = {
  operacao: "/admin",
  consultora: "/consultora",
  representante: "/representante",
};

/** Quem escreve na Cobrança (espelha cob_pode no banco). */
const COBRANCA_ESCRITA: AppRole[] = ["master", "diretoria", "cobranca", "financeiro"] as AppRole[];

/**
 * Jurídico (Dr. Danilo, 23/11/2026): só enxerga a Cobrança e não altera nada.
 * Vale quando a pessoa tem o papel jurídico e nenhum papel que escreva na Cobrança.
 * A trava de verdade é no banco (cob_pode_ler para ler, cob_pode para escrever).
 */
export function somenteLeituraCobranca(roles: AppRole[]): boolean {
  return roles.includes("juridico" as AppRole) && !roles.some((r) => COBRANCA_ESCRITA.includes(r));
}

/** Caminhos do painel que o jurídico pode abrir: carteira, ficha da devedora e o próprio perfil. */
export function caminhoLiberadoJuridico(pathname: string): boolean {
  if (pathname.startsWith("/admin/cobranca/lote")) return false;
  return pathname === "/admin/cobranca" || pathname.startsWith("/admin/cobranca/") || pathname.startsWith("/admin/perfil");
}

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
