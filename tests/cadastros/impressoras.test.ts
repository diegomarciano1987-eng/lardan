import { describe, expect, it } from "vitest";
import { destinoDocumento, normalizarImpressoras } from "../../src/lib/impressoras";
import { validarPixGlobal } from "../../src/lib/pix-pedido";
import { TransporteHttpAsaas } from "../../src/lib/asaas/transporte-http.server";

describe("Impressoras separadas da estação", () => {
  it("pedido, romaneio e promissória usam A4", () => {
    for (const tipo of ["pedido", "romaneio", "promissoria"] as const) expect(destinoDocumento(tipo)).toBe("a4");
  });
  it("etiquetas usam o segundo destino sem trocar a A4", () => {
    expect(destinoDocumento("etiqueta")).toBe("etiquetas");
    expect(normalizarImpressoras({ a4: " HP A4 ", etiquetas: " Argox " })).toEqual({ a4: "HP A4", etiquetas: "Argox" });
  });
  it("não inventa impressoras quando não configuradas", () => {
    expect(normalizarImpressoras(null)).toEqual({ a4: "", etiquetas: "" });
    expect(normalizarImpressoras({ a4: 123, etiquetas: false })).toEqual({ a4: "", etiquetas: "" });
  });
});
const campo = (id: string, v: string) => id + String(v.length).padStart(2, "0") + v;
function payload(chave: string, valor?: string) {
  let s = campo("00", "01") + campo("26", campo("00", "br.gov.bcb.pix") + campo("01", chave)) + campo("52", "0000") + campo("53", "986") + (valor ? campo("54", valor) : "") + campo("58", "BR") + campo("59", "FAVORECIDO TESTE") + campo("60", "IBIPORA") + "6304";
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(s)) { crc ^= byte << 8; for (let i=0;i<8;i++) crc=((crc<<1)^((crc&0x8000)?0x1021:0))&0xffff; }
  return s + crc.toString(16).padStart(4,"0").toUpperCase();
}
describe("Pix global oficial", () => {
  it("aceita Pix sem valor e exige a chave consultada", () => {
    expect(validarPixGlobal(payload("CHAVE-TESTE"), "CHAVE-TESTE")).toEqual({ favorecido: "FAVORECIDO TESTE", cidade: "IBIPORA" });
    expect(() => validarPixGlobal(payload("OUTRA"), "CHAVE-TESTE")).toThrow("chave oficial");
  });
  it("não imprime QR com valor fixo nem verificação adulterada", () => {
    expect(() => validarPixGlobal(payload("CHAVE-TESTE", "299.22"), "CHAVE-TESTE")).toThrow("sem valor fixo");
    expect(() => validarPixGlobal(payload("CHAVE-TESTE").slice(0,-4)+"0000", "CHAVE-TESTE")).toThrow("Verificação Pix inválida");
  });
  it("consulta única chave ativa e cria QR reutilizável sem valor ou vencimento", async () => {
    const chamadas: { path: string; method: string; body: unknown }[] = [];
    const t = new TransporteHttpAsaas({ ambiente: "sandbox", chave: "teste", fetch: async (url, init) => {
      chamadas.push({ path: new URL(url).pathname, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
      return Response.json(init.method === "GET" ? { data: [{ key: "CHAVE-TESTE", status: "ACTIVE" }], hasMore: false } : { id: "qr-teste", payload: payload("CHAVE-TESTE") });
    } });
    expect(await t.chavePixGlobal()).toBe("CHAVE-TESTE");
    expect((await t.criarPixGlobal("CHAVE-TESTE")).id).toBe("qr-teste");
    expect(chamadas[1]).toEqual({ path: "/v3/pix/qrCodes/static", method: "POST", body: { addressKey: "CHAVE-TESTE", format: "ALL", allowsMultiplePayments: true, externalReference: "lardan:pedido:pix-global" } });
  });
  it("recusa ambiguidade de chaves sem escolher ao acaso", async () => {
    const t = new TransporteHttpAsaas({ ambiente: "sandbox", chave: "teste", fetch: async () => Response.json({ data: [{ key: "A", status: "ACTIVE" }, { key: "B", status: "ACTIVE" }] }) });
    await expect(t.chavePixGlobal()).rejects.toThrow("única chave Pix ativa");
  });
});