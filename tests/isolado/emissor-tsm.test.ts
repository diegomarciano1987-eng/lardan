import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { adm } from "./base";

// Cenários sintéticos locais: nenhum cadastro real é copiado.
const cadastro = readFileSync(new URL("../../db/aplicados/0165_emissor_fiscal_tsm.sql", import.meta.url), "utf8");

test("TSM: CNPJ/IE/endereço exatos, emissão desligada, regra preservada e endereço anterior mantido", async () => {
  const c = await adm.reserve();
  try {
    await c.unsafe("begin");
    const [p] = await c.unsafe(`insert into public.parties(kind,display_name,doc) values ('organizacao','ISO TSM','43319208000180') returning id`);
    if (!p) throw new Error("Pessoa não criada");
    await c.unsafe(`insert into public.party_addresses(party_id,street,street_number,city,uf,postal_code,is_primary) values ($1,'Avenida dos Estudantes','1277','Ibiporã','PR','86200000',true)`, [p.id]);
    await c.unsafe(`update public.fiscal_settings set provider='focus', environment='homologacao', emission_active=false where id`);
    const antes = await c.unsafe(`select note, updated_by from public.fiscal_settings`);
    await c.unsafe(cadastro);
    const [r] = await c.unsafe(`select b.tax_id,b.state_registration,b.legal_name,s.provider,s.environment,s.emission_active from public.fiscal_settings s join public.business_entities b on b.id=s.emitter_entity_id`);
    expect(r).toEqual({ tax_id: "43319208000180", state_registration: "9090830101", legal_name: "TSM COMERCIO DE SEMIJOIAS LTDA", provider: "focus", environment: "homologacao", emission_active: false });
    expect(await c.unsafe(`select note, updated_by from public.fiscal_settings`)).toEqual(antes);
    const [end] = await c.unsafe(`select postal_code,ibge_city_code,street_number,district from public.party_addresses where party_id=$1 and is_primary`, [p.id]);
    expect(end).toEqual({ postal_code: "86200055", ibge_city_code: "4109807", street_number: "1277", district: "Setor 1" });
    const [antigo] = await c.unsafe(`select is_primary from public.party_addresses where party_id=$1 and postal_code='86200000'`, [p.id]);
    expect(antigo?.is_primary).toBe(false);
    await c.unsafe(cadastro);
    const [contagem] = await c.unsafe(`select (select count(*)::int from public.business_entities where tax_id='43319208000180') empresas,(select count(*)::int from public.party_addresses where party_id=$1) enderecos`, [p.id]);
    expect(contagem).toEqual({ empresas: 1, enderecos: 2 });
  } finally { await c.unsafe("rollback"); c.release(); }
});

test("TSM: duas identidades não unificadas são recusadas sem gravar emissor", async () => {
  const c = await adm.reserve();
  try {
    await c.unsafe("begin");
    await c.unsafe(`insert into public.parties(kind,display_name,doc) values ('organizacao','ISO A','43319208000180'),('organizacao','ISO B','43319208000180')`);
    await c.unsafe("savepoint cadastro");
    let mensagem = "";
    try { await c.unsafe(cadastro); } catch (e) { mensagem = e instanceof Error ? e.message : String(e); }
    await c.unsafe("rollback to savepoint cadastro");
    expect(mensagem).toContain("Mais de uma pessoa");
    const [r] = await c.unsafe(`select count(*)::int n from public.business_entities where tax_id='43319208000180'`);
    expect(r?.n).toBe(0);
  } finally { await c.unsafe("rollback"); c.release(); }
});

test("TSM: cadastro oficialmente unificado é ignorado sem apagar seu CNPJ histórico", async () => {
  const c = await adm.reserve();
  try {
    await c.unsafe("begin");
    const rows = await c.unsafe(`insert into public.parties(kind,display_name,doc) values ('organizacao','ISO LARDAN','43319208000180'),('organizacao','ISO TSM antiga','43319208000180') returning id`);
    const [can, dup] = rows;
    if (!can || !dup) throw new Error("Pessoas não criadas");
    await c.unsafe(`insert into public.party_unificacoes(canonica_id,duplicada_id,motivo) values ($1,$2,'ISO identidade comprovada')`, [can.id, dup.id]);
    await c.unsafe(cadastro);
    const [b] = await c.unsafe(`select party_id from public.business_entities where tax_id='43319208000180'`);
    expect(b?.party_id).toBe(can.id);
    const [historico] = await c.unsafe(`select doc_canon from public.parties where id=$1`, [dup.id]);
    expect(historico?.doc_canon).toBe("43319208000180");
  } finally { await c.unsafe("rollback"); c.release(); }
});