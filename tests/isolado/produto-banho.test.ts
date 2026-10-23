/**
 * 0126 — banho no material bruto, custo pelo banho e reclassificação pela descrição.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, ler, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, consultora: Conta;

const classificar = async (nome: string) =>
  (await um<{ c: { banho: string | null; categoria: string | null } }>(`select public.produto_classificar_nome($1) c`, [nome])).c;

async function produto(nome: string, extra: Record<string, unknown> = {}) {
  const cols = ["name", "slug", "status", ...Object.keys(extra)];
  const vals = [nome, `e2e-${marca}-${Math.random().toString(36).slice(2, 8)}`, "rascunho", ...Object.values(extra)];
  return (await um<{ id: string }>(
    `insert into public.products (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`, vals)).id;
}
const ler1 = (id: string) =>
  um<{ banho_tipo: string | null; banho_camada: number | null; cost: number | null; flag: boolean; cat: string | null; origem: string | null }>(
    `select banho_tipo, banho_camada, cost_price_cents::int cost, custo_pelo_banho flag, category_id::text cat, banho_origem origem from public.products where id=$1`, [id]);

beforeAll(async () => {
  master = await criarConta({ nome: `banho-master-${marca}`, papeis: ["master"], comParty: true });
  consultora = await criarConta({ nome: `banho-cons-${marca}`, papeis: ["consultora"], comParty: true });
});

describe("1. leitura da descrição", () => {
  test.each([
    ["BR DOU ARGOLA LISA", "dourado", "brinco"],
    ["PROMOÇÃO BR PR CORAÇÃO", "prata_banhada", "brinco"],
    ["PROMOÇÃOBRINCO DOUR MINI", "dourado", "brinco"],
    ["BR PR925 PONTO LUZ", "prata_925", "brinco"],
    ["AN PR 925 CRAVEJADO", "prata_925", "anel"],
    ["GR AÇO INOX GRUMET 0,4MM", "aco_inox", "colar"],
    ["BRINCO LAÇO PEROLA", null, "brinco"],                     // LAÇO não é aço
    ["COLAR LONGO TRAÇOS DOURADOS", "dourado", "colar"],
    ["GARGANTILHA RODIO BRANCO ESTRELAS", "rodio_branco", "colar"],
    ["BRINCO ARGOLA RODIO NEGRO", null, "brinco"],              // ródio negro: fora da lista, fica para o Master
    ["GR RODIO+DOU ELOS MIX BANHOS", null, "colar"],            // dois banhos: não decide
    ["PUL AÇO PRETO CORDAO", "aco_inox", "pulseira"],
    ["TN CANUTILHOS MINI BOLAS", null, "tornozeleira"],
    ["BC PEROLAS", null, "bracelete"],
    ["DOU (DUPLO) ARGOLA PG. GOTA", "dourado", "brinco"],
    ["PULSEIRA PEROLAS FECHO BOIA", null, "pulseira"],
    ["PROMOÇAO PT LUZ OVAL", null, null],                       // PT é ponto, não prata
  ])("%s", async (nome, banho, categoria) => {
    expect(await classificar(nome)).toMatchObject({ banho, categoria });
  });
});

describe("2. custo pelo banho (só para cadastro novo)", () => {
  test("ficha nova: peso × banho por grama + peça no bruto vira o preço de custo", async () => {
    const r = await rpc<{ id: string }>(master, "product_save", { _id: null, _payload: {
      name: `Brinco banho ${marca}`, raw_weight_grams: "2.5", raw_piece_cost_cents: 1000, cost_price_cents: "" } });
    expect(r.erro).toBeNull();
    const b = await rpc<{ cost_price_cents: number; custo_pelo_banho: boolean }>(master, "product_banho_salvar",
      { _product: r.dados.id, _tipo: "dourado", _camada: 3, _valor_grama_cents: 300, _alterar_valor: true });
    expect(b.erro).toBeNull();
    expect(b.dados).toMatchObject({ cost_price_cents: 1750, custo_pelo_banho: true });   // 2,5 × 3,00 + 10,00
    // mudou o valor do banho: o custo acompanha
    await rpc(master, "product_banho_salvar", { _product: r.dados.id, _tipo: "dourado", _camada: 3, _valor_grama_cents: 400, _alterar_valor: true });
    expect((await ler1(r.dados.id)).cost).toBe(2000);
    // salvar a ficha de novo (custo vazio, como a tela manda) mantém a conta
    await rpc(master, "product_save", { _id: r.dados.id, _payload: {
      name: `Brinco banho ${marca}`, raw_weight_grams: "2.5", raw_piece_cost_cents: 1000, cost_price_cents: "" } });
    expect((await ler1(r.dados.id)).cost).toBe(2000);
  });

  test("produto que já tinha preço de custo não muda", async () => {
    const id = await produto(`Antigo ${marca}`, { raw_weight_grams: 3, raw_piece_cost_cents: 800, cost_price_cents: 5000 });
    const b = await rpc(master, "product_banho_salvar", { _product: id, _tipo: "prata_banhada", _camada: 70, _valor_grama_cents: 250, _alterar_valor: true });
    expect(b.erro).toBeNull();
    expect(await ler1(id)).toMatchObject({ cost: 5000, flag: false, banho_tipo: "prata_banhada", banho_camada: 70, origem: "cadastro" });
  });

  test("camada só nos valores permitidos", async () => {
    const id = await produto(`Camada ${marca}`);
    expect((await rpc(master, "product_banho_salvar", { _product: id, _tipo: "dourado", _camada: 4 })).erro).toContain("Camada inválida");
    expect((await rpc(master, "product_banho_salvar", { _product: id, _tipo: "aco_inox", _camada: 30 })).erro).toContain("Camada inválida");
    expect((await rpc(master, "product_banho_salvar", { _product: id, _tipo: "prata_banhada", _camada: 30 })).erro).toBeNull();
    expect((await rpc(master, "product_banho_salvar", { _product: id, _tipo: "ouro", _camada: null })).erro).toContain("inválido");
  });

  test("valor do banho é custo: fora da leitura direta, só pela leitura autorizada", async () => {
    const id = await produto(`Leitura ${marca}`, { banho_valor_grama_cents: 300 });
    const direto = await ler(master, `select banho_valor_grama_cents from public.products where id=$1`, [id]);
    expect(direto.ok).toBe(false);
    const tipo = await ler(master, `select banho_tipo, banho_camada from public.products where id=$1`, [id]);
    expect(tipo.ok).toBe(true);
    const c = await rpc<{ produto: { banho_valor_grama_cents: number } }>(master, "product_costs_read", { _product: id });
    expect(c.dados.produto.banho_valor_grama_cents).toBe(300);
    expect((await rpc(consultora, "product_banho_salvar", { _product: id, _tipo: "dourado", _camada: 1 })).ok).toBe(false);
  });
});

describe("3. reclassificação pela descrição", () => {
  let vazio = "", comBanho = "", divergente = "", semPista = "", catBrinco = "", catAnel = "", lote = "";
  beforeAll(async () => {
    catBrinco = (await um<{ id: string }>(`insert into public.categories (name, slug, status) values ($1,$2,'rascunho') returning id`,
      [`Brincos`, `brincos-${marca}`]).catch(async () => um<{ id: string }>(
        `select id from public.categories where parent_id is null and upper(name) in ('BRINCO','BRINCOS') limit 1`))).id;
    catAnel = (await um<{ id: string } | undefined>(`select id from public.categories where parent_id is null and upper(translate(name,'é','e')) in ('ANEL','ANEIS') limit 1`))?.id ?? "";
    if (!catAnel) catAnel = (await um<{ id: string }>(`insert into public.categories (name, slug, status) values ('Anéis',$1,'rascunho') returning id`, [`aneis-${marca}`])).id;
    vazio = await produto(`BR DOU ARGOLA ${marca}`);
    comBanho = await produto(`BR PR CORAÇÃO ${marca}`, { banho_tipo: "dourado", banho_origem: "cadastro" });
    divergente = await produto(`AN DOU SOLITARIO ${marca}`, { category_id: catBrinco });
    semPista = await produto(`PEÇA SEM PISTA ${marca}`);
  });

  test("prévia não grava nada", async () => {
    const r = await rpc<{ aplicado: boolean; categoria: { divergentes: number } }>(master, "produto_reclassificar", {});
    expect(r.erro).toBeNull();
    expect(r.dados.aplicado).toBe(false);
    expect(r.dados.categoria.divergentes).toBeGreaterThanOrEqual(1);
    expect(await ler1(vazio)).toMatchObject({ banho_tipo: null, cat: null });
  });

  test("aplicar preenche só o vazio; banho do cadastro e categoria divergente ficam", async () => {
    const r = await rpc<{ lote: string }>(master, "produto_reclassificar", { _aplicar: true });
    expect(r.erro).toBeNull();
    lote = r.dados.lote;
    expect(await ler1(vazio)).toMatchObject({ banho_tipo: "dourado", origem: "descricao", cat: catBrinco });
    expect(await ler1(comBanho)).toMatchObject({ banho_tipo: "dourado", origem: "cadastro" });   // não vira prata
    expect(await ler1(divergente)).toMatchObject({ cat: catBrinco, banho_tipo: "dourado" });     // categoria só com _corrigir_divergentes
    expect(await ler1(semPista)).toMatchObject({ banho_tipo: null, cat: null });
  });

  test("divergentes só quando pedido; desfazer volta tudo do lote", async () => {
    const r = await rpc<{ lote: string }>(master, "produto_reclassificar", { _aplicar: true, _corrigir_divergentes: true });
    expect((await ler1(divergente)).cat).toBe(catAnel);
    const d = await rpc(master, "produto_reclassificacao_desfazer", { _lote: r.dados.lote });
    expect(d.erro).toBeNull();
    expect((await ler1(divergente)).cat).toBe(catBrinco);
    await rpc(master, "produto_reclassificacao_desfazer", { _lote: lote });
    expect(await ler1(vazio)).toMatchObject({ banho_tipo: null, cat: null });
    expect(await ler1(comBanho)).toMatchObject({ banho_tipo: "dourado", origem: "cadastro" });
  });

  test("só o Master reclassifica", async () => {
    expect((await rpc(consultora, "produto_reclassificar", {})).ok).toBe(false);
    expect((await rpc(consultora, "produto_reclassificacao_desfazer", { _lote: "x" })).ok).toBe(false);
  });
});
