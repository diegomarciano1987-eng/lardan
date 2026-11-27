import { describe, expect, it } from "vitest";
import { calcularAcerto, type AcertoBase, type TabelaComissao } from "./acertos-representantes";

const T: TabelaComissao[] = [
  { id: "1", nome: "Tabela 1", vigente_de: "2026-01-01", faixas: [
    { nome: "CRÍTICO", min: 0, pct: 0.12 }, { nome: "CRÍTICO 2", min: 0.7501, pct: 0.13 }, { nome: "MÉDIA", min: 0.8001, pct: 0.14 },
    { nome: "BOM", min: 0.8701, pct: 0.15 }, { nome: "TOP", min: 0.9001, pct: 0.16 }, { nome: "EXCELENTE", min: 0.95, pct: 0.17 }] },
  { id: "4", nome: "Tabela 4", vigente_de: "2026-08-31", faixas: [
    { nome: "CRÍTICO", min: 0, pct: 0.09 }, { nome: "MÉDIA", min: 0.8501, pct: 0.12 }, { nome: "BOM", min: 0.9001, pct: 0.13 },
    { nome: "TOP", min: 0.9501, pct: 0.14 }, { nome: "EXCELENTE", min: 0.98, pct: 0.16 }] },
];
const base: AcertoBase = {
  representante_party_id: "r", data: "2026-01-05", praca: "TEODORO SAMPAIO", clientes_atendidas: 53, aberturas: 5, cortes: 10, nao_atendidas: 4,
  estoque_enviado_cents: 35292167, venda_bruta_cents: 4108794, venda_liquida_cents: 2561034, recebimento_cents: 2760779, total_pago_cents: 2692662,
  combustivel_cents: 0, hotel_cents: 0, alimentacao_cents: 0, outros_cents: 126047, retido_cents: 0, desconto_pessoal_cents: 0,
};

describe("acerto do representante (planilha COMERCIAL 2026)", () => {
  it("Marcelo 05/01 Teodoro Sampaio: EXCELENTE 17%, comissão 4.693,32, diferença 681,17, livre 4.012,15", () => {
    const c = calcularAcerto(base, T, null);
    expect(c.faixa).toBe("EXCELENTE");
    expect(c.pct_comissao).toBe(0.17);
    expect(c.comissao_cents).toBe(469332);
    expect(c.diferenca_cents).toBe(68117);
    expect(c.livre_cents).toBe(401215);
    expect(c.carteira).toBe(57);
  });
  it("usa a tabela vigente pela data: 87% em set/2026 cai em MÉDIA 12%", () => {
    const c = calcularAcerto({ ...base, data: "2026-09-07", venda_liquida_cents: 100000, recebimento_cents: 87000, total_pago_cents: 87000, retido_cents: null }, T, null);
    expect(c.tabela).toBe("Tabela 4");
    expect(c.faixa).toBe("MÉDIA");
    expect(c.comissao_cents).toBe(10440);
  });
  it("retém 20% da comissão a partir de 01/09/2026 quando o retido não foi digitado", () => {
    const cfg = { retencao_pct: 0.2, retencao_desde: "2026-09-01" };
    const c = calcularAcerto({ ...base, data: "2026-09-07", venda_liquida_cents: 100000, recebimento_cents: 87000, total_pago_cents: 87000, retido_cents: null }, T, cfg);
    expect(c.retido_calc_cents).toBe(2088);
    expect(c.livre_cents).toBe(10440 - 2088);
    const antes = calcularAcerto({ ...base, retido_cents: null }, T, cfg);
    expect(antes.retido_calc_cents).toBe(0);
  });
  it("desconto pessoal sai da comissão livre", () => {
    const c = calcularAcerto({ ...base, desconto_pessoal_cents: 75400 }, T, null);
    expect(c.livre_cents).toBe(401215 - 75400);
  });
});
