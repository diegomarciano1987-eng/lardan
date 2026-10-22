/**
 * BI do histórico (0117) e correções (0116) — banco ISOLADO, dados sintéticos.
 *  1. Valor devolvido zerado na maleta é corrigido pelas categorias, em qualquer ordem de importação.
 *  2. Painel: KPIs, % vendido por maleta, Pareto e período anterior batem com o importado.
 *  3. Cadastros internos (LARDAN, maleta de fotos) ficam fora do BI.
 *  4. Top consultoras geral e por praça; giro exige mínimo de maletas.
 *  5. Jornada, alertas e frases prontas.
 *  6. Só a equipe lê; consultora e representante não.
 *  7. Cadastros criados pelo histórico: prévia, ajuste (praça e inativa) e a rotina nova.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 600000 + Math.floor(Math.random() * 90000);
const REM = 50000 + Math.floor(Math.random() * 9000);
const cod = (i: number) => base + i;
const P1 = base, P2 = base + 1;   // duas praças

let master: Conta, financeiro: Conta, consultora: Conta, rep: Conta;

async function importar(tipo: string, linhas: Record<string, unknown>[]) {
  const r = await rpc(master, "legado_importar", { _tipo: tipo, _lote: `iso-bi-${base}`, _linhas: linhas });
  if (r.erro) throw new Error(`${tipo}: ${r.erro}`);
}
/** Servidor (service_role, sem usuário). */
async function servico<T>(sql: string, p: unknown[] = []) {
  const c = await adm.reserve();
  try {
    await c.unsafe(`set role service_role`);
    await c.unsafe(`select set_config('lardan.test_role','service_role',false), set_config('lardan.test_uid','',false)`);
    return ((await c.unsafe(sql, p)) as T[])[0]!;
  } finally {
    try { await c.unsafe(`reset role`); await c.unsafe(`select set_config('lardan.test_role','',false)`); } catch { /* */ }
    c.release();
  }
}
const maleta = (remessa: number, c: number, env: number, dev: number, emissao: string, fechamento: string | null, kit = 1, valorDev?: number) =>
  ({ remessa, codcli: c, kit, tipo: "remessa", emissao, fechamento: fechamento ?? "", pecas_enviadas: env, pecas_devolvidas: dev,
     pecas_defeito: 0, valor_enviado: env * 100, valor_devolvido: valorDev ?? dev * 100 });
const cat = (remessa: number, c: number, categoria: string, env: number, dev: number, kit = 1) =>
  ({ remessa, codcli: c, kit, categoria, pecas_enviadas: env, pecas_devolvidas: dev, valor_enviado: env * 100, valor_devolvido: dev * 100 });

