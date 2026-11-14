/** Appearance-only. Never grants access or changes operational behavior. */
export const CONSULTORA_GLASS_PILOT_ID = "27b777de-76bf-43ce-b566-af2df4ac8439";

const ABAS_GLASS = ["inicio", "clientes", "pedidos", "maleta", "vitrine", "historico", "indicacoes", "biblioteca", "mais", "novo", "jornada", "liga", "financeiro", "vendas", "vendidos", "familia"];

export function mostrarPilotoGlass(userId: string | undefined, aba: string): boolean {
  return userId === CONSULTORA_GLASS_PILOT_ID && ABAS_GLASS.includes(aba);
}

/**
 * Casca de vidro do app da consultora.
 * Piloto (Diego Silva): vidro no claro e no escuro, como aprovado.
 * Demais consultoras: o claro continua o visual de sempre; o vidro fumê escuro entra só quando ela escolhe "Modo escuro".
 */
export function mostrarGlassConsultora(userId: string | undefined, aba: string, tema: "dark" | "light"): boolean {
  if (!userId || !ABAS_GLASS.includes(aba)) return false;
  return userId === CONSULTORA_GLASS_PILOT_ID || tema === "dark";
}
