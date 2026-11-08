import { describe, expect, it } from "vitest";
import { comandosEtiquetaMaleta, linhasEtiquetaMaleta } from "@/lib/etiqueta-maleta-raw";
import { rotuloMaletaRemessa } from "@/lib/remessas";
import { htmlPedidoConsignacao, type PedidoDados } from "@/lib/pedido-consignacao";

// 0266 (Daniel, 08/11/2026)
describe("etiqueta da maleta sem o número solto", () => {
  const dados = { cliente_codigo: "9121", cliente_nome: "Ana Caroline", representante: "Daniel de Freitas Maciel", remessa_numero: 926, maleta_numero: 11 };
  it("PPLZ não imprime o 11 e mantém a remessa", () => {
    const z = comandosEtiquetaMaleta("18497", "pplz", 1, dados);
    expect(z).not.toContain("^FD11^FS");
    expect(z).toContain("^FD926^FS");
  });
  it("PPLB não imprime o 11 e mantém a remessa", () => {
    const b = comandosEtiquetaMaleta("18497", "pplb", 1, dados);
    expect(b).not.toContain('"11"');
    expect(b).toContain('"926"');
  });
  it("PPLA não imprime o 11", () => {
    const a = comandosEtiquetaMaleta("18497", "ppla", 1, dados);
    expect(a.split("\r\n").some((l) => l.endsWith("11") && l.startsWith("1411"))).toBe(false);
  });
  it("as linhas da etiqueta não têm mais o campo maleta", () => {
    expect("maleta" in linhasEtiquetaMaleta(dados)).toBe(false);
  });
});

describe("rótulo da maleta na tela da remessa", () => {
  it("abertura 1 vira ABERTURA 01", () => {
    expect(rotuloMaletaRemessa({ abertura_numero: 1, maleta_seq: null, consultora_party_id: null })).toBe("ABERTURA 01");
  });
  it("primeira maleta da consultora vira MALETA 01 e o acréscimo MALETA 02", () => {
    expect(rotuloMaletaRemessa({ abertura_numero: null, maleta_seq: 1, consultora_party_id: "p" })).toBe("MALETA 01");
    expect(rotuloMaletaRemessa({ abertura_numero: null, maleta_seq: 2, consultora_party_id: "p" })).toBe("MALETA 02");
  });
  it("abertura já repassada continua ABERTURA", () => {
    expect(rotuloMaletaRemessa({ abertura_numero: 3, maleta_seq: 1, consultora_party_id: "p" })).toBe("ABERTURA 03");
  });
});

describe("romaneio com o número da abertura ao lado da remessa", () => {
  const base: PedidoDados = {
    empresa: { endereco_linha: "End", pedidos_telefone: "1", pedidos_email: "e", pagamento_texto: "p", pix_tipo: "CNPJ", pix_chave: "x", pix_favorecido: "f",
      garantia_titulo: "G", garantia_texto: "g", garantia_exclusoes: "n", montagem_texto: "m", rodape_texto: "r", prazo_correio_dias: 7 },
    remessa: { numero: 926, kit: 1, tipo_envio: "pessoal", data_acerto: "2026-12-21", postar_ate: null },
    maleta: "M", cliente_codigo: null, consultora: { nome: null, endereco: null, cidade: null, whatsapp: null },
    representante: null, montado_por: "Thalia", faixas: [], itens: [{ variant_id: "a", sku: "A1", referencia: "LANP1", descricao: "AN", preco_cents: 9990, quantidade: 1, grupo: "aneis" }],
  } as unknown as PedidoDados;
  const op = { logoUrl: "x", operador: "op", impressoEm: new Date() };
  it("abertura 2 mostra 'Remessa 00926 · Abertura 02'", () => {
    const h = htmlPedidoConsignacao({ ...base, abertura: true, abertura_numero: 2 }, op);
    expect(h).toContain('Remessa 00926 <span class="ab">· Abertura 02</span>');
    expect(h).toContain("MALETA DE ABERTURA 02");
  });
  it("maleta de consultora não mostra abertura", () => {
    const h = htmlPedidoConsignacao({ ...base, cliente_codigo: "9121", consultora: { nome: "Ana", endereco: null, cidade: null, whatsapp: null } }, op);
    expect(h).not.toContain("Abertura 0");
  });
});