beforeAll(async () => {
  master = await criarConta({ nome: "master-bi", papeis: ["master"], comParty: true });
  financeiro = await criarConta({ nome: "fin-bi", papeis: ["financeiro"], comParty: true });
  consultora = await criarConta({ nome: "cons-bi", papeis: ["consultora"], comParty: true });
  rep = await criarConta({ nome: "rep-bi", papeis: ["representante"], comParty: true });

  await importar("pracas", [{ codigo: P1, nome: "BI NORTE", dias: "42", cidades: "" }, { codigo: P2, nome: "BI SUL", dias: "42", cidades: "" }]);
  await importar("consultoras", [
    { codcli: cod(1), nome: `Estrela ${base}`, cpf: "", cidade: "A", uf: "PR", praca: P1, ativo: "1" },
    { codcli: cod(2), nome: `Media ${base}`, cpf: "", cidade: "A", uf: "PR", praca: P1, ativo: "1" },
    { codcli: cod(3), nome: `Zerada ${base}`, cpf: "", cidade: "B", uf: "PR", praca: P2, ativo: "1" },
    { codcli: cod(4), nome: "LARDAN SEMIJOIAS", cpf: "", cidade: "Ibiporã", uf: "PR", praca: P2, ativo: "0" },
  ]);
  await importar("remessas", [1, 2, 3, 4].map((i) =>
    ({ numero: REM + i, emissao: `2025-0${i}-01`, vencimento: `2025-0${i}-28`, status: i < 4 ? "fechada" : "aberta", praca: i % 2 ? P1 : P2, representante: "" })));
  // Estrela (P1): 3 maletas boas; Média (P1): 2 maletas; Zerada (P2): 2 zeradas + 1 na rua; LARDAN (interna) vende muito
  await importar("maletas", [
    maleta(REM + 1, cod(1), 50, 30, "2025-01-01", "2025-02-15"),       // 20 vendidas
    maleta(REM + 3, cod(1), 50, 35, "2025-03-01", "2025-04-15"),       // 15
    maleta(REM + 1, cod(2), 50, 45, "2025-01-01", "2025-02-15"),       // 5
    maleta(REM + 3, cod(2), 50, 50, "2025-03-01", "2025-04-15"),       // 0
    maleta(REM + 2, cod(3), 40, 40, "2025-02-01", "2025-03-15"),       // 0
    maleta(REM + 4, cod(3), 40, 40, "2025-04-01", "2025-05-15"),       // 0 (acertada em remessa aberta)
    maleta(REM + 2, cod(4), 40, 0, "2025-02-01", "2025-03-15"),        // interna: fora do BI
    // valor devolvido ZERADO no arquivo (defeito real do SmallData): categorias trazem o certo
    maleta(REM + 3, cod(1), 40, 30, "2025-03-01", "2025-04-15", 2, 0),   // 10, 2º kit da mesma remessa
  ]);
  await importar("maleta_categorias", [
    cat(REM + 1, cod(1), "BRINCO", 30, 20), cat(REM + 1, cod(1), "ANEL", 20, 10),
    cat(REM + 3, cod(1), "BRINCO", 30, 22), cat(REM + 3, cod(1), "ANEL", 20, 13),
    cat(REM + 1, cod(2), "BRINCO", 50, 45), cat(REM + 3, cod(2), "BRINCO", 50, 50),
    cat(REM + 2, cod(3), "BRINCO", 40, 40), cat(REM + 4, cod(3), "BRINCO", 40, 40),
    cat(REM + 3, cod(1), "BRINCO", 40, 30, 2),
  ]);
  await importar("produtos", [{ codigo: cod(51), nome: "Argola BI", referencia: `BI-${base}`, categoria: "BRINCO", subcategoria: "ARGOLA", ativo: "1", preco_venda: "1.00" }]);
  await importar("maleta_vendidos", [{ remessa: REM + 1, codcli: cod(1), kit: 1, produto: cod(51), tamanho: "U", quantidade: 12, valor_unitario: "1.00" }]);
  // Zerada ainda tem uma maleta na rua (sem acerto)
  await importar("remessas", [{ numero: REM + 5, emissao: "2025-06-01", vencimento: "2025-07-15", status: "aberta", praca: P2, representante: "" }]);
  await importar("maletas", [maleta(REM + 5, cod(3), 60, 0, "2025-06-01", null)]);
});

afterAll(async () => {
  for (const t of ["legado_acertos_consultora", "legado_maleta_vendidos", "legado_maleta_categorias", "legado_maletas"])
    await adm.unsafe(`delete from public.${t} where codcli between $1 and $2`, [base, base + 99]);
  await adm.unsafe(`delete from public.legado_remessas where numero between $1 and $2`, [REM, REM + 99]);
  await adm.unsafe(`update public.legado_consultoras set party_id = null where codcli between $1 and $2`, [base, base + 99]);
  await adm.unsafe(`delete from public.legado_consultoras where codcli between $1 and $2`, [base, base + 99]);
  await adm.unsafe(`delete from public.legado_produtos where codigo between $1 and $2`, [base, base + 99]);
  await adm.unsafe(`delete from public.legado_pracas where codigo between $1 and $2`, [base, base + 1]);
});

type Kpis = Record<string, number>;
interface Painel { kpis: Kpis; anterior: Kpis | null; distribuicao: { faixa: string; maletas: number }[];
  pareto: { top20_pct: number }; mix: { categoria: string; envio_pct: number; venda_pct: number }[] }

