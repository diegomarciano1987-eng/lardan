/**
 * 0215 — NF-e do acerto da maleta (devolução, venda, perda) a partir da remessa autorizada. Banco ISOLADO, dados sintéticos.
 *  1. Só com maleta encerrada e remessa autorizada.
 *  2. Quantidades do acerto (voltou/vendeu/perdeu) por item da remessa, sem passar do remetido; sobra = "sem nota".
 *  3. Devolução sai como entrada 1918 com referência por item; venda 5114 cita a remessa no texto; perda 5927.
 *  4. Registro só pelo servidor, só homologação, origem = remessa autorizada da MESMA maleta, uma nota viva por operação.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarVariante, rpc, type Conta } from "./base";
import { montarNfe, type ItemNfe } from "../../src/lib/focus/nfe";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const REF = `iso-ace-${marca}`;
const CHAVE = "41261143319208000180550010000050041000050041";

let master: Conta, cons: Conta, outra: Conta;
let ciclo = "", cicloOutro = "", vA = "", vB = "", vC = "";

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
const regAcerto = (ref: string, op: string, origem: string, cycle = ciclo, ambiente = "homologacao") =>
  servico<{ ref: string }>(`select public.fiscal_focus_envio_acerto_registrar($1,$2,$3::uuid,$4,$5,$6::uuid,$7::text::jsonb,$8::uuid) r`,
    [ref, ambiente, cycle, op, origem, cons.partyId, JSON.stringify({ items: [] }), master.uid]);
const retorno = (ref: string, resp: unknown) =>
  servico<{ status: string }>(`select public.fiscal_focus_retorno($1,'envio',$2::text::jsonb,null) r`, [ref, JSON.stringify(resp)]);

async function cicloCom(consultora: string, itens: [string, number, number][]) {
  const kit = await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [`ISO ACE ${marca}`]);
  const c = await um<{ id: string }>(`insert into public.kit_cycles (kit_id, cycle_no, status, consultora_party_id) values ($1,1,'conferida',$2) returning id`, [kit.id, consultora]);
  const comp = await um<{ id: string }>(`insert into public.kit_compositions (cycle_id, version) values ($1,1) returning id`, [c.id]);
  for (const [v, q, preco] of itens)
    await adm.unsafe(`insert into public.kit_composition_items (composition_id, variant_id, quantity, unit_reference_cents) values ($1,$2,$3,$4)`, [comp.id, v, q, preco]);
  return c.id;
}
type Op = { itens: (ItemNfe & { numero_item_origem: number })[]; nota_viva: { ref: string; status: string } | null };
type Acerto = { remessa: { ref: string; chave: string; numero: string; data: string; texto: string }; operacoes: Record<"devolucao" | "venda" | "perda", Op>;
  sem_nota: { codigo: string; quantidade: number }[]; pendencias: string[]; destinatario: Parameters<typeof montarNfe>[0]["destinatario"] };

beforeAll(async () => {
  master = await criarConta({ nome: `ace-master-${marca}`, papeis: ["master"], comParty: true });
  cons = await criarConta({ nome: `ace-cons-${marca}`, papeis: ["consultora"], comParty: true });
  outra = await criarConta({ nome: `ace-outra-${marca}`, papeis: ["consultora"], comParty: true });
  for (const p of [cons.partyId, outra.partyId]) {
    await adm.unsafe(`update public.parties set doc = '52998224725' where id = $1`, [p]);
    await adm.unsafe(`insert into public.party_addresses (party_id, label, postal_code, street, street_number, district, city, uf, ibge_city_code, is_primary, country)
                      values ($1,'Principal','86200000','Rua A','10','Centro','Ibiporã','PR','4109807',true,'BR')`, [p]);
  }
  vA = await criarVariante(`ace-a-${marca}`, 8990);
  vB = await criarVariante(`ace-b-${marca}`, 12000);
  vC = await criarVariante(`ace-c-${marca}`, 4990);
  ciclo = await cicloCom(cons.partyId!, [[vA, 3, 8990], [vB, 2, 12000], [vC, 1, 4990]]);
  cicloOutro = await cicloCom(outra.partyId!, [[vA, 1, 8990]]);

  // remessa de teste montada pelo caminho real e AUTORIZADA
  const d = (await rpc<{ itens: (ItemNfe & { variant_id: string })[]; destinatario: Acerto["destinatario"]; composicao_versao: number }>(
    master, "fiscal_focus_maleta_dados", { _cycle: ciclo })).dados;
  const nfe = montarNfe({ operacao: "remessa", ambiente: "homologacao", cnpjEmitente: "43319208000180", ufEmitente: "PR",
    destinatario: d.destinatario, itens: d.itens, remessa: { numero: 930, kit: 4 } });
  const r = await servico(`select public.fiscal_focus_envio_maleta_registrar($1,'homologacao',$2::uuid,$3::uuid,$4::int,$5::text::jsonb,$6::uuid,$7::uuid[]) r`,
    [REF, ciclo, cons.partyId, d.composicao_versao, JSON.stringify(nfe), master.uid, `{${d.itens.map((i) => i.variant_id).join(",")}}`]);
  expect(r.erro).toBeNull();
  expect((await retorno(REF, { status: "autorizado", chave_nfe: CHAVE, numero: "5004", serie: "1", caminho_danfe: "/d.pdf" })).dados!.status).toBe("autorizado");
});

afterAll(async () => {
  await adm.unsafe(`delete from public.fiscal_focus_eventos where ref like 'iso-ace-%'`);
  await adm.unsafe(`delete from public.fiscal_focus_envios where ref like 'iso-ace-%' and ref_origem is not null`);
  await adm.unsafe(`delete from public.fiscal_focus_envios where ref like 'iso-ace-%'`);
});

describe("1. quando", () => {
  test("maleta ainda não encerrada não emite; maleta sem remessa autorizada não emite", async () => {
    expect((await rpc(master, "fiscal_focus_acerto_dados", { _cycle: ciclo })).erro).toContain("maleta encerrada");
    await adm.unsafe(`update public.kit_cycles set status = 'encerrada', closed_at = now() where id = any($1::uuid[])`, [[ciclo, cicloOutro]]);
    expect((await rpc(master, "fiscal_focus_acerto_dados", { _cycle: cicloOutro })).erro).toContain("remessa autorizada");
    expect((await rpc(cons, "fiscal_focus_acerto_dados", { _cycle: ciclo })).ok).toBe(false);
  });
});

describe("2 e 3. quantidades e notas", () => {
  test("voltou/vendeu/perdeu por item, sem passar do remetido; sobra sem nota", async () => {
    // A: 3 enviadas → 1 voltou, 2 vendidas | B: 2 enviadas → 1 vendida, 1 sem destino | C: 1 enviada → perdida
    await adm.unsafe(`insert into public.kit_balances (cycle_id, variant_id, qty_allocated, qty_accepted, qty_returned, qty_sold, qty_lost) values
      ($1,$2,3,3,1,2,0), ($1,$3,2,2,0,1,0), ($1,$4,1,1,0,0,1)`, [ciclo, vA, vB, vC]);
    const r = await rpc<Acerto>(master, "fiscal_focus_acerto_dados", { _cycle: ciclo });
    expect(r.erro).toBeNull();
    const d = r.dados;
    expect(d.pendencias).toEqual([]);
    expect(d.remessa).toMatchObject({ ref: REF, chave: CHAVE, numero: "5004" });
    const q = (op: "devolucao" | "venda" | "perda") => d.operacoes[op].itens.map((i) => [i.numero_item_origem, i.quantidade]);
    // ordem dos itens da remessa: pelo nome do produto (a, b, c)
    expect(q("devolucao")).toEqual([[1, 1]]);
    expect(q("venda")).toEqual([[1, 2], [2, 1]]);
    expect(q("perda")).toEqual([[3, 1]]);
    expect(d.sem_nota.map((s) => s.quantidade)).toEqual([1]);

    const base = { ambiente: "homologacao" as const, cnpjEmitente: "43319208000180", ufEmitente: "PR", destinatario: d.destinatario,
      origem: { chave: d.remessa.chave, numero: d.remessa.numero, data: d.remessa.data }, remessa: { numero: 930, kit: 4 } };
    const dev = montarNfe({ ...base, operacao: "devolucao", itens: d.operacoes.devolucao.itens });
    expect(dev).toMatchObject({ natureza_operacao: "- DEVOLUCAO REMESSA", tipo_documento: 0, finalidade_emissao: 4 });
    expect((dev["items"] as Record<string, unknown>[])[0]).toMatchObject({ cfop: "1918", valor_unitario_comercial: 29.97,
      chave_acesso_dfe_referenciado: CHAVE, numero_item_dfe_referenciado: 1 });
    const venda = montarNfe({ ...base, operacao: "venda", itens: d.operacoes.venda.itens });
    expect(venda["notas_referenciadas"]).toBeUndefined();
    expect(String(venda["informacoes_adicionais_contribuinte"])).toContain("SIMPLES FATURAMENTO DE MERCADORIA EM CONSIGNACAO - NF N. 5004");
    expect((venda["items"] as { cfop: string; valor_unitario_comercial: number }[]).map((i) => [i.cfop, i.valor_unitario_comercial]))
      .toEqual([["5114", 29.97], ["5114", 40]]);
    const perda = montarNfe({ ...base, operacao: "perda", itens: d.operacoes.perda.itens });
    expect((perda["items"] as { cfop: string; valor_unitario_comercial: number }[])[0]).toMatchObject({ cfop: "5927", valor_unitario_comercial: 16.63 });
  });
});

describe("4. registro", () => {
  test("só servidor; só homologação; origem da mesma maleta; uma nota viva por operação; recusa libera", async () => {
    expect((await rpc(master, "fiscal_focus_envio_acerto_registrar", { _ref: `${REF}-x`, _ambiente: "homologacao", _cycle: ciclo, _operacao: "venda",
      _ref_origem: REF, _party: cons.partyId, _payload: {}, _ator: master.uid })).ok).toBe(false);
    expect((await regAcerto(`${REF}-p`, "venda", REF, ciclo, "producao")).erro).toContain("diferente do configurado"); // 0216
    expect((await regAcerto(`${REF}-o`, "venda", REF, cicloOutro)).erro).toContain("Consultora diferente");
    expect((await regAcerto(`${REF}-r`, "remessa", REF)).erro).toContain("Operação inválida");
    expect((await regAcerto(`${REF}-v`, "venda", REF)).erro).toBeNull();
    expect((await regAcerto(`${REF}-v2`, "venda", REF)).erro).toContain("já tem nota de venda");
    expect((await regAcerto(`${REF}-d`, "devolucao", REF)).erro).toBeNull();
    expect((await retorno(`${REF}-d`, { status: "erro_autorizacao", mensagem_sefaz: "Rejeição 321" })).dados!.status).toBe("erro_autorizacao");
    expect((await regAcerto(`${REF}-d2`, "devolucao", REF)).erro).toBeNull();

    const d = (await rpc<Acerto>(master, "fiscal_focus_acerto_dados", { _cycle: ciclo })).dados;
    expect(d.operacoes.venda.nota_viva).toMatchObject({ ref: `${REF}-v`, status: "pendente" });
    expect(d.operacoes.perda.nota_viva).toBeNull();

    const l = await rpc<{ cycle_id: string; acerto: { operacao: string; ref: string; status: string }[] }[]>(master, "fiscal_focus_notas_maletas", { _cycles: [ciclo] });
    expect(l.dados[0]!.acerto.map((a) => [a.operacao, a.ref])).toEqual([["devolucao", `${REF}-d2`], ["venda", `${REF}-v`]]);
  });
});
