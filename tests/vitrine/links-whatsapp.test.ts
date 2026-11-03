import { describe, expect, it } from "vitest";
import { fotoPecaUrl, linhaPeca, linkPedidoPublico, urlPublica } from "@/lib/pedido-publico";

describe("links mandados no WhatsApp", () => {
  it("foto da peça vai com endereço completo, nunca /api/... solto", () => {
    expect(fotoPecaUrl("adf1371d-927e-4f26-97ab-366f9cfacbdf", "https://www.lardan.com.br"))
      .toBe("https://www.lardan.com.br/api/public/midia/adf1371d-927e-4f26-97ab-366f9cfacbdf");
  });
  it("fora do site oficial (prévia, localhost) usa o domínio oficial", () => {
    expect(urlPublica("/api/public/midia/x", "http://localhost:8080")).toBe("https://www.lardan.com.br/api/public/midia/x");
    expect(urlPublica("/pedido/t", "https://id-preview--abc.lovable.app")).toBe("https://www.lardan.com.br/pedido/t");
    expect(linkPedidoPublico("t", "https://lardan.com.br")).toBe("https://lardan.com.br/pedido/t");
  });
  it("linha da peça leva a referência", () => {
    expect(linhaPeca({ quantidade: 1, nome: "Anel Aparador Cravejado", variante: "Dourado", referencia: "LANA0028", valor_cents: 5490 }))
      .toMatch(/^• 1x Anel Aparador Cravejado \(Dourado\) · Ref\. LANA0028 — R\$\s54,90$/);
  });
});

describe("endereço completo vindo da prévia", () => {
  it("troca o domínio da prévia pelo oficial e mantém o domínio oficial", () => {
    expect(urlPublica("http://localhost:8080/ana-ribeiro")).toBe("https://www.lardan.com.br/ana-ribeiro");
    expect(urlPublica("https://lardan.com.br/ana-ribeiro")).toBe("https://lardan.com.br/ana-ribeiro");
  });
});