describe("1. valor devolvido", () => {
  test("maleta com valor devolvido zerado é corrigida pelas categorias (categorias depois)", async () => {
    const m = await um<{ v: string }>(`select valor_vendido_cents v from public.legado_maletas where remessa=$1 and codcli=$2 and kit=2`, [REM + 3, cod(1)]);
    expect(Number(m.v)).toBe(100000);  // 10 vendidas × R$ 100 — e não os R$ 4.000 enviados
  });
  test("reimportar a maleta com valor zerado (categorias antes) continua certo", async () => {
    await importar("maletas", [maleta(REM + 3, cod(1), 40, 30, "2025-03-01", "2025-04-15", 2, 0)]);
    const m = await um<{ v: string }>(`select valor_vendido_cents v from public.legado_maletas where remessa=$1 and codcli=$2 and kit=2`, [REM + 3, cod(1)]);
    expect(Number(m.v)).toBe(100000);
  });
});

describe("2. painel", () => {
  test("KPIs, faixas de venda e período anterior", async () => {
    const r = await rpc<Painel>(financeiro, "legado_bi_painel", { _praca: P1 });
    expect(r.erro).toBeNull();
    // P1: Estrela 3 maletas (20+15+10) e Média 2 (5+0) = 50 vendidas de 240
    expect(r.dados.kpis).toMatchObject({ maletas: 5, consultoras: 2, pecas_enviadas: 240, pecas_vendidas: 50, giro_pct: 20.8,
      valor_vendido_cents: 500000, maletas_zeradas: 1 });
    expect(r.dados.distribuicao.reduce((t, d) => t + d.maletas, 0)).toBe(5);
    expect(r.dados.distribuicao.find((d) => d.faixa === "Nada vendido")!.maletas).toBe(1);
    expect(r.dados.anterior).toBeNull();
    const p = await rpc<Painel>(financeiro, "legado_bi_painel", { _de: "2025-03-01", _ate: "2025-04-30", _praca: P1 });
    expect(p.dados.kpis["maletas"]).toBe(3);
    expect(p.dados.anterior!["maletas"]).toBe(2);   // jan–fev, mesmo tamanho de janela
  });

  test("interna (LARDAN) fica fora; maleta sem acerto conta à parte", async () => {
    const r = await rpc<Painel>(master, "legado_bi_painel", { _praca: P2 });
    expect(r.dados.kpis).toMatchObject({ maletas: 2, consultoras: 1, pecas_vendidas: 0, maletas_zeradas_pct: 100, maletas_sem_acerto: 1 });
  });
});

describe("3. top consultoras", () => {
  test("geral, por praça e giro com mínimo de maletas", async () => {
    const g = await rpc<{ codcli: number; posicao: number; nome: string; tendencia: string | null }[]>(financeiro, "legado_bi_top", { _praca: P1 });
    expect(g.erro).toBeNull();
    expect(g.dados.map((x) => x.codcli)).toEqual([cod(1), cod(2)]);
    const pp = await rpc<{ codcli: number; praca: number; posicao: number }[]>(financeiro, "legado_bi_top",
      { _por_praca: true, _limite: 1, _de: "2025-01-01", _ate: "2025-12-31" });
    expect(pp.dados.find((x) => x.praca === P1)).toMatchObject({ codcli: cod(1), posicao: 1 });
    expect(pp.dados.find((x) => x.praca === P2)).toMatchObject({ codcli: cod(3), posicao: 1 });
    expect(pp.dados.some((x) => x.codcli === cod(4))).toBe(false);
    // giro: Média só tem 2 maletas, fica fora com mínimo 3
    const gi = await rpc<{ codcli: number }[]>(financeiro, "legado_bi_top", { _praca: P1, _criterio: "giro", _min_maletas: 3 });
    expect(gi.dados.map((x) => x.codcli)).toEqual([cod(1)]);
    expect((await rpc(financeiro, "legado_bi_top", { _criterio: "drop table" })).ok).toBe(false);
  });
});

