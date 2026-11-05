/**
 * 0216 — NF-e em PRODUÇÃO pela maleta. Banco ISOLADO, dados sintéticos (nenhuma chamada à Focus).
 *  1. Desligada = homologação. Ligar: só Master, confirmação digitada, piloto ou todas.
 *  2. Ligada: piloto em produção; outra maleta é recusada (não cai em teste); liberar todas.
 *  3. Código da peça = referência da etiqueta; descrição sem repetição; IBGE pelo município.
 *  4. Trava de série: autorizada fora da série 3 desliga a emissão.
 *  5. Cópia ao escritório: pendentes e marcação; fila automática na conferência.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarVariante, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const REF = `iso-prd-${marca}`;
let master: Conta, fin: Conta, cons: Conta;
let ciclo = "", outro = "", kitPiloto = "", vA = "";
let original: Record<string, unknown> | null = null;

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
const definir = (conta: Conta, o: { ligar: boolean; piloto?: string | null; todas?: boolean; automatico?: boolean; email?: string | null; conf?: string | null }) =>
  rpc<Record<string, unknown>>(conta, "fiscal_producao_definir", { _ligar: o.ligar, _piloto_kit: o.piloto ?? null, _todas: o.todas ?? false,
    _automatico: o.automatico ?? false, _email: o.email ?? "fiscal2@on4.com.br", _confirmacao: o.conf ?? null });
const registrar = (ref: string, amb: string, cycle = ciclo) =>
  servico<{ ref: string }>(`select public.fiscal_focus_envio_maleta_registrar($1,$2,$3::uuid,$4::uuid,1,$5::text::jsonb,$6::uuid,null) r`,
    [ref, amb, cycle, cons.partyId, JSON.stringify({ items: [{ codigo_produto: "X", quantidade_comercial: 1 }] }), master.uid]);

async function maleta(status = "conferida") {
  const kit = await um<{ id: string; code: string }>(`insert into public.kits (label) values ($1) returning id, code`, [`ISO PRD ${marca}`]);
  const c = await um<{ id: string }>(`insert into public.kit_cycles (kit_id, cycle_no, status, consultora_party_id) values ($1,1,$2::kit_status,$3) returning id`, [kit.id, status, cons.partyId]);
  const comp = await um<{ id: string }>(`insert into public.kit_compositions (cycle_id, version) values ($1,1) returning id`, [c.id]);
  await adm.unsafe(`insert into public.kit_composition_items (composition_id, variant_id, quantity, unit_reference_cents) values ($1,$2,1,8990)`, [comp.id, vA]);
  return { id: c.id, code: kit.code };
}

beforeAll(async () => {
  original = await um(`select emission_active, provider, environment, emitter_entity_id, producao_piloto_cycle_id, producao_todas, producao_automatico, email_copia_xml from public.fiscal_settings`);
  const be = await um<{ id: string }>(`select id from public.business_entities limit 1`);
  await adm.unsafe(`update public.fiscal_settings set provider = 'focus', environment = 'homologacao', emitter_entity_id = $1, emission_active = false,
                    producao_piloto_cycle_id = null, producao_todas = false, producao_automatico = false`, [be.id]);
  master = await criarConta({ nome: `prd-master-${marca}`, papeis: ["master"], comParty: true });
  fin = await criarConta({ nome: `prd-fin-${marca}`, papeis: ["financeiro"], comParty: true });
  cons = await criarConta({ nome: `prd-cons-${marca}`, papeis: ["consultora"], comParty: true });
  await adm.unsafe(`update public.parties set doc = '52998224725' where id = $1`, [cons.partyId]);
  // endereço SEM código IBGE: a nota acha pelo município
  await adm.unsafe(`insert into public.ibge_municipios (codigo_ibge, uf, nome) values ('4109807','PR','Ibiporã') on conflict do nothing`);
  await adm.unsafe(`insert into public.party_addresses (party_id, label, postal_code, street, street_number, district, city, uf, ibge_city_code, is_primary, country)
                    values ($1,'Principal','86200000','Rua A','10','Centro','Ibiporã','PR',null,true,'BR')`, [cons.partyId]);
  vA = await criarVariante(`prd-a-${marca}`, 8990);
  await adm.unsafe(`update public.product_variants set reference_code = 'BR-REF-' || $2, label = 'U', barcode = null where id = $1`, [vA, marca]);
  const m1 = await maleta(); ciclo = m1.id; kitPiloto = m1.code;
  outro = (await maleta()).id;
});

afterAll(async () => {
  await adm.unsafe(`delete from public.fiscal_fila where cycle_id = any($1::uuid[])`, [[ciclo, outro]]);
  await adm.unsafe(`delete from public.fiscal_focus_eventos where ref like 'iso-prd-%'`);
  await adm.unsafe(`delete from public.fiscal_focus_envios where ref like 'iso-prd-%'`);
  if (original) await adm.unsafe(`update public.fiscal_settings set emission_active = $1, provider = $2, environment = $3, emitter_entity_id = $4,
      producao_piloto_cycle_id = null, producao_todas = $5, producao_automatico = $6, email_copia_xml = $7`,
    [original["emission_active"], original["provider"], original["environment"], original["emitter_entity_id"],
     original["producao_todas"], original["producao_automatico"], original["email_copia_xml"]]);
});

describe("1. ligar", () => {
  test("desligada = homologação; só Master; confirmação; piloto obrigatório", async () => {
    expect((await um<{ a: string }>(`select public.fiscal_focus_ambiente($1) a`, [ciclo])).a).toBe("homologacao");
    expect((await definir(fin, { ligar: true, piloto: kitPiloto, conf: "LIGAR PRODUCAO" })).ok).toBe(false);
    expect((await definir(master, { ligar: true, piloto: kitPiloto })).erro).toContain("LIGAR PRODUCAO");
    expect((await definir(master, { ligar: true, conf: "LIGAR PRODUCAO" })).erro).toContain("maleta piloto");
    expect((await definir(master, { ligar: true, piloto: "MAL-NAOEXISTE", conf: "LIGAR PRODUCAO" })).erro).toContain("não encontrada");
    const r = await definir(master, { ligar: true, piloto: kitPiloto, conf: "LIGAR PRODUCAO" });
    expect(r.erro).toBeNull();
    expect(r.dados).toMatchObject({ ativa: true, todas: false, serie: "3", email_copia: "fiscal2@on4.com.br" });
  });
});

describe("2. piloto", () => {
  test("piloto em produção, outra maleta recusada, liberar todas", async () => {
    expect((await um<{ a: string }>(`select public.fiscal_focus_ambiente($1) a`, [ciclo])).a).toBe("producao");
    expect((await rpc(master, "fiscal_focus_maleta_dados", { _cycle: outro })).erro).toContain("maleta piloto");
    expect((await registrar(`${REF}-h`, "homologacao")).erro).toContain("diferente do configurado");
    expect((await registrar(REF, "producao")).erro).toBeNull();
    expect((await um<{ teste: boolean }>(`select teste from public.fiscal_focus_envios where ref = $1`, [REF])).teste).toBe(false);
    expect((await definir(master, { ligar: true, piloto: kitPiloto, todas: true })).erro).toBeNull();
    expect((await um<{ a: string }>(`select public.fiscal_focus_ambiente($1) a`, [outro])).a).toBe("producao");
  });
});

describe("3. dados da nota", () => {
  test("código = referência da etiqueta; descrição sem repetir; IBGE pelo município; servidor também lê", async () => {
    const d = await rpc<{ ambiente: string; itens: { codigo: string; descricao: string }[]; pendencias: string[]; destinatario: { codigo_municipio: string } }>(
      master, "fiscal_focus_maleta_dados", { _cycle: outro });
    expect(d.erro).toBeNull();
    expect(d.dados.ambiente).toBe("producao");
    expect(d.dados.pendencias).toEqual([]);
    expect(d.dados.destinatario.codigo_municipio).toBe("4109807");
    expect(d.dados.itens[0]!.codigo).toBe(`BR-REF-${marca}`);
    expect(d.dados.itens[0]!.descricao).toBe(`ISO Peça prd-a-${marca}`);
    const sv = await servico<{ itens: unknown[] }>(`select public.fiscal_focus_maleta_dados($1::uuid) r`, [outro]);
    expect(sv.erro).toBeNull();
    expect((await servico<{ cnpj: string }>(`select public.fiscal_focus_emitente() r`)).erro).toBeNull();
  });
});

describe("4 e 5. série, cópia e fila", () => {
  test("autorizada na série 3 mantém; cópia pendente e marcada", async () => {
    await servico(`select public.fiscal_focus_retorno($1,'envio',$2::text::jsonb,null) r`, [REF, JSON.stringify({ status: "autorizado", serie: "3", numero: "1",
      chave_nfe: "41261143319208000180550030000000011000000011" })]);
    expect((await um<{ a: boolean }>(`select public.fiscal_focus_producao_ativa() a`)).a).toBe(true);
    const p = await servico<{ email: string; refs: { ref: string }[] }>(`select public.fiscal_focus_email_pendentes(50) r`);
    expect(p.dados!.email).toBe("fiscal2@on4.com.br");
    expect(p.dados!.refs.map((x) => x.ref)).toContain(REF);
    await servico(`select public.fiscal_focus_email_marcar($1, true, 'fiscal2@on4.com.br')::text r`, [REF]);
    const p2 = await servico<{ refs: { ref: string }[] }>(`select public.fiscal_focus_email_pendentes(50) r`);
    expect(p2.dados!.refs.map((x) => x.ref)).not.toContain(REF);
  });

  test("fila automática: maleta conferida entra na fila; série errada desliga tudo", async () => {
    expect((await definir(master, { ligar: true, piloto: kitPiloto, todas: true, automatico: true })).erro).toBeNull();
    await adm.unsafe(`update public.kit_cycles set status = 'montagem' where id = $1`, [outro]);
    await adm.unsafe(`update public.kit_cycles set status = 'conferida' where id = $1`, [outro]);
    const f = await servico<{ cycle_id: string; etapa: string }[]>(`select public.fiscal_fila_proximos(20) r`);
    expect(f.dados!.some((x) => x.cycle_id === outro && x.etapa === "remessa")).toBe(true);

    const r2 = `${REF}-s`;
    expect((await registrar(r2, "producao", outro)).erro).toBeNull();
    await servico(`select public.fiscal_focus_retorno($1,'envio',$2::text::jsonb,null) r`, [r2, JSON.stringify({ status: "autorizado", serie: "1", numero: "9" })]);
    expect((await um<{ a: boolean }>(`select public.fiscal_focus_producao_ativa() a`)).a).toBe(false);
    const e = await rpc<{ observacao: string; automatico: boolean }>(master, "fiscal_producao_estado", {});
    expect(e.dados.observacao).toContain("desligada automaticamente");
    expect(e.dados.automatico).toBe(false);
    expect((await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action = 'fiscal.serie_divergente' and entity_id = $1`, [r2])).n).toBe(1);
    // desligada: fila não entrega nada
    expect((await servico<unknown[]>(`select public.fiscal_fila_proximos(20) r`)).dados).toEqual([]);
  });
});
