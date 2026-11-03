import { describe, expect, it } from "vitest";
import { mensagemResumoPedido, fotoPedido } from "@/lib/pedido-publico";

describe("resumo do pedido para a cliente", () => {
  const base = { cliente: "Maria Souza", codigo: "PED-000070", total_cents: 31490, manual: "https://www.lardan.com.br/cuidados" };
  it("leva a referência da peça na linha", () => {
    const t = mensagemResumoPedido({ ...base, itens: [{ nome: "AN AÇO QUADRADO", variante: "Aro 22", quantidade: 1, unitario_cents: 31490, referencia: "LCJ0043" }], link: null });
    expect(t).toContain("• 1x AN AÇO QUADRADO (Aro 22) · Ref. LCJ0043 — R$");
  });
  it("leva o link da página com fotos", () => {
    const t = mensagemResumoPedido({ ...base, itens: [], link: "https://www.lardan.com.br/pedido/abc" });
    expect(t).toContain("Veja as fotos das suas peças: https://www.lardan.com.br/pedido/abc");
  });
  it("sem referência não escreve Ref.", () => {
    const t = mensagemResumoPedido({ ...base, itens: [{ nome: "Brinco", variante: null, quantidade: 2, unitario_cents: 1490, referencia: null }] });
    expect(t).not.toContain("Ref.");
  });
  it("foto só pelo link do pedido", () => {
    expect(fotoPedido("t", "m")).toBe("/api/public/pedido-foto/t/m");
    expect(fotoPedido("t", null)).toBeNull();
  });
});