describe("4. jornada, alertas e frases", () => {
  test("curva da n-ésima maleta e estreia zerada", async () => {
    const j = await rpc<{ curva: { n: number; consultoras: number; giro_pct: number }[]; primeira_maleta: { zerada: boolean; consultoras: number }[] }>(
      financeiro, "legado_bi_jornada", { _praca: P2 });
    expect(j.erro).toBeNull();
    expect(j.dados.curva[0]).toMatchObject({ n: 1, consultoras: 1, giro_pct: 0 });
    expect(j.dados.primeira_maleta.find((x) => x.zerada)!.consultoras).toBe(1);
  });

  test("zerou duas seguidas e ainda tem maleta na rua", async () => {
    const a = await rpc<{ zeraram_duas: { consultoras: number; pecas_na_rua: number; lista: { codcli: number }[] } }>(
      financeiro, "legado_bi_alertas", { _praca: P2 });
    expect(a.erro).toBeNull();
    expect(a.dados.zeraram_duas).toMatchObject({ consultoras: 1, pecas_na_rua: 60 });
    expect(a.dados.zeraram_duas.lista[0]!.codcli).toBe(cod(3));
  });

  test("frases prontas e demais leituras", async () => {
    const i = await rpc<{ chave: string; texto: string }[]>(financeiro, "legado_bi_insights", { _praca: P1 });
    expect(i.erro).toBeNull();
    expect(i.dados.map((x) => x.chave)).toContain("zeradas");
    expect(i.dados.find((x) => x.chave === "zeradas")!.texto).toContain("20,0%");
    const pc = await rpc<{ linhas: unknown[] }>(financeiro, "legado_bi_praca_categoria", {});
    expect(pc.erro).toBeNull();
    const pr = await rpc<{ produto: number; quantidade: number }[]>(financeiro, "legado_bi_produtos", { _praca: P1 });
    expect(pr.dados[0]).toMatchObject({ produto: cod(51), quantidade: 12 });
    const op = await rpc<{ pracas: { codigo: number }[] }>(financeiro, "legado_bi_opcoes");
    expect(op.dados.pracas.some((p) => p.codigo === P1)).toBe(true);
  });
});

describe("5. acesso", () => {
  test("consultora e representante não leem o BI; ninguém chama as internas", async () => {
    for (const fn of ["legado_bi_painel", "legado_bi_top", "legado_bi_jornada", "legado_bi_alertas", "legado_bi_insights",
                      "legado_bi_praca_categoria", "legado_bi_produtos", "legado_bi_opcoes"]) {
      expect((await rpc(consultora, fn)).ok).toBe(false);
      expect((await rpc(rep, fn)).ok).toBe(false);
    }
    expect((await rpc(master, "legado_bi_base", { _de: null, _ate: null, _praca: null, _representante: null })).ok).toBe(false);
    expect((await rpc(master, "legado_bi_kpis", { _de: null, _ate: null, _praca: null, _representante: null })).ok).toBe(false);
  });
});

