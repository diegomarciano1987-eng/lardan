/**
 * Homologação do núcleo comercial — vitrine individual e motor de pedidos.
 *
 * Cenário 100% sintético (prefixo HOMOLOG): produto, variantes, depósito,
 * contas e maleta próprios. Nenhum produto publicado, foto ou saldo real
 * é tocado. Ao final, os saldos sintéticos da maleta são removidos.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarConta, criarPartySintetica, limpar, rpc, TEST_PREFIX } from "../security/harness";

const URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!;
const SERVICE = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
const ANON = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]!;
const T = 180_000;

const admin = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const txt = await res.text();
  try {
    return { status: res.status, body: JSON.parse(txt) as unknown };
  } catch {
    return { status: res.status, body: txt as unknown };
  }
};

/** Chamada pública: cliente da vitrine não está autenticado. */
const publico = async (fn: string, args: Record<string, unknown>) => {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const txt = await res.text();
  try {
    return { status: res.status, body: JSON.parse(txt) as unknown };
  } catch {
    return { status: res.status, body: txt as unknown };
  }
};

const marca = Date.now();
const slug = `homolog-vitrine-${marca}`;
let tokenMaster: string | null = null;
let tokenConsultora: string | null = null;
let tokenOutra: string | null = null;
let consultoraParty = "";
let deposito = "";
let produto = "";
let varA = "";
let varB = "";
let ciclo = "";

async function saldo(variant: string, quantidade: number) {
  await admin(`/stock_balances?on_conflict=variant_id,location_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ variant_id: variant, location_id: deposito, quantity: quantidade, reserved: 0 }),
  });
}

beforeAll(async () => {
  const master = await criarConta({ nome: "vitrine-master", papeis: ["master"] });
  tokenMaster = master.token;
  const consultora = await criarConta({ nome: "vitrine-consultora", papeis: ["consultora"], comParty: true });
  tokenConsultora = consultora.token;
  consultoraParty = consultora.partyId!;
  const outra = await criarConta({ nome: "vitrine-consultora2", papeis: ["consultora"], comParty: true });
  tokenOutra = outra.token;
  await criarPartySintetica(`vitrine-cliente-${marca}`);

  const dep = await admin(`/locations`, {
    method: "POST",
    body: JSON.stringify({
      code: `HOMOLOG-VIT-${marca}`,
      name: `${TEST_PREFIX} Depósito vitrine ${marca}`,
      kind: "deposito",
      is_active: true,
    }),
  });
  deposito = (dep.body as { id: string }[])[0]!.id;

  // produto sintético completo: precisa passar pelo checklist canônico de publicação
  const cat = await admin(`/categories?select=id&status=eq.publicado&parent_id=is.null&limit=1`);
  const categoria = (cat.body as { id: string }[])[0]!.id;
  const forn = await admin(`/suppliers?select=id&limit=1`);
  const fornecedor = (forn.body as { id: string }[])[0]!.id;
  const banho = await admin(`/plating_types?select=id&limit=1`);
  const banhoId = (banho.body as { id: string }[])[0]!.id;

  const prod = await admin(`/products`, {
    method: "POST",
    body: JSON.stringify({
      name: `${TEST_PREFIX} Peça vitrine ${marca}`,
      slug: `homolog-vitrine-prod-${marca}`,
      internal_code: `HOMVIT${marca}`,
      category_id: categoria,
      raw_material: "Latão HOMOLOG",
      raw_weight_grams: 5,
      raw_supplier_id: fornecedor,
      raw_piece_cost_cents: 1000,
      cost_price_cents: 2000,
      measurements: "2 cm",
      short_description: "Peça sintética de homologação",
      description: "Peça sintética criada apenas para homologar a vitrine individual.",
      care_instructions: "Uso interno de teste.",
      warranty_text: "Sem garantia: registro sintético.",
      seo_title: "HOMOLOG vitrine",
      seo_description: "HOMOLOG vitrine",
      price_cents: 15000,
      supplier_id: fornecedor,
    }),
  });
  produto = (prod.body as { id: string }[])[0]!.id;

  const media = await admin(`/media_assets`, {
    method: "POST",
    body: JSON.stringify({
      url: `https://exemplo.invalid/homolog-${marca}.webp`,
      alt: `${TEST_PREFIX} imagem sintética`,
    }),
  });
  await admin(`/product_media`, {
    method: "POST",
    body: JSON.stringify({ product_id: produto, media_id: (media.body as { id: string }[])[0]!.id, position: 0 }),
  });

  const comum = {
    product_id: produto,
    is_active: true,
    plating_type_id: banhoId,
    plating_supplier_id: fornecedor,
    plating_material_cost_cents: 500,
    varnish_name: "Verniz HOMOLOG",
    varnish_cost_cents: 200,
    finished_piece_cost_cents: 3000,
  };
  const vars = await admin(`/product_variants`, {
    method: "POST",
    body: JSON.stringify([
      { ...comum, sku: `HOM-VIT-${marca}-A`, label: "A", barcode: `999${marca}1`, price_cents: 15000 },
      { ...comum, sku: `HOM-VIT-${marca}-B`, label: "B", barcode: `999${marca}2`, price_cents: 25000 },
    ]),
  });

  // a variante padrão criada pelo gatilho não tem dados de banho: sai de cena
  await admin(`/product_variants?product_id=eq.${produto}&sku=is.null`, {
    method: "PATCH",
    body: JSON.stringify({ is_active: false }),
  });

  const pub = await rpc(tokenMaster, "publish_products", { _ids: [produto], _note: "Homologação vitrine" });
  if ((pub.body as { afetados?: number }).afetados !== 1) {
    throw new Error(`Produto sintético não publicou: ${JSON.stringify(pub.body)}`);
  }
  const criadas = (vars.body as { id: string; sku: string }[]).sort((a, b) => a.sku.localeCompare(b.sku));
  varA = criadas[0]!.id;
  varB = criadas[1]!.id;

  await saldo(varA, 10);
  await saldo(varB, 10);

  // maleta com 3 de A (1 divergente no aceite) e 1 de B
  const c = await rpc(tokenMaster, "kit_cycle_create", {
    _payload: { origin_location_id: deposito, consultora_party_id: consultoraParty },
  });
  ciclo = (c.body as { cycle_id: string }).cycle_id;
  await rpc(tokenMaster, "kit_item_upsert", { _cycle: ciclo, _variant: varA, _qty: 3 });
  await rpc(tokenMaster, "kit_item_upsert", { _cycle: ciclo, _variant: varB, _qty: 1 });
  await rpc(tokenMaster, "kit_conferir", { _cycle: ciclo });
  await rpc(tokenMaster, "kit_expedir", { _cycle: ciclo, _payload: { rota: "direta" } });
  await rpc(tokenConsultora, "kit_aceitar", {
    _cycle: ciclo,
    _itens: [
      { variant_id: varA, qty_accepted: 2, qty_divergent: 1, motivo: "faltou 1 peça" },
      { variant_id: varB, qty_accepted: 1, qty_divergent: 0 },
    ],
    _idempotency_key: `homolog-vitrine-aceite-${marca}`,
  });
}, T);

