import { describe, expect, it } from "vitest";
import { espalhar, normalizarRua, resultadoNaCidade } from "@/lib/rede/geocode-regras";
import { ondeEsta } from "@/components/admin/rede/CidadeConsultoras";

describe("localização por rua", () => {
  it("expande abreviação e tira número/complemento (número nunca vai ao provedor)", () => {
    expect(normalizarRua("R. LUÍS LERCO, 399 - casa")).toBe("Rua Luís Lerco");
    expect(normalizarRua("AV ANTONIO CAPELO 452")).toBe("Avenida Antonio Capelo");
    expect(normalizarRua("12")).toBeNull();
  });

  it("aceita só resultado de rua dentro da cidade do cadastro", () => {
    const rua = { lat: "-23.37", lon: "-51.13", place_rank: 26, address: { city: "Londrina" } };
    expect(resultadoNaCidade(rua, "LONDRINA")).toEqual({ lat: -23.37, lng: -51.13 });
    expect(resultadoNaCidade({ ...rua, address: { city: "Cambé" } }, "Londrina")).toBeNull();
    expect(resultadoNaCidade({ ...rua, place_rank: 16 }, "Londrina")).toBeNull();
  });

  it("consultoras no mesmo ponto são abertas em leque e nenhuma some", () => {
    const pts = espalhar([1, 2, 3].map((i) => ({ id: i, lat: -23.3, lng: -51.1 })));
    expect(pts).toHaveLength(3);
    expect(new Set(pts.map((p) => `${p.latV}:${p.lngV}`)).size).toBe(3);
  });

  it("sem coordenada ou só com estado/município fica no centro da cidade", () => {
    expect(ondeEsta({ lat: null, precisao: null })).toBe("cidade");
    expect(ondeEsta({ lat: -24, precisao: "estado" })).toBe("cidade");
    expect(ondeEsta({ lat: -23.3, precisao: "cep" })).toBe("cep");
    expect(ondeEsta({ lat: -23.3, precisao: "endereco" })).toBe("rua");
  });
});