describe("6. cadastros criados pelo histórico", () => {
  test("rotina nova: pula nome repetido, cria inativa quem está inativa no SmallData e já com praça", async () => {
    const praca = await um<{ id: string }>(`insert into public.cob_pracas (codigo, nome) values ($1, $2)
      on conflict (codigo) do update set nome = excluded.nome returning id`, [P1, `ISO BI ${base}`]);
    await adm.unsafe(`update public.legado_pracas set praca_id = $2 where codigo = $1`, [P1, praca.id]);
    // "Media" já existe no Lardan com o mesmo nome (sem CPF): não pode duplicar
    await adm.unsafe(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo')`, [`Média ${base}`]);
    await adm.unsafe(`update public.legado_consultoras set ativo = false where codcli = $1`, [cod(1)]);
    const r = await servico<{ r: Record<string, number> }>(`select public.legado_consultoras_cadastrar($1) r`, [`bi-${base}`]);
    expect(r.r["puladas_mesmo_nome"]).toBeGreaterThanOrEqual(1);
    const est = await um<{ status: string; praca_id: string | null; role_status: string }>(
      `select p.status, cp.praca_id, pr.status role_status from public.legado_consultoras lc join public.parties p on p.id = lc.party_id
         join public.consultant_profiles cp on cp.party_id = p.id join public.party_roles pr on pr.party_id = p.id and pr.role = 'consultora'
        where lc.codcli = $1`, [cod(1)]);
    expect(est).toEqual({ status: "inativo", praca_id: praca.id, role_status: "inativo" });
    expect((await um<{ n: number }>(`select count(*)::int n from public.legado_consultoras where codcli = $1 and party_id is not null`, [cod(2)])).n).toBe(0);
    // interna nunca vira pessoa
    expect((await um<{ n: number }>(`select count(*)::int n from public.legado_consultoras where codcli = $1 and party_id is not null`, [cod(4)])).n).toBe(0);
  });

  test("ajuste dos cadastros antigos: prévia não muda nada; aplicar só mexe em quem não tem operação", async () => {
    // simula cadastro feito pela rotina antiga: ativo e sem praça
    const z = await um<{ id: string }>(`select party_id id from public.legado_consultoras where codcli = $1`, [cod(3)]);
    expect(z.id).toBeTruthy();
    await adm.unsafe(`update public.legado_consultoras set ativo = false where codcli = $1`, [cod(3)]);
    await adm.unsafe(`update public.parties set status='ativo', is_active=true where id=$1`, [z.id]);
    await adm.unsafe(`update public.consultant_profiles set praca_id = null where party_id=$1`, [z.id]);
    await adm.unsafe(`update public.party_roles set status='ativo' where party_id=$1 and role='consultora'`, [z.id]);
    const cob = await um<{ id: string }>(`insert into public.cob_pracas (codigo, nome) values ($1, $2)
      on conflict (codigo) do update set nome = excluded.nome returning id`, [P2, `ISO BI SUL ${base}`]);
    await adm.unsafe(`update public.legado_pracas set praca_id = $2 where codigo = $1`, [P2, cob.id]);

    expect((await rpc(financeiro, "legado_cadastros_revisao")).ok).toBe(false);
    const rev = await rpc<{ deveriam_estar_inativas: number; sem_praca: number }>(master, "legado_cadastros_revisao");
    expect(rev.erro).toBeNull();
    expect(rev.dados.deveriam_estar_inativas).toBeGreaterThanOrEqual(1);

    const previa = await rpc<{ aplicado: boolean; inativadas: number; praca_definida: number }>(master, "legado_cadastros_ajustar");
    expect(previa.dados).toMatchObject({ aplicado: false });
    expect(previa.dados.inativadas).toBeGreaterThanOrEqual(1);
    expect((await um<{ status: string }>(`select status from public.parties where id=$1`, [z.id])).status).toBe("ativo");

    const ap = await rpc<{ aplicado: boolean }>(master, "legado_cadastros_ajustar", { _aplicar: true });
    expect(ap.dados.aplicado).toBe(true);
    const depois = await um<{ status: string; praca_id: string }>(
      `select p.status, cp.praca_id from public.parties p join public.consultant_profiles cp on cp.party_id = p.id where p.id=$1`, [z.id]);
    expect(depois).toEqual({ status: "inativo", praca_id: cob.id });
    expect((await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='legado.cadastros_ajustados'`)).n).toBeGreaterThanOrEqual(1);
  });

  test("cadastro com operação no Lardan não é tocado", async () => {
    const e = await um<{ id: string }>(`select party_id id from public.legado_consultoras where codcli = $1`, [cod(1)]);
    await adm.unsafe(`update public.parties set status='ativo', is_active=true where id=$1`, [e.id]);
    const kit = await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [`ISO BI ${base}`]);
    await adm.unsafe(`insert into public.kit_cycles (kit_id, cycle_no, consultora_party_id) values ($1,1,$2)`, [kit.id, e.id]);
    await rpc(master, "legado_cadastros_ajustar", { _aplicar: true });
    expect((await um<{ status: string }>(`select status from public.parties where id=$1`, [e.id])).status).toBe("ativo");
  });
});

describe("7. venda pelo acerto da consultora (0119)", () => {
  test("acerto vira o valor vendido, repartido entre os kits, e marca divergência", async () => {
    await importar("acertos_consultora", [
      { remessa: REM + 1, codcli: cod(1), valor: "1500.00", data: "2025-02-15", tipo: "remessa", dinheiro: "", cheque: "", prazo: "", boleto: "", cartao: "" },
      { remessa: REM + 3, codcli: cod(1), valor: "2500.00", data: "2025-04-15", tipo: "remessa", dinheiro: "", cheque: "", prazo: "", boleto: "", cartao: "" },
    ]);
    const m = (await adm.unsafe(`select remessa, kit, valor_venda_cents::bigint v, acerto_divergente d from public.legado_maletas
                                   where codcli=$1 order by remessa, kit`, [cod(1)])) as { remessa: number; kit: number; v: string; d: boolean }[];
    // REM+1: peças diziam R$ 2.000, o acerto cobrou R$ 1.500 → vale o acerto e fica marcada
    expect(m.find((x) => x.remessa === REM + 1)).toMatchObject({ v: "150000", d: true });
    // REM+3: dois kits (R$ 1.500 + R$ 1.000 em peças), acerto de R$ 2.500 → repartido igual, sem divergência
    expect(m.filter((x) => x.remessa === REM + 3).map((x) => [x.kit, x.v, x.d])).toEqual([[1, "150000", false], [2, "100000", false]]);
  });

  test("coluna antiga continua existindo, marcada como desativada", async () => {
    const c = await um<{ n: number; nota: string }>(`select count(*)::int n, max(col_description('public.legado_maletas'::regclass, attnum)) nota
      from pg_attribute where attrelid = 'public.legado_maletas'::regclass and attname = 'valor_vendido_cents' and not attisdropped`);
    expect(c.n).toBe(1);
    expect(c.nota).toContain("DESATIVADA");
    const antiga = await um<{ v: string }>(`select valor_vendido_cents::bigint v from public.legado_maletas where remessa=$1 and codcli=$2`, [REM + 1, cod(1)]);
    expect(antiga.v).toBe("200000");   // pelas peças, como antes
  });

  test("reimportar a maleta não perde o acerto", async () => {
    await importar("maletas", [maleta(REM + 1, cod(1), 50, 30, "2025-01-01", "2025-02-15")]);
    const v = await um<{ v: string }>(`select valor_venda_cents::bigint v from public.legado_maletas where remessa=$1 and codcli=$2`, [REM + 1, cod(1)]);
    expect(v.v).toBe("150000");
  });

  test("mês do acerto (padrão) × mês de saída", async () => {
    const acerto = await rpc<{ mes: string; valor_vendido_cents: number }[]>(financeiro, "legado_rede_mensal", { _praca: P1 });
    expect(acerto.erro).toBeNull();
    expect(acerto.dados.find((x) => x.mes === "2025-02")!.valor_vendido_cents).toBe(150000 + 50000);  // Estrela (acerto) + Média
    expect(acerto.dados.some((x) => x.mes === "2025-01")).toBe(false);
    const saida = await rpc<{ mes: string; valor_vendido_cents: number }[]>(financeiro, "legado_rede_mensal", { _praca: P1, _data: "saida" });
    expect(saida.dados.find((x) => x.mes === "2025-01")!.valor_vendido_cents).toBe(200000);
    const p = await rpc<{ kpis: { maletas: number } }>(financeiro, "legado_bi_painel", { _praca: P1, _de: "2025-02-01", _ate: "2025-02-28" });
    expect(p.dados.kpis.maletas).toBe(2);
    const ps = await rpc<{ kpis: { maletas: number } }>(financeiro, "legado_bi_painel", { _praca: P1, _de: "2025-02-01", _ate: "2025-02-28", _data: "saida" });
    expect(ps.dados.kpis.maletas).toBe(0);
    expect((await rpc(financeiro, "legado_bi_painel", { _data: "ontem" })).ok).toBe(false);
  });
});
