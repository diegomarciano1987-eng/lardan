/**
 * 0338 (Diego/Daniel, 19/11/2026) — anéis do aro 4 ao 30 nunca travam na montagem.
 * Banco ISOLADO, dados sintéticos. Cobre: aro com 2 e 1 dígito, base que pede o aro,
 * ajustável que entra direto, aro escolhido na tela, código já usado por outra peça,
 * grade 4–30 idempotente, sequencial que pula números de aro e permissões.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, rpcServico, type Conta } from "./base";

type R = {
  encontrado: boolean; precisa_criar?: boolean; pede_aro?: boolean; ambiguo?: boolean; variant_id?: string;
  product_id?: string; tamanho?: string; forma?: string; variante_criada?: boolean; codigo_proprio?: boolean;
  barcode?: string; aros_existentes?: string[]; opcoes?: { product_id: string; tamanho: string; codigo_base: string }[];
};
type Grade = { criadas: string[]; existentes: string[]; codigo_proprio: { tamanho: string; barcode: string }[]; total_criadas: number };

const sorte = Math.floor(Math.random() * 9000);
const base = String(70000 + sorte);            // anel principal (5 dígitos)
const baseAjust = String(60000 + sorte);       // anel ajustável
const baseCurta = String(50000 + sorte);       // anel cujo "base+18" já é de um brinco
const baseA = String(40000 + sorte);           // ambiguidade: A (5 dígitos) e B = A + '1' (6 dígitos)
let master: Conta, colab: Conta, soVer: Conta;
let anel = "", ajust = "", curto = "", brinco = "", anelA = "", anelB = "";
let seqAntes = 0;

async function produto(nome: string, barras: string, preco = 10990) {
  const slug = `${nome}-${barras}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const p = await adm.unsafe("insert into products(name,slug,status,price_cents) values($1,$2,'rascunho',$3) returning id", [`${nome} ${barras}`, slug, preco]);
  const id = String(p[0].id);
  await adm.unsafe("update product_variants set barcode=$2, price_cents=$3, is_active=true where product_id=$1 and is_default", [id, barras, preco]);
  return id;
}
async function ok<T>(conta: Conta, fn: string, args: Record<string, unknown>) {
  const r = await rpc<T>(conta, fn, args);
  if (r.erro) throw new Error(`${fn}: ${r.erro}`);
  return r.dados;
}
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;

beforeAll(async () => {
  master = await criarConta({ nome: `a338-master-${sorte}`, papeis: ["master"], comParty: true });
  colab = await criarConta({ nome: `a338-colab-${sorte}`, papeis: [], comParty: true });
  soVer = await criarConta({ nome: `a338-ver-${sorte}`, papeis: [], comParty: true });
  for (const c of [colab, soVer]) {
    await adm.unsafe("insert into party_roles(party_id,role) values($1,'colaborador')", [c.partyId]);
    expect((await rpcServico("colab_acesso_registrar", { _user_id: c.uid, _party_id: c.partyId, _codigo: String(Math.floor(10000000 + Math.random() * 80000000)), _actor: master.uid })).erro).toBeNull();
  }
  expect((await rpcServico("colab_modulos_definir", { _user_id: colab.uid, _caps: ["kit.view", "kit.manage", "catalog.view"], _financeiro: false, _actor: master.uid })).erro).toBeNull();
  expect((await rpcServico("colab_modulos_definir", { _user_id: soVer.uid, _caps: ["kit.view", "catalog.view"], _financeiro: false, _actor: master.uid })).erro).toBeNull();
  anel = await produto("AN DOU SOLITARIO GOTA ISO", base);
  ajust = await produto("AN DOU AJUSTAVEL ISO", baseAjust);
  curto = await produto("AN PR CURTO ISO", baseCurta);
  brinco = await produto("BR DOU COLIDE ISO", `${baseCurta}18`, 4990);
  anelA = await produto("AN AMBIG A ISO", baseA);
  anelB = await produto("AN AMBIG B ISO", `${baseA}1`);
  seqAntes = Number((await um<{ v: string }>("select last_value::text v from public.variant_codigo_curto_seq")).v);
});

afterAll(async () => {
  // devolve o sequencial ao ponto de antes (as outras baterias contam com códigos de 5 dígitos)
  await adm.unsafe("select setval('public.variant_codigo_curto_seq', greatest($1::bigint, 1))", [seqAntes]);
});

describe("leitor da montagem", () => {
  test("aro 04 com 2 dígitos: colaboradora que monta registra o tamanho uma vez, com o código da etiqueta", async () => {
    const r = await ok<R>(colab, "barcode_resolver", { _code: `${base}04`, _criar: true, _interativo: true });
    expect(r.forma).toBe("anel_tamanho");
    expect(r.tamanho).toBe("04");
    expect(r.variante_criada).toBe(true);
    expect(r.barcode).toBe(`${base}04`);
    const de_novo = await ok<R>(colab, "barcode_resolver", { _code: `${base}04`, _criar: true, _interativo: true });
    expect(de_novo.variant_id).toBe(r.variant_id);
    const v = await um<{ n: number; size: string; label: string }>(
      "select count(*)::int n, max(size) size, max(label) label from product_variants where product_id=$1 and barcode=$2", [anel, `${base}04`]);
    expect(v).toEqual({ n: 1, size: "04", label: "Aro 04" });
  });

  test("aro 7 com 1 dígito (6 dígitos) vira Aro 07 com código padrão base+07; ler base+07 depois cai na mesma peça", async () => {
    const r = await ok<R>(colab, "barcode_resolver", { _code: `${base}7`, _criar: true, _interativo: true });
    expect(r.tamanho).toBe("07");
    expect(r.barcode).toBe(`${base}07`);
    const r2 = await ok<R>(colab, "barcode_resolver", { _code: `${base}07`, _criar: true, _interativo: true });
    expect(r2.variant_id).toBe(r.variant_id);
    expect(r2.forma).toBe("exato");
  });

  test("aros 4 a 30 com 2 dígitos são aceitos (nenhum aro trava)", async () => {
    for (let a = 4; a <= 30; a++) {
      const t = String(a).padStart(2, "0");
      const r = await ok<R>(colab, "barcode_resolver", { _code: `${base}${t}`, _criar: true, _interativo: true });
      expect(r.encontrado).toBe(true);
      expect(r.variant_id).toBeTruthy();
      expect(r.tamanho).toBe(t);
    }
    const n = await um<{ n: number }>("select count(distinct size)::int n from product_variants where product_id=$1 and size is not null", [anel]);
    expect(n.n).toBe(27);
  });

  test("base do anel lida na montagem pede o aro (com os aros já existentes); fora da montagem, segue como antes", async () => {
    const r = await ok<R>(colab, "barcode_resolver", { _code: base, _criar: true, _interativo: true });
    expect(r.pede_aro).toBe(true);
    expect(r.variant_id).toBeUndefined();
    expect(r.product_id).toBe(anel);
    expect(r.aros_existentes).toContain("04");
    expect(r.aros_existentes).toContain("30");
    const antigo = await ok<R>(colab, "barcode_resolver", { _code: base, _criar: true });
    expect(antigo.pede_aro).toBeUndefined();
    expect(antigo.variant_id).toBeTruthy();
  });

  test("referência digitada (L…) também acha o anel e pede o aro", async () => {
    await adm.unsafe("update products set reference_code=$2 where id=$1", [anel, `LANISO${sorte}`]);
    const r = await ok<R>(colab, "barcode_resolver", { _code: `laniso${sorte}`, _interativo: true });
    expect(r.pede_aro).toBe(true);
    expect(r.product_id).toBe(anel);
  });

  test("anel ajustável lido pela base entra direto, sem perguntar aro", async () => {
    const r = await ok<R>(colab, "barcode_resolver", { _code: baseAjust, _criar: true, _interativo: true });
    expect(r.pede_aro).toBeUndefined();
    expect(r.variant_id).toBeTruthy();
  });

  test("código que cabe em dois anéis (base+2 e base+1) pergunta qual; sem tela, segue a regra de 2 dígitos", async () => {
    const cod = `${baseA}15`; // A + '15' = B + '5'
    const r = await ok<R>(colab, "barcode_resolver", { _code: cod, _criar: true, _interativo: true });
    expect(r.ambiguo).toBe(true);
    expect(r.opcoes?.map((o) => [o.product_id, o.tamanho])).toEqual([[anelA, "15"], [anelB, "05"]]);
    const semTela = await ok<R>(colab, "barcode_resolver", { _code: cod, _criar: true });
    expect(semTela.product_id).toBe(anelA);
    expect(semTela.tamanho).toBe("15");
  });
});

describe("aro escolhido na tela e código já usado", () => {
  test("aro 16 escolhido: cria uma vez e devolve a mesma peça depois", async () => {
    await adm.unsafe("delete from product_variants where product_id=$1 and size='16'", [anel]);
    const r = await ok<R>(colab, "anel_aro_variante", { _product: anel, _tamanho: "16" });
    expect(r.variante_criada).toBe(true);
    expect(r.barcode).toBe(`${base}16`);
    const r2 = await ok<R>(colab, "anel_aro_variante", { _product: anel, _tamanho: "16" });
    expect(r2.variant_id).toBe(r.variant_id);
    expect(r2.variante_criada).toBe(false);
  });

  test("base+18 já é de um brinco: o aro 18 ganha código próprio e o brinco continua com o dele", async () => {
    const r = await ok<R>(colab, "anel_aro_variante", { _product: curto, _tamanho: "18" });
    expect(r.variante_criada).toBe(true);
    expect(r.codigo_proprio).toBe(true);
    expect(r.barcode).not.toBe(`${baseCurta}18`);
    const lido = await ok<R>(colab, "barcode_resolver", { _code: `${baseCurta}18`, _interativo: true });
    expect(lido.product_id).toBe(brinco);
    const peloProprio = await ok<R>(colab, "barcode_resolver", { _code: r.barcode!, _interativo: true });
    expect(peloProprio.variant_id).toBe(r.variant_id);
    const dup = await um<{ n: number }>("select count(*)::int n from product_variants where barcode=$1", [`${baseCurta}18`]);
    expect(dup.n).toBe(1);
  });

  test("aro inválido e peça que não é anel são recusados com mensagem clara", async () => {
    const r = await rpc<R>(colab, "anel_aro_variante", { _product: anel, _tamanho: "0" });
    expect(r.erro).toContain("Aro inválido");
    const b = await rpc<R>(colab, "anel_aro_variante", { _product: brinco, _tamanho: "16" });
    expect(b.erro).toContain("não é anel");
  });

  test("quem só vê não registra aro novo nem gera grade", async () => {
    const r = await rpc<R>(soVer, "anel_aro_variante", { _product: anel, _tamanho: "33" });
    expect(r.erro).toContain("tamanho do anel");
    const g = await rpc<Grade>(soVer, "anel_grade_gerar", { _product: curto, _de: 4, _ate: 30 });
    expect(g.erro).toContain("Sem permissão");
  });
});

describe("grade de aros", () => {
  test("grade 4–30: cria só o que falta, repete sem duplicar, ordena por aro e não toca estoque", async () => {
    const estoqueAntes = await um<{ n: number }>(
      "select count(*)::int n from stock_balances b join product_variants v on v.id=b.variant_id where v.product_id=$1", [curto]);
    const g = await ok<Grade>(master, "anel_grade_gerar", { _product: curto, _de: 4, _ate: 30 });
    expect(g.total_criadas).toBe(26); // o 18 já existia
    expect(g.existentes).toEqual(["18"]);
    const g2 = await ok<Grade>(master, "anel_grade_gerar", { _product: curto, _de: 4, _ate: 30 });
    expect(g2.total_criadas).toBe(0);
    const ordem = (await adm.unsafe(
      "select size from product_variants where product_id=$1 and size is not null order by position", [curto])) as { size: string }[];
    expect(ordem.map((o) => o.size)).toEqual(Array.from({ length: 27 }, (_, i) => String(i + 4).padStart(2, "0")));
    const barras = (await adm.unsafe("select barcode from product_variants where product_id=$1 and size='25'", [curto])) as { barcode: string }[];
    expect(barras[0]!.barcode).toBe(`${baseCurta}25`);
    const estoqueDepois = await um<{ n: number }>(
      "select count(*)::int n from stock_balances b join product_variants v on v.id=b.variant_id where v.product_id=$1", [curto]);
    expect(estoqueDepois.n).toBe(estoqueAntes.n);
    const log = await um<{ n: number }>("select count(*)::int n from audit_logs where action='produto.anel_grade.gerada' and entity_id=$1", [curto]);
    expect(log.n).toBe(2);
  });

  test("grade fora de 1–60 ou invertida é recusada", async () => {
    const g = await rpc<Grade>(master, "anel_grade_gerar", { _product: curto, _de: 30, _ate: 4 });
    expect(g.erro).toContain("Grade inválida");
  });
});

describe("sequencial de 5 dígitos", () => {
  test("nunca entrega base de anel + 2 dígitos", async () => {
    const baseAlta = String(900000 + sorte); // anel com base de 6 dígitos
    await produto("AN SEQ ISO", baseAlta);
    await adm.unsafe("select setval('public.variant_codigo_curto_seq', $1::bigint)", [Number(baseAlta) * 100 - 1]);
    const r = await um<{ c: string }>("select public.variant_ean_next() c");
    expect(r.c.startsWith(baseAlta)).toBe(false);
    expect(Number(r.c)).toBe(Number(baseAlta) * 100 + 100);
  });
});
