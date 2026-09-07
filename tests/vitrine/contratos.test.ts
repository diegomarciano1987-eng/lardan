/**
 * Contrato definitivo da vitrine (P1-B).
 *
 * Cobre as portas canônicas de categoria/coleção e as invariantes permanentes
 * do produto publicado. Tudo é criado com o prefixo HOMOLOG e removido no fim;
 * nenhum registro real é tocado.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarConta, limpar, rpc, type Conta } from "../security/harness";

const marca = `homolog-${Date.now().toString(36)}`;
let master: Conta;
let categoriaId = "";
let colecaoId = "";
let produtoId = "";
let mediaId = "";
let vinculoId = "";
let varianteId = "";

const tok = () => master.token;

async function criar(tabela: string, corpo: Record<string, unknown>) {
  const r = await comoUsuario(tok(), `/${tabela}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(corpo),
  });
  const linhas = Array.isArray(r.body) ? (r.body as { id: string }[]) : [];
  return { status: r.status, id: linhas[0]?.id ?? "", body: r.body };
}

async function alterar(tabela: string, id: string, corpo: Record<string, unknown>) {
  return comoUsuario(tok(), `/${tabela}?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify(corpo),
  });
}

async function apagar(tabela: string, filtro: string) {
  return comoUsuario(tok(), `/${tabela}?${filtro}`, { method: "DELETE" });
}

beforeAll(async () => {
  master = await criarConta({ nome: "vitrine.master", papeis: ["master"] });
  expect(master.token).toBeTruthy();

  const cat = await criar("categories", {
    slug: `${marca}-categoria`,
    name: "HOMOLOG Categoria",
    position: 900,
    status: "rascunho",
  });
  categoriaId = cat.id;
  expect(categoriaId).toBeTruthy();

  const col = await criar("collections", {
    slug: `${marca}-colecao`,
    name: "HOMOLOG Coleção",
    position: 900,
    status: "rascunho",
  });
  colecaoId = col.id;

  const media = await criar("media_assets", {
    url: `homolog/${marca}.jpg`,
    alt: "Peça de homologação sobre fundo neutro",
    content_type: "image/jpeg",
  });
  mediaId = media.id;

  const prod = await criar("products", {
    slug: `${marca}-peca`,
    name: "HOMOLOG Peça",
    description: "Peça sintética de homologação.",
    category_id: categoriaId,
    price_cents: 12900,
    price_is_public: true,
    status: "rascunho",
  });
  produtoId = prod.id;

  const vinculo = await criar("product_media", {
    product_id: produtoId,
    media_id: mediaId,
    position: 1,
  });
  vinculoId = vinculo.id;

  const variantes = await comoUsuario(
    tok(),
    `/product_variants?product_id=eq.${produtoId}&select=id`,
  );
  varianteId = (variantes.body as { id: string }[])[0]?.id ?? "";
});

afterAll(async () => {
  if (produtoId) {
    await rpc(tok(), "unpublish_products", {
      _ids: [produtoId],
      _note: "fim da homologação",
      _para: "rascunho",
    });
    await apagar("product_media", `product_id=eq.${produtoId}`);
    await apagar("product_variants", `product_id=eq.${produtoId}`);
    await apagar("products", `id=eq.${produtoId}`);
  }
  for (const [tabela, id] of [
    ["categories", categoriaId],
    ["collections", colecaoId],
  ] as const) {
    if (!id) continue;
    await rpc(tok(), "unpublish_taxonomy", {
      _tipo: tabela,
      _ids: [id],
      _note: "fim da homologação",
      _para: "rascunho",
      _produtos: "despublicar",
    });
    await apagar(tabela, `id=eq.${id}`);
  }
  if (mediaId) await apagar("media_assets", `id=eq.${mediaId}`);
  await limpar();
});

describe("categoria e coleção: porta canônica", () => {
  it("recusa publicação direta pela tabela", async () => {
    const r = await alterar("categories", categoriaId, { status: "publicado" });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r.body)).toContain("publish_taxonomy");
  });

  it("lista os impedimentos reais antes de publicar", async () => {
    const r = await rpc(tok(), "taxonomy_publish_blockers", {
      _tipo: "categories",
      _id: categoriaId,
    });
    expect(r.body).toEqual(expect.arrayContaining(["descricao", "titulo_publico", "seo"]));
  });

  it("recusa publicar enquanto o conteúdo público estiver incompleto", async () => {
    const r = await rpc(tok(), "publish_taxonomy", {
      _tipo: "categories",
      _ids: [categoriaId],
      _note: null,
    });
    expect((r.body as { afetados: number }).afetados).toBe(0);
    expect((r.body as { rejeitados: number }).rejeitados).toBe(1);
  });

  it("publica quando o contrato está completo", async () => {
    await rpc(tok(), "taxonomy_save_public", {
      _tipo: "categories",
      _id: categoriaId,
      _values: {
        description: "Categoria sintética de homologação.",
        seo_title: "HOMOLOG Categoria",
        seo_description: "Categoria sintética usada apenas em homologação.",
      },
    });
    const r = await rpc(tok(), "publish_taxonomy", {
      _tipo: "categories",
      _ids: [categoriaId],
      _note: "homologação",
    });
    expect((r.body as { afetados: number }).afetados).toBe(1);
  });

  it("recusa endereço inválido", async () => {
    const r = await rpc(tok(), "taxonomy_save_public", {
      _tipo: "collections",
      _id: colecaoId,
      _values: { slug: "AB C!" },
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it("guarda o endereço antigo para redirecionar", async () => {
    await rpc(tok(), "taxonomy_save_public", {
      _tipo: "categories",
      _id: categoriaId,
      _values: { slug: `${marca}-categoria-nova` },
    });
    const r = await rpc(null, "public_taxonomy_redirect", {
      _tipo: "categories",
      _slug: `${marca}-categoria`,
    });
    expect(r.body).toBe(`${marca}-categoria-nova`);
  });
});

describe("produto publicado: invariantes permanentes", () => {
  it("publica pela porta canônica", async () => {
    const r = await rpc(tok(), "publish_products", { _ids: [produtoId], _note: "homologação" });
    expect((r.body as { afetados: number }).afetados).toBe(1);
  });

  const recusa = async (
    rotulo: string,
    executar: () => Promise<{ status: number; body: unknown }>,
  ) => {
    const r = await executar();
    expect(r.status, `${rotulo} deveria ser recusado`).toBeGreaterThanOrEqual(400);
  };

  it("recusa esvaziar o nome", () =>
    recusa("nome", () => alterar("products", produtoId, { name: "  " })));
  it("recusa esvaziar a descrição", () =>
    recusa("descrição", () => alterar("products", produtoId, { description: "" })));
  it("recusa esvaziar o endereço", () =>
    recusa("slug", () => alterar("products", produtoId, { slug: "" })));
  it("recusa remover a categoria", () =>
    recusa("categoria", () => alterar("products", produtoId, { category_id: null })));
  it("recusa preço vazio com preço visível", () =>
    recusa("preço", () => alterar("products", produtoId, { price_cents: 0 })));
  it("recusa mudar o status direto na tabela", () =>
    recusa("status", () => alterar("products", produtoId, { status: "rascunho" })));
  it("recusa remover a última imagem", () =>
    recusa("imagem", () => apagar("product_media", `id=eq.${vinculoId}`)));
  it("recusa esvaziar o texto alternativo da imagem", () =>
    recusa("alt", () => alterar("media_assets", mediaId, { alt: "" })));
  it("recusa arquivar a única imagem", () =>
    recusa("arquivar", () => alterar("media_assets", mediaId, { is_archived: true })));
  it("recusa desativar a última variante", () =>
    recusa("variante", () => alterar("product_variants", varianteId, { is_active: false })));

  it("recusa retirar a categoria do ar com produto publicado", async () => {
    const r = await rpc(tok(), "unpublish_taxonomy", {
      _tipo: "categories",
      _ids: [categoriaId],
      _note: "teste de dependência",
      _para: "rascunho",
      _produtos: "bloquear",
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it("exige motivo para retirar a peça do ar", async () => {
    const r = await rpc(tok(), "unpublish_products", {
      _ids: [produtoId],
      _note: "",
      _para: "rascunho",
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it("conta apenas o que realmente mudou e é idempotente", async () => {
    const um = await rpc(tok(), "unpublish_products", {
      _ids: [produtoId],
      _note: "homologação",
      _para: "rascunho",
    });
    expect((um.body as { afetados: number }).afetados).toBe(1);
    const dois = await rpc(tok(), "unpublish_products", {
      _ids: [produtoId],
      _note: "homologação",
      _para: "rascunho",
    });
    expect((dois.body as { afetados: number }).afetados).toBe(0);
  });
});

describe("leitura pública", () => {
  it("categoria em rascunho não existe para o público", async () => {
    await rpc(tok(), "unpublish_taxonomy", {
      _tipo: "categories",
      _ids: [categoriaId],
      _note: "homologação",
      _para: "rascunho",
      _produtos: "despublicar",
    });
    const r = await rpc(null, "public_category", { _slug: `${marca}-categoria-nova` });
    expect(r.body).toBeNull();
  });

  it("peça fora do ar não existe para o público", async () => {
    const r = await rpc(null, "public_product", { _slug: `${marca}-peca` });
    expect(r.body).toBeNull();
  });
});
