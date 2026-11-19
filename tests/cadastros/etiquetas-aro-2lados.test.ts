/**
 * 0340 (Diego, 19/11/2026): etiqueta Argox de peça
 *  - anel: aro (só o número, 04 → 4) no canto direito da linha do nome, com espaço sempre reservado;
 *  - "2 lados": a mesma etiqueta repetida ao lado, deslocada pela distância do 2º lado (padrão 30 mm = 240 pontos).
 */
import { describe, expect, it } from "vitest";
import { comandosEtiquetas, comandosTeste } from "../../src/lib/etiquetas-raw";
import { AMOSTRA_ANEL, CONFIG_ETIQUETA, aroEtiqueta, documentoEtiquetas, nomeComEspacoAro, validarCalibracao, type EtiquetaItem } from "../../src/lib/etiquetas";

const CFG_LARDAN = { alturaBarras: 3.8, areaLargura: 30, entreLinhas: 3, fonteNome: 7, fonteReferencia: 8.5, margemEsquerda: 2, margemSuperior: 1.5 };
const anel = (aro: string | null, nome = "AN DOU SOLITARIO GOTA 8MM COM PEDRA"): EtiquetaItem => ({ id: "a", nome, barcode: "1846120", referencia: "LAN0353", precoCents: 7490, aro, quantidade: 1 });

describe("aro do anel", () => {
  it("vem do tamanho numérico ou do rótulo 'Aro NN', sem zero à esquerda", () => {
    expect(aroEtiqueta("04")).toBe("4");
    expect(aroEtiqueta("16")).toBe("16");
    expect(aroEtiqueta(null, "Aro 06")).toBe("6");
    expect(aroEtiqueta("16 cm")).toBeNull();
    expect(aroEtiqueta("Ajustável")).toBeNull();
    expect(aroEtiqueta(null, "Rosé")).toBeNull();
  });
  it("nome é cortado para sempre caber o aro + 1 espaço no fim", () => {
    expect(nomeComEspacoAro("AN DOU SOLITARIO GOTA 8MM", 24, "16")).toBe("AN DOU SOLITARIO GOTA");
    expect(nomeComEspacoAro("AN DOU SOLITARIO GOTA 8MM", 24, null)).toBe("AN DOU SOLITARIO GOTA 8M");
  });
  it("PPLB: aro alinhado à direita da área útil (mesma linha do nome), nome sem invadir", () => {
    const c = comandosEtiquetas([anel("16")], CFG_LARDAN, "pplb");
    const linhas = c.split("\n").filter((l) => l.startsWith("A"));
    const nome = linhas[0]!, aro = linhas[1]!;
    const [xN, yN] = nome.slice(1).split(",").map(Number);
    const [xA, yA] = aro.slice(1).split(",").map(Number);
    expect(aro.endsWith('"16"')).toBe(true);
    expect(yA).toBe(yN);
    // área 30 mm - 1,2 mm = 230 pontos úteis; aro "16" = 2 caracteres de 10 pontos encostados no fim
    expect(xA).toBe(xN! + 230 - 20);
    const texto = /"(.*)"$/.exec(nome)![1]!;
    expect(xN! + texto.length * 10).toBeLessThanOrEqual(xA! - 10);
  });
  it("peça sem aro não ganha linha extra (brinco continua igual)", () => {
    const c = comandosEtiquetas([{ ...anel(null), nome: "BR PR CIRCULO CRUZ" }], CFG_LARDAN, "pplb");
    expect(c.split("\n").filter((l) => l.startsWith("A"))).toHaveLength(2);
  });
  it("PPLZ e PPLA também levam o aro", () => {
    expect(comandosEtiquetas([anel("6")], CFG_LARDAN, "pplz")).toMatch(/\^FB\d+,1,0,R\^FD6\^FS/);
    expect(comandosEtiquetas([anel("6")], CFG_LARDAN, "ppla").split("\r\n").filter((l) => l.startsWith("1211") && l.endsWith("6") && !l.includes("LAN0353"))).toHaveLength(1);
  });
});

describe("etiqueta em 2 lados", () => {
  it("PPLB: cada linha sai 2 vezes, a 2ª deslocada 240 pontos (30 mm); mesma quantidade de cópias", () => {
    const um = comandosEtiquetas([{ ...anel("16"), quantidade: 3 }], CFG_LARDAN, "pplb");
    const dois = comandosEtiquetas([{ ...anel("16"), quantidade: 3 }], CFG_LARDAN, "pplb", { duplicar: true });
    const campos = (c: string) => c.split("\n").filter((l) => /^[AB]\d/.test(l));
    expect(campos(dois)).toHaveLength(campos(um).length * 2);
    const barras = campos(dois).filter((l) => l.startsWith("B"));
    expect(barras).toHaveLength(2);
    const x = barras.map((b) => Number(b.slice(1).split(",")[0]));
    expect(x[1]! - x[0]!).toBe(240);
    expect(dois).toContain("P3");
    expect(dois.match(/^P\d+$/gm)).toHaveLength(1); // uma etiqueta física por cópia, não o dobro de etiquetas
  });
  it("PPLZ e PPLA: código de barras aparece nos 2 lados", () => {
    expect(comandosEtiquetas([anel("16")], CFG_LARDAN, "pplz", { duplicar: true }).match(/\^BCN/g)).toHaveLength(2);
    expect(comandosEtiquetas([anel("16")], CFG_LARDAN, "ppla", { duplicar: true }).split("\r\n").filter((l) => l.startsWith("1e"))).toHaveLength(2);
  });
  it("1 lado continua idêntico ao de antes (padrão)", () => {
    expect(comandosTeste(CONFIG_ETIQUETA, "pplb", 3)).toBe(comandosTeste(CONFIG_ETIQUETA, "pplb", 3, { duplicar: false }));
  });
  it("2º lado que encosta no 1º ou passa dos 100 mm é recusado só no modo 2 lados", () => {
    expect(validarCalibracao({ ...CFG_LARDAN, areaLargura: 35 }, { duplicar: true })).toContain("encosta");
    expect(validarCalibracao({ ...CFG_LARDAN, areaLargura: 35 })).toBeNull();
    expect(validarCalibracao({ ...CFG_LARDAN, segundoLado: 65, areaLargura: 40 }, { duplicar: true })).toContain("100 mm");
    expect(() => comandosEtiquetas([anel("16")], { ...CFG_LARDAN, areaLargura: 35 }, "pplb", { duplicar: true })).toThrow();
  });
  it("prévia (navegador) mostra os 2 blocos e o aro", () => {
    const html = documentoEtiquetas([AMOSTRA_ANEL], CFG_LARDAN, { duplicar: true });
    expect(html.match(/<article>/g)).toHaveLength(2);
    expect(html.match(/<b>16<\/b>/g)).toHaveLength(2);
  });
});
