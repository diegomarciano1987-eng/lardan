/**
 * 0214 — NF-e de remessa a partir da maleta conferida (homologação). Banco ISOLADO, dados sintéticos.
 *  1. Só Master; só maleta conferida (ou depois) com consultora.
 *  2. Peças da composição conferida, ao preço GRAVADO na maleta; remessa/kit no texto complementar.
 *  3. Registro só pelo servidor, só homologação, uma remessa viva por maleta; recusa libera nova emissão.
 *  4. Peças mudaram depois da leitura → recusa; situação para a tela sem CPF; quem não vê o fiscal recebe [].
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarVariante, ler, rpc, type Conta } from "./base";
import { montarNfe } from "../../src/lib/focus/nfe";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const REF = `iso-mal-${marca}`;

let master: Conta, montagem: Conta, cons: Conta;
let ciclo = "", cicloSemCons = "", vA = "", vB = "", remessaNumero = 0;

type Dados = {
  destinatario: { party_id: string; cpf: string; codigo_municipio: string; nome: string; logradouro: string; numero: string; bairro: string; municipio: string; uf: string; cep: string };
  itens: { variant_id: string; codigo: string; descricao: string; ncm: string; quantidade: number; preco_varejo_cents: number }[];
  pendencias: string[];
  composicao_versao: number;
  remessa: { numero: number | null; kit: number };
  nota_viva: { ref: string; status: string } | null;
};

/** Executor interno do servidor (service_role, sem usuário), como em focus-nfe.test.ts. */
async function servico<T>(sql: string, p: unknown[] = []): Promise<{ ok: boolean; dados: T | null; erro: string | null }> {
  const c = await adm.reserve();
  try {
    await c.unsafe(`set role service_role`);
    await c.unsafe(`select set_config('lardan.test_role','service_role',false), set_config('lardan.test_uid','',false)`);
    return { ok: true, dados: ((await c.unsafe(sql, p)) as { r: T }[])[0]!.r, erro: null };
  } catch (e) {
    return { ok: false, dados: null, erro: (e as Error).message };
  } finally {
    try { await c.unsafe(`reset role`); await c.unsafe(`select set_config('lardan.test_role','',false)`); } catch { /* */ }
    c.release();
  }
}
const registrar = (ref: string, versao: number, ambiente = "homologacao", party = cons.partyId) =>
  servico<{ ref: string }>(`select public.fiscal_focus_envio_maleta_registrar($1,$2,$3::uuid,$4::uuid,$5::int,$6::text::jsonb,$7::uuid) r`,
    [ref, ambiente, ciclo, party, versao, JSON.stringify({ items: [{ codigo_produto: "X", quantidade_comercial: 1 }], valor_total: 1 }), master.uid]);
const retorno = (ref: string, resp: unknown) =>
  servico<{ status: string }>(`select public.fiscal_focus_retorno($1,'envio',$2::text::jsonb,null) r`, [ref, JSON.stringify(resp)]);

async function novoCiclo(consultora: string | null, status: string) {
  const kit = await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [`ISO NF ${marca}`]);
  const c = await um<{ id: string }>(
    `insert into public.kit_cycles (kit_id, cycle_no, status, consultora_party_id) values ($1, 1, $2::kit_status, $3) returning id`,
    [kit.id, status, consultora]);
  const comp = await um<{ id: string }>(`insert into public.kit_compositions (cycle_id, version) values ($1, 1) returning id`, [c.id]);
  // preço gravado na maleta (7990) diferente do catálogo (8990): a nota usa o gravado
  await adm.unsafe(`insert into public.kit_composition_items (composition_id, variant_id, quantity, unit_reference_cents) values ($1,$2,2,7990),($1,$3,1,0)`,
    [comp.id, vA, vB]);
  return c.id;
}

