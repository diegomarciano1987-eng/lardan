/**
 * 0335 (Diego, 18/11/2026) — tamanhos de anel que a consultora mais vende, no Histórico SmallData
 * e no Histórico de vendas da montagem. Só leitura. Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 600000 + Math.floor(Math.random() * 90000);
let master: Conta, montadora: Conta, ana: Conta, bia: Conta;
type Dados = { total: number; com_tamanho: number; sem_tamanho: number; tamanhos: { tamanho: string; qtd: number; pct: number }[] };

async function ok<T>(conta: Conta, fn: string, args: Record<string, unknown>) {
  const r = await rpc<T>(conta, fn, args);
  if (r.erro) throw new Error(`${fn}: ${r.erro}`);
  return r.dados;
}

beforeAll(async () => {
  master = await criarConta({ nome: `a335-master-${base}`, papeis: ["master"], comParty: true });
  montadora = await criarConta({ nome: `a335-mont-${base}`, papeis: ["montagem"], comParty: true });
  ana = await criarConta({ nome: `a335-ana-${base}`, papeis: ["consultora"], comParty: true });
  bia = await criarConta({ nome: `a335-bia-${base}`, papeis: ["consultora"], comParty: true });
  const cod = 800000 + (base % 90000);
  await adm.unsafe(`insert into public.legado_consultoras (codcli, party_id, nome) values ($1,$2,'iso')`, [cod, ana.partyId]);
  await adm.unsafe(
    `insert into public.legado_produtos (codigo, nome, categoria) values ($1,'AN DOU X','ANEL'),($2,'AN PR AJUSTAVEL','ANEL'),($3,'BR DOU','BRINCO')`,
    [cod, cod + 1, cod + 2]);
  // aro 20: 3 peças · aro 22: 2 · aro 07: 1 · ajustável (U): 4 · brinco com "tamanho" não conta
  await adm.unsafe(
    `insert into public.legado_maleta_vendidos (remessa, codcli, kit, produto, tamanho, quantidade) values
       (1,$1,1,$2,'20',2),(2,$1,1,$2,'20',1),(1,$1,1,$2,'22',2),(1,$1,1,$2,'07',1),(1,$1,1,$3,'U',4),(1,$1,1,$4,'20',9)`,
    [cod, cod, cod + 1, cod + 2]);
});

describe("tamanho do anel pela peça", () => {
  test("tamanho cadastrado; senão os 2 últimos dígitos do código (código antigo + aro); 'Aro N'; ajustável = sem tamanho", async () => {
    const r = await um<Record<string, string | null>>(
      `select public.anel_tamanho_peca('24', null, null, null) a,
              public.anel_tamanho_peca(null, '1846624', '18466', null) b,
              public.anel_tamanho_peca(null, '18113', '18113', 'AN DOU') c,
              public.anel_tamanho_peca('U', null, null, null) d,
              public.anel_tamanho_peca(null, null, null, 'Aro 07') e,
              public.anel_tamanho_peca('07', null, null, null) f`);
    expect(r).toEqual({ a: "24", b: "24", c: null, d: null, e: "7", f: "7" });
  });
});

describe("tamanhos mais vendidos da consultora", () => {
  test("ordena pelos mais vendidos, conta ajustável à parte e ignora outras categorias", async () => {
    const d = await ok<Dados>(master, "consultora_aneis_tamanhos", { _party: ana.partyId });
    expect(d.total).toBe(10);
    expect(d.com_tamanho).toBe(6);
    expect(d.sem_tamanho).toBe(4);
    expect(d.tamanhos).toEqual([
      { tamanho: "20", qtd: 3, pct: 50 },
      { tamanho: "22", qtd: 2, pct: 33 },
      { tamanho: "7", qtd: 1, pct: 17 },
    ]);
  });

  test("montadora lê (montagem da rede); outra consultora não; a própria consultora lê o dela", async () => {
    expect((await ok<Dados>(montadora, "consultora_aneis_tamanhos", { _party: ana.partyId })).com_tamanho).toBe(6);
    expect((await rpc(bia, "consultora_aneis_tamanhos", { _party: ana.partyId })).erro).not.toBeNull();
    expect((await ok<Dados>(ana, "consultora_aneis_tamanhos", { _party: ana.partyId })).total).toBe(10);
  });

  test("sem venda de anel: tudo zero, lista vazia (nunca inventa tamanho)", async () => {
    expect(await ok<Dados>(master, "consultora_aneis_tamanhos", { _party: bia.partyId }))
      .toEqual({ total: 0, com_tamanho: 0, sem_tamanho: 0, tamanhos: [] });
  });

  test("a parte interna só roda pelo serviço", async () => {
    expect((await rpc(master, "consultora_aneis_tamanhos_dados", { _party: ana.partyId })).erro).not.toBeNull();
  });
});
