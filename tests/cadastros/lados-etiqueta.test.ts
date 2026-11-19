import { beforeEach, describe, expect, it, vi } from "vitest";

const enviados: { duplicar: boolean }[] = [];
vi.mock("@/lib/argox-direta", () => ({ lerEstacao: () => ({ linguagem: "pplb" }), imprimirDireto: vi.fn(async () => "Argox") }));
vi.mock("@/lib/etiquetas-calibracao", () => ({ lerCalibracaoGlobal: async () => ({}) }));
vi.mock("@/lib/etiquetas-raw", () => ({ comandosEtiquetas: (_i: unknown, _c: unknown, _l: unknown, o: { duplicar: boolean }) => { enviados.push(o); return "CMD"; } }));
vi.mock("@/lib/etiquetas-dados", () => ({ buscarEtiquetas: vi.fn(), lerItensEtiquetas: vi.fn() }));

const peca = { id: "v1", nome: "Anel Gota", barcode: "18461", referencia: "LAN0353", precoCents: 7490, quantidade: 1 };

describe("1 lado / 2 lados ao lado da impressora (0342)", () => {
  beforeEach(() => { enviados.length = 0; });
  it("sem marcar nada, a etiqueta sai em 1 lado", async () => {
    const { enviarParaImpressora } = await import("@/components/admin/EtiquetasImprimir");
    const r = await enviarParaImpressora([peca]);
    expect(enviados).toEqual([{ duplicar: false }]);
    expect(r.duplicar).toBe(false);
  });
  it("sai em 2 lados só quando o seletor daquela impressora está em 2 lados", async () => {
    const { enviarParaImpressora } = await import("@/components/admin/EtiquetasImprimir");
    await enviarParaImpressora([peca], true);
    await enviarParaImpressora([peca]);
    expect(enviados).toEqual([{ duplicar: true }, { duplicar: false }]);
  });
});
