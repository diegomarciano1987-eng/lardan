import { describe, expect, it } from "vitest";
import { resolverTemaConsultora } from "@/lib/consultora-tema";
import { mostrarPilotoGlass, CONSULTORA_GLASS_PILOT_ID } from "@/lib/consultora-glass";

describe("tema da consultora", () => {
  it("abre no claro quando nada foi escolhido", () => expect(resolverTemaConsultora(null)).toBe("light"));
  it("respeita o escuro escolhido", () => expect(resolverTemaConsultora("dark")).toBe("dark"));
  it("Financeiro da família não troca a casca do piloto", () => expect(mostrarPilotoGlass(CONSULTORA_GLASS_PILOT_ID, "familia")).toBe(true));
});
