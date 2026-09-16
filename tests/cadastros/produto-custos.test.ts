/**
 * Cadastro de produto: sigilo dos custos, regra "somente Master", rascunho
 * incompleto e gravação atômica de variante + custo.
 *
 * Tudo é provado por chamada REST real, com JWT de cada perfil. A massa criada
 * usa o prefixo HOMOLOG e é removida ao fim.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarConta, limpar, rpc, TEST_PREFIX, type Conta } from "../security/harness";

const SERVICE = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
const URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!;

const admin = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const texto = await res.text();
  try {
    return { status: res.status, body: JSON.parse(texto) as unknown };
  } catch {
    return { status: res.status, body: texto as unknown };
  }
};

const COLUNAS_CUSTO_PRODUTO = "id,raw_piece_cost_cents,cost_price_cents,markup_percent";
const COLUNAS_CUSTO_VARIANTE =
  "id,plating_material_cost_cents,varnish_cost_cents,finished_piece_cost_cents";

let master: Conta;
let diretoria: Conta;
let financeiro: Conta;
let marketing: Conta;
let estoque: Conta;
let produtoId = "";
let varianteId = "";

beforeAll(async () => {
  [master, diretoria, financeiro, marketing, estoque] = await Promise.all([
    criarConta({ nome: "custo-master", papeis: ["master"] }),
    criarConta({ nome: "custo-diretoria", papeis: ["diretoria"] }),
    criarConta({ nome: "custo-financeiro", papeis: ["financeiro"] }),
    criarConta({ nome: "custo-marketing", papeis: ["marketing"] }),
    criarConta({ nome: "custo-estoque", papeis: ["estoque"] }),
  ]);
}, 120_000);

afterAll(async () => {
  if (produtoId) {
    await admin(`/product_variants?product_id=eq.${produtoId}`, { method: "DELETE" });
    await admin(`/products?id=eq.${produtoId}`, { method: "DELETE" });
  }
  await limpar();
}, 600_000);

describe("rascunho e publicação", () => {
  it("Master salva rascunho sem preço de custo", async () => {
    const r = await rpc(master.token, "product_save", {
      _id: null,
      _payload: { name: `${TEST_PREFIX} Peça rascunho`, legacy_code: `${TEST_PREFIX}-R1` },
    });
    expect(r.status).toBe(200);
    const body = r.body as { id: string; status: string; internal_code: string | null };
    produtoId = body.id;
    expect(body.status).toBe("rascunho");
    expect(body.internal_code).toBeTruthy();
  });

  it("o rascunho continua sem custo gravado", async () => {
    const r = await admin(`/products?id=eq.${produtoId}&select=${COLUNAS_CUSTO_PRODUTO},status`);
    const linha = (r.body as { cost_price_cents: number | null; status: string }[])[0]!;
    expect(linha.cost_price_cents).toBeNull();
    expect(linha.status).toBe("rascunho");
  });

  it("publicação do rascunho incompleto é recusada e lista impedimentos", async () => {
    const r = await rpc(master.token, "publish_products", { _ids: [produtoId], _note: "teste" });
    expect(r.status).toBe(200);
    const body = r.body as { afetados: number; rejeitados: number };
    expect(body.afetados).toBe(0);
    expect(body.rejeitados).toBeGreaterThan(0);
  });
});

describe("sigilo dos custos", () => {
  it("visitante anônimo não lê colunas de custo", async () => {
    const r = await comoUsuario(null, `/products?select=${COLUNAS_CUSTO_PRODUTO}&limit=1`);
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  for (const perfil of ["marketing", "estoque"] as const) {
    it(`${perfil} não lê custo do produto nem da variante`, async () => {
      const conta = perfil === "marketing" ? marketing : estoque;
      const p = await comoUsuario(conta.token, `/products?select=${COLUNAS_CUSTO_PRODUTO}&limit=1`);
      expect(p.status).toBeGreaterThanOrEqual(400);
      const v = await comoUsuario(
        conta.token,
        `/product_variants?select=${COLUNAS_CUSTO_VARIANTE}&limit=1`,
      );
      expect(v.status).toBeGreaterThanOrEqual(400);
      const h = await comoUsuario(conta.token, `/variant_costs?select=id,cost_cents&limit=1`);
      expect(Array.isArray(h.body) ? (h.body as unknown[]).length : 1).toBe(0);
      const rpcCusto = await rpc(conta.token, "product_costs_read", { _product: produtoId });
      expect(rpcCusto.status).toBe(403);
    });
  }

  it("Master, Diretoria e Financeiro consultam custos pela operação autorizada", async () => {
    for (const conta of [master, diretoria, financeiro]) {
      const r = await rpc(conta.token, "product_costs_read", { _product: produtoId });
      expect(r.status).toBe(200);
      expect((r.body as { produto: { id: string } }).produto.id).toBe(produtoId);
    }
  });

  it("perfil autorizado ainda não lê a coluna direto na tabela", async () => {
    const r = await comoUsuario(
      financeiro.token,
      `/products?select=${COLUNAS_CUSTO_PRODUTO}&limit=1`,
    );
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

describe("somente Master altera produto", () => {
  for (const perfil of ["marketing", "diretoria", "financeiro", "estoque"] as const) {
    it(`${perfil} não cria nem edita produto`, async () => {
      const conta = { marketing, diretoria, financeiro, estoque }[perfil];
      const salvar = await rpc(conta.token, "product_save", {
        _id: produtoId,
        _payload: { name: "invasão" },
      });
      expect(salvar.status).toBe(403);
      const variante = await rpc(conta.token, "variant_save", {
        _id: null,
        _payload: { product_id: produtoId, label: "invasão" },
      });
      expect(variante.status).toBe(403);
      const publicar = await rpc(conta.token, "publish_products", {
        _ids: [produtoId],
        _note: "invasão",
      });
      expect(publicar.status).toBe(403);
      // gravação direta na tabela: a política não deixa nenhuma linha ser atingida
      const direto = await comoUsuario(conta.token, `/products?id=eq.${produtoId}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ name: "invasão direta" }),
      });
      const atingidas = Array.isArray(direto.body) ? (direto.body as unknown[]).length : 0;
      expect(direto.status >= 400 || atingidas === 0).toBe(true);
    });
  }

  it("Marketing não muda categoria nem preço em lote, mas ainda destaca na vitrine", async () => {
    const categoria = await rpc(marketing.token, "showcase_bulk", {
      _action: "definir_categoria",
      _ids: [produtoId],
      _params: {},
    });
    expect(categoria.status).toBe(403);
    const preco = await rpc(marketing.token, "showcase_bulk", {
      _action: "esconder_preco",
      _ids: [produtoId],
    });
    expect(preco.status).toBe(403);
    const destaque = await rpc(marketing.token, "showcase_bulk", {
      _action: "destacar",
      _ids: [produtoId],
    });
    expect(destaque.status).toBe(200);
  });

  it("o nome do produto continua o do cadastro", async () => {
    const r = await admin(`/products?id=eq.${produtoId}&select=name`);
    expect((r.body as { name: string }[])[0]!.name).toContain(TEST_PREFIX);
  });
});

describe("variante e custo gravam juntos", () => {
  it("Master cria a variante com custo", async () => {
    const r = await rpc(master.token, "variant_save", {
      _id: null,
      _payload: {
        product_id: produtoId,
        label: `${TEST_PREFIX} variante`,
        size: "16",
        price_cents: 19900,
        custo: {
          raw_piece_cost_cents: 1000,
          plating_material_cost_cents: 500,
          varnish_cost_cents: 200,
          finished_piece_cost_cents: 1700,
        },
      },
    });
    expect(r.status).toBe(200);
    varianteId = (r.body as { id: string }).id;
    const custos = await rpc(master.token, "product_costs_read", { _product: produtoId });
    const v = (
      custos.body as { variantes: { id: string; finished_piece_cost_cents: number }[] }
    ).variantes.find((x) => x.id === varianteId)!;
    expect(v.finished_piece_cost_cents).toBe(1700);
  });

  it("editar aro, preço e código de barras preserva os custos vigentes", async () => {
    const r = await rpc(master.token, "variant_save", {
      _id: varianteId,
      _payload: { product_id: produtoId, label: `${TEST_PREFIX} variante`, size: "18", price_cents: 22900, barcode: "0007891234560" },
    });
    expect(r.status).toBe(200);
    const depois = await admin(
      `/product_variants?id=eq.${varianteId}&select=${COLUNAS_CUSTO_VARIANTE},size,price_cents,barcode`,
    );
    const linha = (
      depois.body as {
        plating_material_cost_cents: number;
        varnish_cost_cents: number;
        finished_piece_cost_cents: number;
        size: string;
        price_cents: number;
        barcode: string;
      }[]
    )[0]!;
    expect(linha.size).toBe("18");
    expect(linha.price_cents).toBe(22900);
    expect(linha.barcode).toBe("0007891234560");
    expect(linha.plating_material_cost_cents).toBe(500);
    expect(linha.varnish_cost_cents).toBe(200);
    expect(linha.finished_piece_cost_cents).toBe(1700);
  });

  it("custo igual não cria nova vigência", async () => {
    const antes = await admin(`/variant_costs?variant_id=eq.${varianteId}&select=id`);
    await rpc(master.token, "variant_save", {
      _id: varianteId,
      _payload: {
        product_id: produtoId,
        label: `${TEST_PREFIX} variante`,
        size: "18",
        custo: {
          raw_piece_cost_cents: 1000,
          plating_material_cost_cents: 500,
          varnish_cost_cents: 200,
          finished_piece_cost_cents: 1700,
        },
      },
    });
    const depois = await admin(`/variant_costs?variant_id=eq.${varianteId}&select=id`);
    expect((depois.body as unknown[]).length).toBe((antes.body as unknown[]).length);
  });

  it("custo inválido derruba a operação inteira: a variante não muda", async () => {
    const r = await rpc(master.token, "variant_save", {
      _id: varianteId,
      _payload: {
        product_id: produtoId,
        label: `${TEST_PREFIX} variante`,
        size: "22",
        custo: {
          raw_piece_cost_cents: 1000,
          plating_material_cost_cents: 500,
          varnish_cost_cents: 200,
          finished_piece_cost_cents: 9900,
        },
      },
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    const depois = await admin(
      `/product_variants?id=eq.${varianteId}&select=size,${COLUNAS_CUSTO_VARIANTE}`,
    );
    const linha = (depois.body as { size: string; finished_piece_cost_cents: number }[])[0]!;
    expect(linha.size).toBe("18");
    expect(linha.finished_piece_cost_cents).toBe(1700);
  });

  it("nova vigência com justificativa preserva o histórico anterior", async () => {
    const antes = await admin(`/variant_costs?variant_id=eq.${varianteId}&select=id`);
    const r = await rpc(master.token, "variant_save", {
      _id: varianteId,
      _payload: {
        product_id: produtoId,
        label: `${TEST_PREFIX} variante`,
        size: "18",
        custo: {
          raw_piece_cost_cents: 1200,
          plating_material_cost_cents: 500,
          varnish_cost_cents: 200,
          finished_piece_cost_cents: 2100,
          justification: "reajuste do fornecedor",
        },
      },
    });
    expect(r.status).toBe(200);
    const depois = await admin(`/variant_costs?variant_id=eq.${varianteId}&select=id`);
    expect((depois.body as unknown[]).length).toBe((antes.body as unknown[]).length + 1);
  });
});
