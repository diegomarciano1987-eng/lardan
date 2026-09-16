/**
 * Importação de produtos: detecção de mudança nos campos novos.
 *
 * Prova, com lotes reais executados pelo motor do banco, que uma planilha que
 * muda apenas o custo do produto atualiza o cadastro, que uma planilha que
 * muda apenas a variante atualiza a variante, e que uma planilha idêntica não
 * altera nada. A massa criada usa o prefixo HOMOLOG e é removida ao fim.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarConta, limpar, rpc, TEST_PREFIX, type Conta } from "../security/harness";

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

const COLUNAS = [
  "Nome do produto",
  "Preço de custo",
  "Valor da peça no bruto",
  "Tamanho",
  "Código legado",
  "Valor final da peça banhada",
];

const MAPA = {
  nome: "Nome do produto",
  preco_custo: "Preço de custo",
  valor_bruto: "Valor da peça no bruto",
  tamanho: "Tamanho",
  codigo_legado: "Código legado",
  valor_final: "Valor final da peça banhada",
};

let master: Conta;
const NOME = `${TEST_PREFIX} Peça importada`;
const LEGADO = `${TEST_PREFIX}-IMP-1`;
let produtoId = "";

/** Sobe um arquivo sintético, abre o lote, envia a linha e processa de verdade. */
async function importar(linha: Record<string, string>) {
  const arquivo = await admin(`/import_files`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      sha256: crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, ""),
      file_name: `${TEST_PREFIX}-importacao.csv`,
      byte_size: 512,
      content_type: "text/csv",
      row_count: 1,
      column_count: COLUNAS.length,
      headers: COLUNAS,
      parser_version: "teste",
      created_by: master.userId,
    }),
  });
  const fileId = (arquivo.body as { id: string }[])[0]!.id;

  const abertura = await rpc(master.token, "import_job_open2", {
    _file: fileId,
    _mode: "catalogo",
    _mapping: MAPA,
    _defaults: {},
    _dry_run: false,
    _location_id: null,
    _operation_date: null,
    _reason_code: null,
    _reference: null,
    _template_id: null,
    _template_version: null,
    _simulation_of: null,
    _correction_of: null,
  });
  expect(abertura.status, JSON.stringify(abertura.body)).toBe(200);
  const jobId = (abertura.body as { id: string }).id;

  await rpc(master.token, "import_rows_stage", { _job: jobId, _rows: [{ n: 1, raw: linha }] });
  await rpc(master.token, "import_job_seal", { _job: jobId });
  await rpc(master.token, "import_job_validate", { _job: jobId, _limit: 100 });
  const proc = await rpc(master.token, "import_job_process", {
    _job: jobId,
    _limit: 100,
    _worker: null,
  });
  expect(proc.status, JSON.stringify(proc.body)).toBe(200);

  const linhas = await admin(`/import_rows?job_id=eq.${jobId}&select=status,effects,product_id,variant_id,messages`);
  return (
    linhas.body as {
      status: string;
      effects: { produto?: string; variante?: string; custo?: string };
      product_id: string | null;
      variant_id: string | null;
      messages: unknown;
    }[]
  )[0]!;
}

beforeAll(async () => {
  master = await criarConta({ nome: "import-master", papeis: ["master"] });
}, 120_000);

afterAll(async () => {
  if (produtoId) {
    await admin(`/product_variants?product_id=eq.${produtoId}`, { method: "DELETE" });
    await admin(`/products?id=eq.${produtoId}`, { method: "DELETE" });
  }
  await admin(`/import_files?file_name=like.${TEST_PREFIX}%25`, { method: "DELETE" });
  await limpar();
}, 600_000);

describe("importação e campos novos", () => {
  it("cria o produto na primeira planilha", async () => {
    const r = await importar({
      "Nome do produto": NOME,
      "Preço de custo": "10,00",
      "Valor da peça no bruto": "4,00",
      Tamanho: "16",
      "Código legado": LEGADO,
      "Valor final da peça banhada": "4,00",
    });
    expect(r.status, JSON.stringify(r.messages)).toBe("processado");
    expect(r.effects.produto).toBe("criado");
    produtoId = r.product_id!;
    expect(produtoId).toBeTruthy();
  });

  it("planilha idêntica não altera nada", async () => {
    const r = await importar({
      "Nome do produto": NOME,
      "Preço de custo": "10,00",
      "Valor da peça no bruto": "4,00",
      Tamanho: "16",
      "Código legado": LEGADO,
      "Valor final da peça banhada": "4,00",
    });
    expect(r.effects.produto).toBe("sem_alteracao");
    expect(r.effects.custo).toBe("sem_alteracao");
  });

  it("planilha que muda só o custo atualiza o produto", async () => {
    const r = await importar({
      "Nome do produto": NOME,
      "Preço de custo": "13,50",
      "Valor da peça no bruto": "6,00",
      Tamanho: "16",
      "Código legado": LEGADO,
      "Valor final da peça banhada": "6,00",
    });
    expect(r.effects.produto).toBe("alterado");
    const custos = await rpc(master.token, "product_costs_read", { _product: produtoId });
    const p = (custos.body as { produto: { cost_price_cents: number; raw_piece_cost_cents: number } })
      .produto;
    expect(p.cost_price_cents).toBe(1350);
    expect(p.raw_piece_cost_cents).toBe(600);
  });

  it("planilha que muda só a variante atualiza a variante", async () => {
    const r = await importar({
      "Nome do produto": NOME,
      "Preço de custo": "13,50",
      "Valor da peça no bruto": "6,00",
      Tamanho: "18",
      "Código legado": LEGADO,
      "Valor final da peça banhada": "6,00",
    });
    expect(r.effects.variante).toBe("alterada");
    const v = await admin(`/product_variants?id=eq.${r.variant_id}&select=size`);
    expect((v.body as { size: string }[])[0]!.size).toBe("18");
  });
});
