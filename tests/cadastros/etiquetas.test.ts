import { describe, expect, it } from "vitest";
import { barrasEtiqueta, comporEtiquetas, CONFIG_ETIQUETA, documentoEtiquetas, ETIQUETA, type EtiquetaItem } from "../../src/lib/etiquetas";
const item: EtiquetaItem = { id: "1", nome: "Peça", barcode: "LBRP0295-005499", referencia: "LBRP0295-005499", quantidade: 4 };
describe("Etiquetas Argox", () => {
  it("usa base 95x12 mm, suporte 100 mm, uma coluna e intervalo 3 mm", () => { expect(ETIQUETA).toMatchObject({ largura: 95, suporte: 100, areaImpressao: 30, altura: 12, pistas: 1, intervalo: 3 }); expect(CONFIG_ETIQUETA.entreLinhas).toBe(3); expect(comporEtiquetas([item]).map((r) => r.length)).toEqual([1,1,1,1]); });
  it("preserva o código integral informado sem sequenciais", () => { expect(comporEtiquetas([item]).flat().filter(Boolean).map((i) => i?.barcode)).toEqual(Array(4).fill("LBRP0295-005499")); expect(barrasEtiqueta(item.barcode ?? "").length).toBeGreaterThan(0); });
  it("imprime uma peça por linha sem cópias extras", () => { const rows = comporEtiquetas([item]); expect(rows[0]).toEqual([item]); expect(rows.flat()).toHaveLength(4); });
  it("mantém passo de 15 mm e impede calibração fora do suporte", () => { expect(() => documentoEtiquetas([item], { ...CONFIG_ETIQUETA, margemEsquerda: 6 })).toThrow(); expect(() => documentoEtiquetas([item], { ...CONFIG_ETIQUETA, margemSuperior: 4 })).toThrow(); });
  it("não troca referência pelo dado codificado", () => { const html = documentoEtiquetas([{ ...item, barcode: "123456", referencia: "REF-77", quantidade: 1 }], CONFIG_ETIQUETA); expect(html).toContain('aria-label="123456"'); expect(html).toContain('>REF-77</div>'); });
  it("bloqueia códigos ausentes, largos e quantidades fracionadas", () => { expect(() => comporEtiquetas([{ ...item, barcode: null }])).toThrow(); expect(() => barrasEtiqueta("ABCDEFGHIJKLMNOPQRSTUVWXYZ")).toThrow(); expect(() => comporEtiquetas([{ ...item, quantidade: 1.5 }])).toThrow(); });
  it("escapa conteúdo do cadastro na folha de impressão", () => { expect(documentoEtiquetas([{ ...item, nome: "<script>" }], CONFIG_ETIQUETA)).toContain("&lt;script&gt;"); });
});