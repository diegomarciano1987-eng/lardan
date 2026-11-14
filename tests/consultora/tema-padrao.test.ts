import { describe, expect, it } from "vitest";
import { resolverTemaConsultora } from "@/lib/consultora-tema";
import { mostrarGlassConsultora, mostrarPilotoGlass, CONSULTORA_GLASS_PILOT_ID } from "@/lib/consultora-glass";

describe("tema da consultora", () => {
  it("abre no claro quando nada foi escolhido", () => expect(resolverTemaConsultora(null)).toBe("light"));
  it("respeita o escuro escolhido", () => expect(resolverTemaConsultora("dark")).toBe("dark"));
  it("Financeiro da família não troca a casca do piloto", () => expect(mostrarPilotoGlass(CONSULTORA_GLASS_PILOT_ID, "familia")).toBe(true));
});

describe("modo escuro vidro fumê para todas as consultoras", () => {
  it("consultora comum no claro continua sem a casca de vidro", () =>
    expect(mostrarGlassConsultora("outra-conta", "inicio", "light")).toBe(false));
  it("consultora comum que escolhe escuro recebe o vidro fumê", () =>
    expect(mostrarGlassConsultora("outra-conta", "inicio", "dark")).toBe(true));
  it("piloto mantém o vidro no claro e no escuro", () => {
    expect(mostrarGlassConsultora(CONSULTORA_GLASS_PILOT_ID, "maleta", "light")).toBe(true);
    expect(mostrarGlassConsultora(CONSULTORA_GLASS_PILOT_ID, "maleta", "dark")).toBe(true);
  });
  it("sem sessão ou fora das telas da consultora, nunca", () => {
    expect(mostrarGlassConsultora(undefined, "inicio", "dark")).toBe(false);
    expect(mostrarGlassConsultora("outra-conta", "admin", "dark")).toBe(false);
  });
});
