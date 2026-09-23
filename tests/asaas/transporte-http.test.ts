/**
 * Transporte HTTP do Asaas — tradução e classificação SEM REDE.
 * Um `fetch` falso captura a requisição montada e devolve respostas
 * sintéticas no formato documentado pelo provedor.
 */
import { describe, expect, test } from "bun:test";
import {
  ChamadaExternaBloqueada,
  TransporteHttpAsaas,
  paraCentavos,
  paraReais,
  type Fetch,
} from "../../src/lib/asaas/transporte-http.server";
import {
  ConsultaIndisponivel,
  CredencialRecusada,
  LimiteDeRequisicoes,
  RecusadoPeloProvedor,
  ReferenciaAmbigua,
  RespostaPerdida,
} from "../../src/lib/asaas/contrato";

type Capturada = { url: string; init: RequestInit };
function falso(resp: (c: Capturada) => Response | Promise<Response>) {
  const chamadas: Capturada[] = [];
  const f: Fetch = async (url, init) => {
    const c = { url, init };
    chamadas.push(c);
    return resp(c);
  };
  return { f, chamadas };
}
const json = (s: number, b: unknown, h: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", ...h } });
const http = (f: Fetch, ambiente: "sandbox" | "producao" = "sandbox") =>
  new TransporteHttpAsaas({ ambiente, chave: "$aact_hmlg_sintetica", fetch: f });

const pagamento = {
  object: "payment", id: "pay_080225913252", customer: "cus_G7Dvo4iphUNk", value: 129.9, netValue: 127.91,
  billingType: "PIX", status: "PENDING", dueDate: "2026-10-10", externalReference: "lardan:installment:x",
  invoiceUrl: "https://sandbox.asaas.com/i/080225913252", dateCreated: "2026-09-23",
};

describe("montagem da requisição", () => {
  test("criar cobrança: endereço, cabeçalhos, corpo e reais", async () => {
    const { f, chamadas } = falso(() => json(200, pagamento));
    const c = await http(f).criarCobranca({ customer: "cus_G7Dvo4iphUNk", valueCents: 12990, dueDate: "2026-10-10", billingType: "PIX", externalReference: "lardan:installment:x", idempotencyKey: "k" });
    const req = chamadas[0]!;
    expect(req.url).toBe("https://api-sandbox.asaas.com/v3/payments");
    expect(req.init.method).toBe("POST");
    const h = req.init.headers as Record<string, string>;
    expect(h["access_token"]).toBe("$aact_hmlg_sintetica");
    expect(h["authorization"]).toBeUndefined();
    expect(h["content-type"]).toBe("application/json");
    expect(h["user-agent"]).toContain("Lardan");
    const corpo = JSON.parse(req.init.body as string);
    expect(corpo).toEqual({ customer: "cus_G7Dvo4iphUNk", billingType: "PIX", value: 129.9, dueDate: "2026-10-10", externalReference: "lardan:installment:x" });
    expect(corpo.idempotencyKey).toBeUndefined();
    expect(c.valueCents).toBe(12990);
    expect(c.netValueCents).toBe(12791);
    expect(c.feeCents).toBeNull();
    expect(c.invoiceUrl).toBe(pagamento.invoiceUrl);
  });

  test("produção usa a base de produção; GET não leva corpo", async () => {
    const { f, chamadas } = falso(() => json(200, pagamento));
    await http(f, "producao").consultarCobranca("pay_1");
    expect(chamadas[0]!.url).toBe("https://api.asaas.com/v3/payments/pay_1");
    expect(chamadas[0]!.init.body).toBeUndefined();
  });

  test("listagem: offset, limit máximo 100, filtros e paginação", async () => {
    const { f, chamadas } = falso(() => json(200, { object: "list", hasMore: true, totalCount: 250, limit: 100, offset: 100, data: [pagamento, pagamento] }));
    const p = await http(f).listarCobrancas({ limit: 500, offset: 100, dueDateGE: "2026-01-01", dueDateLE: "2026-12-31" });
    const u = new URL(chamadas[0]!.url);
    expect(u.searchParams.get("limit")).toBe("100");
    expect(u.searchParams.get("offset")).toBe("100");
    expect(u.searchParams.get("dueDate[ge]")).toBe("2026-01-01");
    expect(u.searchParams.get("dueDate[le]")).toBe("2026-12-31");
    expect(p.hasMore).toBe(true);
    expect(p.total).toBe(250);
    expect(p.proximoOffset).toBe(102);
  });

  test("em aberto anterior ao recorte: sem dueDate[ge] e filtro local, offset do provedor preservado", async () => {
    const velha = { ...pagamento, id: "pay_velha", dueDate: "2025-01-01", status: "OVERDUE" };
    const paga = { ...pagamento, id: "pay_paga", dueDate: "2025-01-01", status: "RECEIVED" };
    const { f, chamadas } = falso(() => json(200, { hasMore: false, data: [velha, paga, pagamento] }));
    const p = await http(f).listarCobrancas({ limit: 50, offset: 0, dueDateGE: "2026-01-01", incluirEmAbertoAnteriores: true });
    expect(new URL(chamadas[0]!.url).searchParams.get("dueDate[ge]")).toBeNull();
    expect(p.itens.map((i) => i.id)).toEqual(["pay_velha", "pay_080225913252"]);
    expect(p.proximoOffset).toBe(3);
  });

  test("externalReference não é presumida única", async () => {
    const { f } = falso(() => json(200, { hasMore: false, data: [pagamento, { ...pagamento, id: "pay_2" }] }));
    await expect(http(f).consultarCobrancaPorReferencia("lardan:installment:x")).rejects.toBeInstanceOf(ReferenciaAmbigua);
  });

  test("cliente: criação com externalReference e notificações desligadas", async () => {
    const { f, chamadas } = falso(() => json(200, { id: "cus_1", name: "ISO" }));
    await http(f).prepararCliente({ name: "ISO", cpfCnpj: "24971563792", ref: "lardan:party:p" });
    const corpo = JSON.parse(chamadas[0]!.init.body as string);
    expect(corpo.externalReference).toBe("lardan:party:p");
    expect(corpo.notificationDisabled).toBe(true);
  });
});

describe("dinheiro", () => {
  test("conversão exata de centavos", () => {
    expect(paraReais(12990)).toBe(129.9);
    expect(paraReais(1)).toBe(0.01);
    expect(paraCentavos(0.1 + 0.2)).toBe(30);
    expect(paraCentavos("129.90")).toBe(12990);
    expect(paraCentavos(null)).toBeNull();
    expect(() => paraReais(1.5)).toThrow();
    expect(() => paraCentavos("abc")).toThrow();
  });
});

describe("classificação de erros", () => {
  test("400 é recusa com códigos (nada criado)", async () => {
    const { f } = falso(() => json(400, { errors: [{ code: "invalid_value", description: "The value field must be informed" }] }));
    const e = await http(f).criarCobranca({ customer: "c", valueCents: 1, dueDate: "2026-01-01", billingType: "PIX", externalReference: "r", idempotencyKey: "k" }).catch((x) => x);
    expect(e).toBeInstanceOf(RecusadoPeloProvedor);
    expect(e.codigos).toEqual(["invalid_value"]);
  });
  test("401 credencial, 429 limite", async () => {
    const a = await http(falso(() => json(401, { errors: [{ code: "invalid_environment" }] })).f).listarClientes({ limit: 1, offset: 0 }).catch((x) => x);
    expect(a).toBeInstanceOf(CredencialRecusada);
    const b = await http(falso(() => json(429, {}, { "retry-after": "12" })).f).listarClientes({ limit: 1, offset: 0 }).catch((x) => x);
    expect(b).toBeInstanceOf(LimiteDeRequisicoes);
    expect(b.repetirEmSegundos).toBe(12);
  });
  test("5xx e queda: POST desconhecido, GET indisponível", async () => {
    const n = { customer: "c", valueCents: 1, dueDate: "2026-01-01", billingType: "PIX" as const, externalReference: "r", idempotencyKey: "k" };
    expect(await http(falso(() => json(502, {})).f).criarCobranca(n).catch((x) => x)).toBeInstanceOf(RespostaPerdida);
    expect(await http(falso(() => { throw new Error("timeout"); }).f).criarCobranca(n).catch((x) => x)).toBeInstanceOf(RespostaPerdida);
    expect(await http(falso(() => new Response("<html>", { status: 200 })).f).criarCobranca(n).catch((x) => x)).toBeInstanceOf(RespostaPerdida);
    expect(await http(falso(() => json(503, {})).f).consultarCobranca("p").catch((x) => x)).toBeInstanceOf(ConsultaIndisponivel);
  });
  test("404 em consulta por ID é ausência, não erro", async () => {
    expect(await http(falso(() => json(404, {})).f).consultarCobranca("pay_x")).toBeNull();
  });
  test("padrão sem fetch injetado: bloqueia antes da rede", async () => {
    const t = new TransporteHttpAsaas({ ambiente: "producao", chave: "$aact_prod_x" });
    expect(await t.consultarCobranca("p").catch((x) => x)).toBeInstanceOf(ChamadaExternaBloqueada);
  });
});
