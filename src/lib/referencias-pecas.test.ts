import { describe, expect, test } from "vitest";
import { comReferencia } from "./referencias-pecas";
import { casaBusca, comCodigo, pareceCodigoMaleta } from "./busca-maletas";

describe("referência sempre junto do nome da peça", () => {
  test("referência vem na frente do nome", () => expect(comReferencia("LAN0353", "Anel Gota")).toBe("LAN0353 · Anel Gota"));
  test("peça sem referência diz isso, nunca some", () => expect(comReferencia(null, "Anel Gota")).toBe("Sem referência · Anel Gota"));
  test("não repete quando o nome já começa pela referência", () => expect(comReferencia("LAN0353", "LAN0353 · Anel")).toBe("LAN0353 · Anel"));
});

describe("busca de maleta", () => {
  test("código da consultora ao lado do nome", () => expect(comCodigo("Isabela", "7510")).toBe("[Cód. 7510] Isabela"));
  test("etiqueta/número confirmam direto; nome não", () => {
    expect(pareceCodigoMaleta("MAL-00467")).toBe(true);
    expect(pareceCodigoMaleta("Isabela")).toBe(false);
    expect(pareceCodigoMaleta("7510")).toBe(false);
  });
  test("467 acha MAL-00467; nome por partes sem acento", () => {
    expect(casaBusca("467", ["MAL-00467"])).toBe(true);
    expect(casaBusca("isabela rodrigues", ["Isabéla Aparecida Rodrigues"])).toBe(true);
    expect(casaBusca("7510", ["Ana", "7511"])).toBe(false);
  });
});
