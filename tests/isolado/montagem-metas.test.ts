/**
 * Metas da montagem pelo histórico (migração 0113) — banco ISOLADO, dados sintéticos.
 *  1. A tela de bipagem recebe metas por tipo que somam exatamente o total.
 *  2. O total sai da média das 3 últimas maletas dela (ou do informado, ou do padrão).
 *  3. Puxa para o que ela vende e aponta onde ela gira acima/abaixo da praça.
 *  4. Sem histórico: modo padrão com as metas de remessa_parametros.
 *  5. Só a equipe de montagem lê; consultora e representante não.
 *  6. De-para de categoria só pelo Master, auditado.
 *  7. Nada muda na maleta nem no estoque.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarVariante, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 700000 + Math.floor(Math.random() * 90000);
const REM = 70000 + Math.floor(Math.random() * 9000);
const cod = (i: number) => base + i;

let master: Conta, estoque: Conta, consA: Conta, consNova: Conta, rep: Conta;
let cicloA = "", cicloNova = "", varianteCampea = "";

type Metas = Record<"brinco" | "anel" | "colar" | "pulseira" | "tornozeleira" | "outro", number>;
interface Resultado {
  vinculada: boolean; modo_sugerido: "historico" | "padrao"; confianca: string;
  total_pecas: number; total_origem: string; maletas_fechadas: number;
  metas_padrao: Metas; metas_historico: Metas | null;
  categorias: { categoria: string; tipo: string; pecas_sugeridas: number }[];
  destaques: { categoria: string; sinal: string }[];
  ultimas_maletas: { remessa: number; fechamento: string }[];
  variantes_campeas: string[];
}
const soma = (m: Metas) => Object.values(m).reduce((t, n) => t + n, 0);

async function importar(tipo: string, linhas: Record<string, unknown>[]) {
  const r = await rpc(master, "legado_importar", { _tipo: tipo, _lote: `iso-metas-${base}`, _linhas: linhas });
  if (r.erro) throw new Error(r.erro);
}
const maleta = (remessa: number, c: number, enviadas: number, devolvidas: number, fechamento: string) =>
  ({ remessa, codcli: c, kit: 1, tipo: "remessa", emissao: "2025-01-01", fechamento, pecas_enviadas: enviadas,
     pecas_devolvidas: devolvidas, pecas_defeito: 0, valor_enviado: enviadas * 50, valor_devolvido: devolvidas * 50 });
const cat = (remessa: number, c: number, categoria: string, env: number, dev: number) =>
  ({ remessa, codcli: c, kit: 1, categoria, pecas_enviadas: env, pecas_devolvidas: dev, valor_enviado: env * 50, valor_devolvido: dev * 50 });

async function novoCiclo(party: string) {
  const kit = (await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [`ISO METAS ${base}-${Math.random()}`])).id;
  return (await um<{ id: string }>(`insert into public.kit_cycles (kit_id, cycle_no, consultora_party_id) values ($1,1,$2) returning id`, [kit, party])).id;
}

beforeAll(async () => {
  master = await criarConta({ nome: "master-metas", papeis: ["master"], comParty: true });
  estoque = await criarConta({ nome: "est-metas", papeis: ["estoque"], comParty: true });
  consA = await criarConta({ nome: "consA-metas", papeis: ["consultora"], comParty: true });
  consNova = await criarConta({ nome: "consNova-metas", papeis: ["consultora"], comParty: true });
  rep = await criarConta({ nome: "rep-metas", papeis: ["representante"], comParty: true });

  await importar("pracas", [{ codigo: base, nome: "PRACA METAS", dias: "42", cidades: "Ibiporã/PR" }]);
  await importar("consultoras", [
    { codcli: cod(1), nome: "Ana Metas", cpf: "", cidade: "Ibiporã", uf: "PR", praca: base, ativo: "1" },
    { codcli: cod(2), nome: "Bia Metas", cpf: "", cidade: "Ibiporã", uf: "PR", praca: base, ativo: "1" },
  ]);
  await importar("produtos", [
    { codigo: cod(51), nome: "Anel campeão", referencia: `MET-${base}-1`, categoria: "ANEL", subcategoria: "", ativo: "1", preco_venda: "80.00" },
  ]);
  await importar("remessas", [1, 2, 3].map((i) =>
    ({ numero: REM + i, emissao: "2025-01-01", vencimento: "2025-02-15", status: "fechada", praca: base, representante: "" })));
  // Ana: 3 maletas fechadas (50, 60, 70 peças) — vende muito anel
  const ana = [[1, 50, "2025-02-10"], [2, 60, "2025-04-10"], [3, 70, "2025-06-10"]] as const;
  await importar("maletas", [
    ...ana.map(([r, e, f]) => maleta(REM + r, cod(1), e, e - 18, f)),
    maleta(REM + 1, cod(2), 350, 285, "2025-02-10"),
  ]);
  await importar("maleta_categorias", [
    ...ana.flatMap(([r, e]) => [cat(REM + r, cod(1), "BRINCO", e - 20, e - 20 - 6), cat(REM + r, cod(1), "ANEL", 20, 8)]),
    cat(REM + 1, cod(2), "BRINCO", 200, 150), cat(REM + 1, cod(2), "ANEL", 100, 90), cat(REM + 1, cod(2), "PIERCING", 50, 45),
  ]);
  await importar("maleta_vendidos", [{ remessa: REM + 3, codcli: cod(1), kit: 1, produto: cod(51), tamanho: "U", quantidade: 9, valor_unitario: "80.00" }]);

  // vínculos (o fluxo oficial de vínculo é testado em historico-jflex.test.ts)
  varianteCampea = await criarVariante("metas-campea");
  await adm.unsafe(`update public.legado_produtos set variant_id=$2,
                      product_id=(select product_id from public.product_variants where id=$2) where codigo=$1`, [cod(51), varianteCampea]);
  await adm.unsafe(`update public.legado_consultoras set party_id=$2, vinculo='manual' where codcli=$1`, [cod(1), consA.partyId]);

  cicloA = await novoCiclo(consA.partyId!);
  cicloNova = await novoCiclo(consNova.partyId!);
});

afterAll(async () => {
  for (const t of ["legado_maleta_vendidos", "legado_maleta_categorias", "legado_maletas"])
    await adm.unsafe(`delete from public.${t} where codcli between $1 and $2`, [base, base + 99]);
  await adm.unsafe(`delete from public.legado_remessas where numero between $1 and $2`, [REM, REM + 99]);
  await adm.unsafe(`delete from public.legado_consultoras where codcli between $1 and $2`, [base, base + 99]);
  await adm.unsafe(`delete from public.legado_produtos where codigo between $1 and $2`, [base, base + 99]);
  await adm.unsafe(`delete from public.legado_pracas where codigo = $1`, [base]);
  await adm.unsafe(`delete from public.legado_categoria_tipo where categoria = $1`, [`ISO-${base}`]);
});

describe("montagem pelo histórico", () => {
  test("metas por tipo somam o total, que vem da média das 3 últimas maletas", async () => {
    const r = await rpc<Resultado>(estoque, "montagem_metas_ciclo", { _cycle: cicloA });
    expect(r.erro).toBeNull();
    // 0155: total sugerido = média das peças VENDIDAS nas 3 últimas maletas × 1,3 (18 × 1,3 = 23,4 → 24)
    expect(r.dados).toMatchObject({ vinculada: true, modo_sugerido: "historico", confianca: "alta",
      total_pecas: 24, total_origem: "historico", maletas_fechadas: 3 });
    expect(soma(r.dados.metas_historico!)).toBe(24);
    expect(r.dados.ultimas_maletas.map((m) => m.remessa)).toEqual([REM + 3, REM + 2, REM + 1]);
  });

  test("com 60 peças, a distribuição puxa para o que ela vende", async () => {
    const r = await rpc<Resultado>(estoque, "montagem_metas_ciclo", { _cycle: cicloA, _total: 60 });
    expect(r.erro).toBeNull();
    expect(soma(r.dados.metas_historico!)).toBe(60);
    // puxa para anel (ela gira 60% em anel; a praça, bem menos)
    expect(r.dados.metas_historico!.anel).toBeGreaterThan(r.dados.metas_historico!.brinco);
    // PIERCING não é tipo do leitor: entra em "outro" e ganha o piso de 2%
    expect(r.dados.metas_historico!.outro).toBeGreaterThanOrEqual(1);
    expect(r.dados.categorias.find((c) => c.categoria === "PIERCING")!.tipo).toBe("outro");
    expect(r.dados.destaques).toContainEqual(expect.objectContaining({ categoria: "ANEL", sinal: "forte" }));
    expect(r.dados.ultimas_maletas.map((m) => m.remessa)).toEqual([REM + 3, REM + 2, REM + 1]);
    expect(r.dados.variantes_campeas).toContain(varianteCampea);
  });

  test("total informado pelo montador", async () => {
    const r = await rpc<Resultado>(estoque, "montagem_metas_ciclo", { _cycle: cicloA, _total: 41 });
    expect(r.dados).toMatchObject({ total_pecas: 41, total_origem: "informado" });
    expect(soma(r.dados.metas_historico!)).toBe(41);
    expect((await rpc(estoque, "montagem_metas_ciclo", { _cycle: cicloA, _total: 0 })).ok).toBe(false);
  });

  test("consultora sem histórico: modo padrão com as metas de remessa_parametros", async () => {
    const p = await um<{ pecas_cliente_nova: number }>(`select pecas_cliente_nova from public.remessa_parametros`);
    const r = await rpc<Resultado>(master, "montagem_metas_ciclo", { _cycle: cicloNova });
    expect(r.erro).toBeNull();
    expect(r.dados).toMatchObject({ vinculada: false, modo_sugerido: "padrao", confianca: "baixa",
      total_pecas: p.pecas_cliente_nova, total_origem: "parametro" });
    expect(soma(r.dados.metas_padrao)).toBe(p.pecas_cliente_nova);
  });

  test("consultora (mesmo a dona da maleta) e representante não leem", async () => {
    expect((await rpc(consA, "montagem_metas_ciclo", { _cycle: cicloA })).ok).toBe(false);
    expect((await rpc(rep, "montagem_metas_ciclo", { _cycle: cicloA })).ok).toBe(false);
    expect((await rpc(consA, "legado_categoria_tipo_lista")).ok).toBe(false);
  });

  test("de-para de categoria: só Master, auditado", async () => {
    const nome = `ISO-${base}`;
    expect((await rpc(estoque, "legado_categoria_tipo_definir", { _categoria: nome, _tipo: "anel" })).ok).toBe(false);
    expect((await rpc(master, "legado_categoria_tipo_definir", { _categoria: nome, _tipo: "voador" })).ok).toBe(false);
    expect((await rpc(master, "legado_categoria_tipo_definir", { _categoria: nome.toLowerCase(), _tipo: "anel" })).erro).toBeNull();
    const l = await rpc<{ categoria: string; tipo: string }[]>(master, "legado_categoria_tipo_lista");
    expect(l.dados).toContainEqual(expect.objectContaining({ categoria: nome, tipo: "anel" }));
    expect((await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='legado.categoria_tipo' and entity_id=$1`, [nome])).n).toBe(1);
  });

  test("só leitura: a maleta continua vazia", async () => {
    const n = await um<{ n: number }>(`select count(*)::int n from public.kit_balances where cycle_id = any($1::uuid[])`, [`{${cicloA},${cicloNova}}`]);
    expect(n.n).toBe(0);
  });
});