afterAll(async () => {
  await admin(`/kit_balances?variant_id=in.(${varA},${varB})`, { method: "DELETE" });
  await admin(`/consultant_showcases?slug=eq.${slug}`, { method: "DELETE" });
  // o produto sintético precisou ficar publicado para o teste; sai do ar pela
  // operação canônica, com motivo, antes de qualquer outra limpeza
  await rpc(tokenMaster, "unpublish_products", {
    _ids: [produto],
    _note: "Remoção de produto sintético de homologação",
  });
  await limpar();
}, T);

describe("Vitrine individual e pedidos", () => {
  it(
    "7. endereço reservado do site é recusado e o endereço livre é aceito",
    async () => {
      const reservado = await rpc(tokenConsultora, "showcase_save", {
        _payload: { slug: "semijoias", is_public: true },
      });
      expect(reservado.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(reservado.body)).toMatch(/reservado/i);

      const ok = await rpc(tokenConsultora, "showcase_save", {
        _payload: { slug, headline: "Peças HOMOLOG", is_public: true },
      });
      expect(ok.status).toBe(200);
    },
    T,
  );

  it(
    "8. vitrine mostra só o que foi aceito e está disponível; divergente não aparece",
    async () => {
      const r = await publico("showcase_public", { _slug: slug });
      expect(r.status).toBe(200);
      const itens = (r.body as { itens: { variant_id: string; disponivel: number }[] }).itens;
      const a = itens.find((i) => i.variant_id === varA)!;
      const b = itens.find((i) => i.variant_id === varB)!;
      expect(a.disponivel).toBe(2); // 3 alocadas − 1 divergente
      expect(b.disponivel).toBe(1);
    },
    T,
  );

  it(
    "9. peça oculta pela consultora some da vitrine e volta ao ser publicada",
    async () => {
      await rpc(tokenConsultora, "kit_item_publish", { _cycle: ciclo, _variant: varB, _publicar: false });
      const oculta = await publico("showcase_public", { _slug: slug });
      expect(
        (oculta.body as { itens: { variant_id: string }[] }).itens.some((i) => i.variant_id === varB),
      ).toBe(false);

      await rpc(tokenConsultora, "kit_item_publish", { _cycle: ciclo, _variant: varB, _publicar: true });
      const volta = await publico("showcase_public", { _slug: slug });
      expect(
        (volta.body as { itens: { variant_id: string }[] }).itens.some((i) => i.variant_id === varB),
      ).toBe(true);
    },
    T,
  );

  it(
    "10. pedido da cliente reserva a peça e a mesma chave não gera dois pedidos",
    async () => {
      const chave = `homolog-pedido-${marca}`;
      const p1 = await publico("showcase_order_create", {
        _slug: slug,
        _cliente: { nome: "HOMOLOG Cliente", telefone: "43999990000" },
        _itens: [{ cycle_id: ciclo, variant_id: varA, quantidade: 1 }],
        _idempotency_key: chave,
      });
      expect(p1.status).toBe(200);
      const pedido = (p1.body as { order_id: string; total_cents: number });
      expect(pedido.total_cents).toBe(15000);

      const p2 = await publico("showcase_order_create", {
        _slug: slug,
        _cliente: { nome: "HOMOLOG Cliente" },
        _itens: [{ cycle_id: ciclo, variant_id: varA, quantidade: 1 }],
        _idempotency_key: chave,
      });
      expect((p2.body as { repetido?: boolean }).repetido).toBe(true);

      const vitrine = await publico("showcase_public", { _slug: slug });
      const a = (vitrine.body as { itens: { variant_id: string; disponivel: number }[] }).itens.find(
        (i) => i.variant_id === varA,
      )!;
      expect(a.disponivel).toBe(1); // 2 − 1 reservada
    },
    T,
  );

  it(
    "11. duas clientes disputando a última unidade: só uma leva",
    async () => {
      const disputa = [1, 2].map((n) =>
        publico("showcase_order_create", {
          _slug: slug,
          _cliente: { nome: `HOMOLOG Disputa ${n}` },
          _itens: [{ cycle_id: ciclo, variant_id: varB, quantidade: 1 }],
          _idempotency_key: `homolog-disputa-${marca}-${n}`,
        }),
      );
      const [r1, r2] = await Promise.all(disputa);
      const sucessos = [r1, r2].filter((r) => r.status === 200);
      const falhas = [r1, r2].filter((r) => r.status >= 400);
      expect(sucessos.length).toBe(1);
      expect(falhas.length).toBe(1);
      expect(JSON.stringify(falhas[0]!.body)).toMatch(/Rest(am|a)? apenas|indispon/i);
    },
    T,
  );

  it(
    "12. pedido é visto pela consultora dona e negado a outra consultora",
    async () => {
      const meus = await rpc(tokenConsultora, "orders_list", { _filtros: {} });
      expect(meus.status).toBe(200);
      const lista = meus.body as { id: string; consultora_party_id: string }[];
      expect(lista.length).toBeGreaterThan(0);
      expect(lista.every((p) => p.consultora_party_id === consultoraParty)).toBe(true);

      const alheio = await rpc(tokenOutra, "order_detail", { _order: lista[0]!.id });
      expect(alheio.status).toBeGreaterThanOrEqual(400);

      const listaOutra = await rpc(tokenOutra, "orders_list", { _filtros: {} });
      expect((listaOutra.body as unknown[]).length).toBe(0);
    },
    T,
  );

  it(
    "13. cancelar o pedido devolve a peça para a vitrine e repetir não duplica",
    async () => {
      const meus = await rpc(tokenConsultora, "orders_list", { _filtros: {} });
      // pedido da peça A (R$ 150,00): é a disponibilidade dela que deve voltar
      const alvo = (meus.body as { id: string; status: string; subtotal_cents: number }[]).find(
        (p) => p.status === "aguardando_atendimento" && Number(p.subtotal_cents) === 15000,
      )!;

      const antes = await publico("showcase_public", { _slug: slug });
      const dispAntes = (antes.body as { itens: { variant_id: string; disponivel: number }[] }).itens.find(
        (i) => i.variant_id === varA,
      )?.disponivel;

      const c1 = await rpc(tokenConsultora, "order_set_status", {
        _order: alvo.id,
        _status: "cancelado",
        _note: "Homologação",
      });
      expect(c1.status).toBe(200);

      const c2 = await rpc(tokenConsultora, "order_set_status", { _order: alvo.id, _status: "cancelado" });
      expect(
        c2.status >= 400 || (c2.body as { repetido?: boolean }).repetido === true,
      ).toBe(true);

      const depois = await publico("showcase_public", { _slug: slug });
      const dispDepois = (depois.body as { itens: { variant_id: string; disponivel: number }[] }).itens.find(
        (i) => i.variant_id === varA,
      )?.disponivel;
      expect((dispDepois ?? 0)).toBeGreaterThan(dispAntes ?? 0);
    },
    T,
  );

  it(
    "14. vitrine fora do ar não é acessível publicamente",
    async () => {
      await rpc(tokenConsultora, "showcase_save", { _payload: { slug, is_public: false } });
      const r = await publico("showcase_public", { _slug: slug });
      expect(r.body).toBeNull();

      const pedido = await publico("showcase_order_create", {
        _slug: slug,
        _cliente: { nome: "HOMOLOG Fora do ar" },
        _itens: [{ cycle_id: ciclo, variant_id: varA, quantidade: 1 }],
        _idempotency_key: `homolog-fora-${marca}`,
      });
      expect(pedido.status).toBeGreaterThanOrEqual(400);

      await rpc(tokenConsultora, "showcase_save", { _payload: { slug, is_public: true } });
    },
    T,
  );
});
