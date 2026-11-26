/**
 * 0394 — consulta de crédito da candidata (Assertiva): regra de score por idade, reaproveitamento, permissões.
 * A API em si não é chamada: o teste entrega ao banco respostas no formato da documentação. Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, rpcServico, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, consultora: Conta;

function cpfValido(seed: number) {
  const b = String(100000000 + (seed % 899999999)).slice(0, 9).split("").map(Number);
  const dv = (d: number[]) => { const s = d.reduce((a, n, i) => a + n * (d.length + 1 - i), 0) % 11; return s < 2 ? 0 : 11 - s; };
  const d1 = dv(b); const d2 = dv([...b, d1]);
  return [...b, d1, d2].join("");
}
const anosAtras = (anos: number, dias = 10) => {
  const d = new Date(); d.setFullYear(d.getFullYear() - anos); d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
};
async function lead(nome: string, idade: number | null) {
  const st = await um<{ id: string }>(`select id from public.candidatura_stages where key='nova'`);
  const r = await um<{ id: string }>(
    `insert into public.leads (full_name, first_name, whatsapp, city, uf, privacy_version, stage_id, protocol, cpf, data_nascimento)
     values ($1,$1,'43999990000','Ibaiti','PR','v1',$2,$3,$4,$5) returning id`,
    [nome, st.id, `C94-${marca}-${nome}`, cpfValido(Math.floor(Math.random() * 1e9)), idade == null ? null : anosAtras(idade)]);
  return r.id;
}
const resposta = (pontos: number | null) => ({
  cabecalho: { entrada: { documento: "000.000.000-00" }, protocolo: `p-${marca}` },
  resposta: {
    score: pontos == null ? null : { classe: "B", faixa: { titulo: "Médio risco" }, pontos },
    protestosPublicos: { protestoCompleto: true, qtdProtestos: 1, valorTotal: 250.5, list: [{ uf: "PR", valor: 250.5 }] },
    registrosDebitos: null, rendaPresumida: { valor: 3000 }, cheques: [], acoes: [],
  },
});
const registrar = (lead: string, http: number, corpo: unknown) =>
  rpcServico<{ resultado: string; situacao: string; motivo: string; score_minimo: number | null }>("candidatura_credito_registrar",
    { _lead: lead, _http: http, _resposta: corpo, _origem: "manual", _usuario: master.uid });

beforeAll(async () => {
  master = await criarConta({ nome: `c94-master-${marca}`, papeis: ["master"], comParty: true });
  consultora = await criarConta({ nome: `c94-cons-${marca}`, papeis: ["consultora"], comParty: true });
});

describe("0394: regra de score por idade", () => {
  test.each([
    [22, 700, "aprovada_regra", 690],
    [22, 689, "revisar", 690],
    [31, 690, "aprovada_regra", 690],
    [35, 520, "aprovada_regra", 520],
    [35, 519, "revisar", 520],
    [45, 350, "aprovada_regra", 350],
    [45, 349, "revisar", 350],
    [25, 900, "aprovada_regra", 690],
  ])("%i anos, score %i → %s (mínimo %i)", async (idade, score, esperado, minimo) => {
    const l = await lead(`i${idade}s${score}`, idade);
    const r = await registrar(l, 200, resposta(score));
    expect(r.erro).toBeNull();
    expect(r.dados!.resultado).toBe(esperado);
    expect(r.dados!.score_minimo).toBe(minimo);
  });

  test("sem data de nascimento, sem score ou CPF não encontrado (202) → revisar", async () => {
    expect((await registrar(await lead("semnasc", null), 200, resposta(800))).dados!.motivo).toContain("data de nascimento");
    expect((await registrar(await lead("semscore", 30), 200, resposta(null))).dados!.situacao).toBe("sem_score");
    expect((await registrar(await lead("cpf202", 30), 202, {})).dados!.situacao).toBe("cpf_nao_encontrado");
    expect((await registrar(await lead("http500", 30), 500, {})).dados!.situacao).toBe("erro");
  });

  test("guarda protestos e renda; a ficha mostra o resumo, nunca a resposta bruta", async () => {
    const l = await lead("ficha", 28);
    await registrar(l, 200, resposta(750));
    const v = await rpc<{ consultas: Record<string, unknown>[]; idade: number }>(master, "candidatura_credito_ver", { _lead: l });
    expect(v.erro).toBeNull();
    expect(v.dados!.idade).toBe(28);
    expect(v.dados!.consultas[0]!["protestos_qtd"]).toBe(1);
    expect(Number(v.dados!.consultas[0]!["renda_presumida"])).toBe(3000);
    expect(JSON.stringify(v.dados)).not.toContain("cabecalho");
    expect((await rpc(consultora, "candidatura_credito_ver", { _lead: l })).ok).toBe(false);
  });
});

describe("0394: antes de gastar a consulta", () => {
  test("reaproveita a consulta dos últimos 30 dias, a não ser que peçam nova", async () => {
    const l = await lead("reuso", 30);
    expect((await rpcServico<{ pode: boolean }>("candidatura_credito_preparar", { _lead: l, _forcar: false, _usuario: master.uid })).dados!.pode).toBe(true);
    await registrar(l, 200, resposta(700));
    const p2 = await rpcServico<{ pode: boolean; reaproveitar: boolean }>("candidatura_credito_preparar", { _lead: l, _forcar: false, _usuario: master.uid });
    expect(p2.dados!.pode).toBe(false);
    expect(p2.dados!.reaproveitar).toBe(true);
    expect((await rpcServico<{ pode: boolean }>("candidatura_credito_preparar", { _lead: l, _forcar: true, _usuario: master.uid })).dados!.pode).toBe(true);
  });

  test("sem permissão de editar candidaturas não consulta; rotinas são só do servidor", async () => {
    const l = await lead("perm", 30);
    const p = await rpcServico<{ pode: boolean; motivo: string }>("candidatura_credito_preparar", { _lead: l, _forcar: false, _usuario: consultora.uid });
    expect(p.dados!.pode).toBe(false);
    expect((await rpc(master, "candidatura_credito_preparar", { _lead: l, _forcar: false, _usuario: master.uid })).ok).toBe(false);
    expect((await rpc(master, "candidatura_credito_registrar", { _lead: l, _http: 200, _resposta: {}, _origem: "manual", _usuario: master.uid })).ok).toBe(false);
  });

  test("CPF inválido não consulta", async () => {
    const l = await lead("cpfruim", 30);
    await adm.unsafe(`update public.leads set cpf='123', cpf_digits='123' where id=$1`, [l]);
    const p = await rpcServico<{ pode: boolean; motivo: string }>("candidatura_credito_preparar", { _lead: l, _forcar: false, _usuario: master.uid });
    expect(p.dados!.pode).toBe(false);
    expect(p.dados!.motivo).toContain("CPF");
  });

  test("data de nascimento: o servidor grava; a equipe precisa de candidaturas.edit; data futura recusada", async () => {
    const l = await lead("nasc", null);
    expect((await rpcServico("candidatura_nascimento_definir", { _lead: l, _data: anosAtras(33), _usuario: null })).erro).toBeNull();
    expect((await rpcServico("candidatura_nascimento_definir", { _lead: l, _data: "2999-01-01", _usuario: null })).erro).not.toBeNull();
    expect((await rpcServico("candidatura_nascimento_definir", { _lead: l, _data: anosAtras(33), _usuario: consultora.uid })).erro).not.toBeNull();
    const v = await um<{ i: number }>(`select public.candidatura_idade(data_nascimento) i from public.leads where id=$1`, [l]);
    expect(v.i).toBe(33);
  });
});