beforeAll(async () => {
  master = await criarConta({ nome: `nf-master-${marca}`, papeis: ["master"], comParty: true });
  montagem = await criarConta({ nome: `nf-mont-${marca}`, papeis: ["montagem"], comParty: true });
  cons = await criarConta({ nome: `nf-cons-${marca}`, papeis: ["consultora"], comParty: true });
  await adm.unsafe(`update public.parties set doc = '52998224725' where id = $1`, [cons.partyId]);
  await adm.unsafe(`insert into public.party_addresses (party_id, label, postal_code, street, street_number, district, city, uf, ibge_city_code, is_primary, country)
                    values ($1,'Principal','86200000','Rua A','10','Centro','Ibiporã','PR','4109807',true,'BR')`, [cons.partyId]);
  vA = await criarVariante(`nf-a-${marca}`, 8990);
  vB = await criarVariante(`nf-b-${marca}`, 12000);
  ciclo = await novoCiclo(cons.partyId, "montagem");
  cicloSemCons = await novoCiclo(null, "conferida");
  // remessa para o texto complementar
  const praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça NF ${marca}`])).linhas[0]!.id;
  const r = await um<{ id: string; numero: number }>(
    `insert into public.remessas (numero, praca_id) select coalesce(max(numero), 900) + 1, $1 from public.remessas returning id, numero`, [praca]);
  remessaNumero = r.numero;
  await adm.unsafe(`update public.kit_cycles set remessa_id = $2 where id = $1`, [ciclo, r.id]);
});

afterAll(async () => {
  await adm.unsafe(`delete from public.fiscal_focus_eventos where ref like 'iso-mal-%'`);
  await adm.unsafe(`delete from public.fiscal_focus_envios where ref like 'iso-mal-%'`);
});

describe("1. quem e quando", () => {
  test("maleta em montagem não emite; sem consultora não emite; só Master", async () => {
    expect((await rpc(master, "fiscal_focus_maleta_dados", { _cycle: ciclo })).erro).toContain("montada e conferida");
    expect((await rpc(master, "fiscal_focus_maleta_dados", { _cycle: cicloSemCons })).erro).toContain("sem consultora");
    await adm.unsafe(`update public.kit_cycles set status = 'conferida' where id = $1`, [ciclo]);
    expect((await rpc(montagem, "fiscal_focus_maleta_dados", { _cycle: ciclo })).ok).toBe(false);
    expect((await rpc(cons, "fiscal_focus_maleta_dados", { _cycle: ciclo })).ok).toBe(false);
  });
});

describe("2. dados da nota", () => {
  test("peças conferidas, preço gravado, remessa e kit; nota monta pelo roteiro", async () => {
    const d = await rpc<Dados>(master, "fiscal_focus_maleta_dados", { _cycle: ciclo });
    expect(d.erro).toBeNull();
    expect(d.dados.pendencias).toEqual([]);
    expect(d.dados.composicao_versao).toBe(1);
    expect(d.dados.nota_viva).toBeNull();
    const porVar = new Map(d.dados.itens.map((i) => [i.variant_id, i]));
    expect(porVar.get(vA)).toMatchObject({ quantidade: 2, preco_varejo_cents: 7990, ncm: "71171900" });
    expect(porVar.get(vB)).toMatchObject({ quantidade: 1, preco_varejo_cents: 12000 }); // sem preço gravado: catálogo
    expect(d.dados.remessa).toEqual({ numero: remessaNumero, kit: 1 });

    const nfe = montarNfe({ operacao: "remessa", ambiente: "homologacao", cnpjEmitente: "43319208000180", ufEmitente: "PR",
      destinatario: d.dados.destinatario, itens: d.dados.itens, remessa: { numero: d.dados.remessa.numero ?? "-", kit: d.dados.remessa.kit } });
    const itens = nfe["items"] as { cfop: string; valor_unitario_comercial: number; quantidade_comercial: number }[];
    expect(itens.every((i) => i.cfop === "5917")).toBe(true);
    expect(itens.find((i) => i.quantidade_comercial === 2)!.valor_unitario_comercial).toBe(26.63); // 1/3 de 79,90
    expect(nfe["natureza_operacao"]).toBe("- REM/CONSIG.");
    expect(nfe["informacoes_adicionais_contribuinte"]).toBe(`----- REMESSA: ${remessaNumero} KIT: 1 -----`);
  });
});

describe("3. registro e uma nota viva", () => {
  test("só servidor, só homologação, consultora/peças conferem, segunda nota viva recusada", async () => {
    expect((await rpc(master, "fiscal_focus_envio_maleta_registrar", { _ref: REF, _ambiente: "homologacao", _cycle: ciclo,
      _party: cons.partyId, _composicao_versao: 1, _payload: {}, _ator: master.uid })).ok).toBe(false);
    expect((await registrar(`${REF}-p`, 1, "producao")).erro).toContain("diferente do configurado"); // 0216: produção só quando o Master liga
    expect((await registrar(`${REF}-v`, 2)).erro).toContain("peças da maleta mudaram");
    expect((await registrar(`${REF}-c`, 1, "homologacao", master.partyId)).erro).toContain("consultora da maleta mudou");
    expect((await registrar(REF, 1)).erro).toBeNull();
    expect((await registrar(`${REF}-2`, 1)).erro).toContain("já tem nota de remessa");
    const d = await rpc<Dados>(master, "fiscal_focus_maleta_dados", { _cycle: ciclo });
    expect(d.dados.nota_viva).toEqual({ ref: REF, status: "pendente" });
    const e = await um<{ cycle_id: string; composicao_versao: number; operacao: string }>(
      `select cycle_id, composicao_versao, operacao from public.fiscal_focus_envios where ref = $1`, [REF]);
    expect(e).toEqual({ cycle_id: ciclo, composicao_versao: 1, operacao: "remessa" });
  });

  test("recusa da SEFAZ libera nova emissão; autorizada volta a travar", async () => {
    expect((await retorno(REF, { status: "erro_autorizacao", mensagem_sefaz: "Rejeição 598" })).dados!.status).toBe("erro_autorizacao");
    expect((await registrar(`${REF}-b`, 1)).erro).toBeNull();
    expect((await retorno(`${REF}-b`, { status: "autorizado", numero: "77", serie: "3", caminho_danfe: "/arquivos/d.pdf",
      chave_nfe: "41261043319208000180550030000000771000000771" })).dados!.status).toBe("autorizado");
    expect((await registrar(`${REF}-c2`, 1)).erro).toContain("já tem nota de remessa");
  });
});

describe("4. situação para a tela", () => {
  test("última nota da maleta, sem CPF; desatualizada se as peças mudarem; sem permissão = []", async () => {
    const l = await rpc<{ cycle_id: string; ref: string; status: string; numero: string; tem_danfe: boolean; desatualizada: boolean }[]>(
      master, "fiscal_focus_notas_maletas", { _cycles: [ciclo, cicloSemCons] });
    expect(l.erro).toBeNull();
    expect(l.dados).toHaveLength(1);
    expect(l.dados[0]).toMatchObject({ cycle_id: ciclo, ref: `${REF}-b`, status: "autorizado", numero: "77", tem_danfe: true, desatualizada: false });
    expect(JSON.stringify(l.dados)).not.toContain("52998224725");

    await adm.unsafe(`insert into public.kit_compositions (cycle_id, version) values ($1, 2)`, [ciclo]);
    const l2 = await rpc<{ desatualizada: boolean }[]>(master, "fiscal_focus_notas_maletas", { _cycles: [ciclo] });
    expect(l2.dados[0]!.desatualizada).toBe(true);

    const semVer = await rpc<unknown[]>(montagem, "fiscal_focus_notas_maletas", { _cycles: [ciclo] });
    expect(semVer.erro).toBeNull();
    expect(semVer.dados).toEqual([]);
  });
});
