/** Appearance-only pilot. Never grants access or changes operational behavior. */
export const CONSULTORA_GLASS_PILOT_ID = "27b777de-76bf-43ce-b566-af2df4ac8439";

export function mostrarPilotoGlass(userId: string | undefined, aba: string): boolean {
  return userId === CONSULTORA_GLASS_PILOT_ID &&
    ["inicio", "clientes", "pedidos", "maleta", "vitrine", "historico", "indicacoes", "biblioteca", "mais", "novo"].includes(aba);
}