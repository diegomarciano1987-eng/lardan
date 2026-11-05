/**
 * 0224 — maleta de abertura, DANFE enxuto e assinatura digital (ZapSign). Banco ISOLADO, dados sintéticos, sem rede.
 *  1. Abertura: pedido e promissória da maleta do representante saem com a consultora em branco; sem dono nenhum = recusa.
 *  2. Fila da nota: maleta de abertura entra na fila quando ganha consultora (produção + automático).
 *  3. DANFE: a montagem vê a nota da maleta e pode imprimir o DANFE dela; consultora não.
 *  4. ZapSign: representante só da carteira dele; dados do contrato e da promissória; registro/retorno só servidor;
 *     um pendente por documento, reenvio cancela o anterior; modelo só o Master edita.
 *  5. Funções puras: modelo preenchido, telefone, DANFE enxuto (65 itens → 2 páginas).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarVariante, rpc, type Conta } from "./base";
import { preencherModelo, telefoneZapsign, valoresDosCampos } from "../../src/lib/zapsign/modelo";
import { htmlDanfeCompacto, lerNfe, paginarItens, svgCodigoBarras } from "../../src/lib/danfe-compacto";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, montagem: Conta, repC: Conta, outroRep: Conta, cons: Conta;
let abertura = "", semDono = "", maletaCons = "", vA = "";
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
async function maleta(consultora: string | null, rep: string | null, status = "conferida") {
  const kit = await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [`ISO AB ${marca}`]);
  const c = await um<{ id: string }>(`insert into public.kit_cycles (kit_id, cycle_no, status, consultora_party_id, representante_party_id, custodian_party_id)
    values ($1,1,$2::kit_status,$3,$4,$4) returning id`, [kit.id, status, consultora, rep]);
  const comp = await um<{ id: string }>(`insert into public.kit_compositions (cycle_id, version) values ($1,1) returning id`, [c.id]);
  await adm.unsafe(`insert into public.kit_composition_items (composition_id, variant_id, quantity, unit_reference_cents) values ($1,$2,3,9990)`, [comp.id, vA]);
  return c.id;
}

beforeAll(async () => {
  original = await um(`select emission_active, provider, environment, emitter_entity_id, producao_todas, producao_automatico from public.fiscal_settings`);
  master = await criarConta({ nome: `ab-master-${marca}`, papeis: ["master"], comParty: true });
  montagem = await criarConta({ nome: `ab-mont-${marca}`, papeis: ["montagem"], comParty: true });
  repC = await criarConta({ nome: `ab-rep-${marca}`, papeis: ["representante"], comParty: true });
  outroRep = await criarConta({ nome: `ab-rep2-${marca}`, papeis: ["representante"], comParty: true });
  cons = await criarConta({ nome: `ab-cons-${marca}`, papeis: ["consultora"], comParty: true });
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'representante'),($2,'representante'),($3,'consultora') on conflict do nothing`,
    [repC.partyId, outroRep.partyId, cons.partyId]);
  await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id) values ($1,$2)
                    on conflict (party_id) do update set representative_party_id = excluded.representative_party_id`, [cons.partyId, repC.partyId]);
  await adm.unsafe(`update public.parties set doc = '52998224725' where id = $1`, [cons.partyId]);
  await adm.unsafe(`insert into public.contact_points (party_id, kind, value, is_primary) values ($1,'whatsapp','43999990000',true)`, [cons.partyId]);
  await adm.unsafe(`insert into public.party_addresses (party_id, label, postal_code, street, street_number, district, city, uf, ibge_city_code, is_primary, country)
                    values ($1,'Principal','86200000','Rua A','10','Centro','Ibiporã','PR','4109807',true,'BR')`, [cons.partyId]);
  vA = await criarVariante(`ab-a-${marca}`, 9990);
  abertura = await maleta(null, repC.partyId!, "transito");
  semDono = await maleta(null, null);
  maletaCons = await maleta(cons.partyId!, repC.partyId!, "recebida");
});

afterAll(async () => {
  await adm.unsafe(`delete from public.fiscal_fila where cycle_id = any($1::uuid[])`, [[abertura, semDono, maletaCons]]);
  await adm.unsafe(`delete from public.fiscal_focus_envios where ref like 'iso-ab-%'`);
  await adm.unsafe(`delete from public.assinaturas_digitais where party_id = $1`, [cons.partyId]);
  if (original) await adm.unsafe(`update public.fiscal_settings set emission_active=$1, provider=$2, environment=$3, emitter_entity_id=$4, producao_todas=$5, producao_automatico=$6`,
    [original["emission_active"], original["provider"], original["environment"], original["emitter_entity_id"], original["producao_todas"], original["producao_automatico"]]);
});

describe("1. abertura", () => {
  test("pedido e promissória da maleta do representante: consultora em branco; sem dono = recusa", async () => {
    const p = await rpc<{ abertura: boolean; consultora: { nome: string | null }; cliente_codigo: string | null; representante: { nome: string } | null; itens: unknown[] }>(
      montagem, "kit_pedido_dados", { _cycle: abertura });
    expect(p.erro).toBeNull();
    expect(p.dados.abertura).toBe(true);
    expect(p.dados.consultora.nome).toBeNull();
    expect(p.dados.cliente_codigo).toBeNull();
    expect(p.dados.itens).toHaveLength(1);
    const d = await rpc<{ abertura: boolean; nome: string | null; representante: string | null }>(montagem, "kit_consultora_doc", { _cycle: abertura });
    expect(d.erro).toBeNull();
    expect(d.dados).toMatchObject({ abertura: true, nome: null });
    expect(d.dados.representante).toContain("ab-rep-");
    expect((await rpc(montagem, "kit_pedido_dados", { _cycle: semDono })).erro).toContain("nem representante");
    expect((await rpc(montagem, "kit_consultora_doc", { _cycle: semDono })).erro).toContain("nem representante");
    // maleta com consultora segue igual
    expect((await rpc<{ abertura: boolean }>(montagem, "kit_pedido_dados", { _cycle: maletaCons })).dados.abertura).toBe(false);
  });
});

describe("2. fila da nota na abertura", () => {
  test("ganhou consultora com produção automática ligada → remessa na fila", async () => {
    const be = (await adm.unsafe(`select id from public.business_entities limit 1`) as { id: string }[])[0]
      ?? await um<{ id: string }>(`insert into public.business_entities (legal_name, tax_id) values ('ISO TSM', '43319208000180') returning id`);
    await adm.unsafe(`update public.fiscal_settings set provider='focus', environment='producao', emitter_entity_id=$1, emission_active=true, producao_todas=true, producao_automatico=true`, [be.id]);
    await adm.unsafe(`update public.kit_cycles set consultora_party_id = $2 where id = $1`, [abertura, cons.partyId]);
    expect((await um<{ n: number }>(`select count(*)::int n from public.fiscal_fila where cycle_id = $1 and etapa = 'remessa'`, [abertura])).n).toBe(1);
    await adm.unsafe(`update public.fiscal_settings set emission_active=false, producao_automatico=false, producao_todas=false`);
  });
});

describe("3. DANFE", () => {
  test("montagem vê e imprime a nota da maleta; consultora não", async () => {
    await servico(`select 1 r`);
    await adm.unsafe(`insert into public.fiscal_focus_envios (ref, ambiente, operacao, party_id, payload, status, cycle_id, caminho_xml)
                      values ($1,'homologacao','remessa',$2,'{}'::jsonb,'autorizado',$3,'/x.xml'), ($4,'homologacao','remessa',$2,'{}'::jsonb,'autorizado',null,'/y.xml')`,
      [`iso-ab-${marca}-m`, cons.partyId, maletaCons, `iso-ab-${marca}-s`]);
    expect((await rpc<boolean>(montagem, "fiscal_focus_pode_danfe", { _ref: `iso-ab-${marca}-m` })).dados).toBe(true);
    expect((await rpc<boolean>(montagem, "fiscal_focus_pode_danfe", { _ref: `iso-ab-${marca}-s` })).dados).toBe(false);
    expect((await rpc<boolean>(cons, "fiscal_focus_pode_danfe", { _ref: `iso-ab-${marca}-m` })).dados).toBe(false);
    const l = await rpc<{ cycle_id: string; tem_danfe: boolean }[]>(montagem, "fiscal_focus_notas_maletas", { _cycles: [maletaCons] });
    expect(l.dados).toHaveLength(1);
    expect(l.dados[0]!.tem_danfe).toBe(true);
    expect((await rpc<unknown[]>(cons, "fiscal_focus_notas_maletas", { _cycles: [maletaCons] })).dados).toEqual([]);
  });
});

describe("4. ZapSign", () => {
  test("permissão: representante dela sim, outro representante não, consultora não", async () => {
    expect((await rpc<boolean>(repC, "assinatura_pode", { _party: cons.partyId, _rep: repC.partyId })).dados).toBe(true);
    expect((await rpc<boolean>(outroRep, "assinatura_pode", { _party: cons.partyId, _rep: outroRep.partyId })).dados).toBe(false);
    expect((await rpc<boolean>(outroRep, "assinatura_pode", { _party: cons.partyId, _rep: repC.partyId })).dados).toBe(false);
    expect((await rpc<boolean>(cons, "assinatura_pode", { _party: cons.partyId, _rep: null })).dados).toBe(false);
    expect((await rpc(outroRep, "assinatura_dados", { _tipo: "contrato", _party: cons.partyId, _cycle: null, _rep: outroRep.partyId })).ok).toBe(false);
  });

  test("dados do contrato e da promissória", async () => {
    const c = await rpc<{ pendencias: string[]; signer: { whatsapp: string; cpf: string }; campos: Record<string, unknown>; modelo: { texto: string } }>(
      repC, "assinatura_dados", { _tipo: "contrato", _party: cons.partyId, _cycle: null, _rep: repC.partyId });
    expect(c.erro).toBeNull();
    expect(c.dados.pendencias).toEqual([]);
    expect(c.dados.signer.cpf).toBe("52998224725");
    expect(telefoneZapsign(c.dados.signer.whatsapp)).toEqual({ phone_country: "55", phone_number: "43999990000" });
    expect(c.dados.campos).toMatchObject({ cpf: "529.982.247-25", cidade: "Ibiporã/PR", cep: "86200-000", maleta: "" });
    expect(c.dados.modelo.texto).toContain("CONTRATO DE CONSIGNAÇÃO");
    const p = await rpc<{ campos: { valor_cents: number; maleta: string } }>(repC, "assinatura_dados", { _tipo: "promissoria", _party: cons.partyId, _cycle: maletaCons, _rep: repC.partyId });
    expect(p.erro).toBeNull();
    expect(p.dados.campos.valor_cents).toBe(29970);
    expect((await rpc(repC, "assinatura_dados", { _tipo: "promissoria", _party: cons.partyId, _cycle: semDono, _rep: repC.partyId })).erro).toContain("não é desta consultora");
  });

  test("registro, pendente único, reenvio, retorno e lista", async () => {
    const d = (tok: string, extra: Record<string, unknown> = {}) => JSON.stringify({ ambiente: "sandbox", tipo: "promissoria", party_id: cons.partyId, cycle_id: maletaCons,
      rep: repC.partyId, doc_token: tok, sign_url: `https://app.zapsign.com.br/verificar/${tok}`, titulo: "Nota promissória", texto_hash: "h", valor_cents: 29970, whatsapp: true, ator: repC.uid, ...extra });
    expect((await rpc(repC, "assinatura_registrar", { _d: {} })).ok).toBe(false);   // só servidor
    const t1 = crypto.randomUUID(), t2 = crypto.randomUUID();
    const r1 = await servico<{ id: string }>(`select public.assinatura_registrar($1::text::jsonb) r`, [d(t1)]);
    expect(r1.erro).toBeNull();
    expect((await servico(`select public.assinatura_registrar($1::text::jsonb) r`, [d(crypto.randomUUID())])).erro).toContain("assinaturas_pendente_unica");
    expect((await servico<{ id: string }>(`select public.assinatura_pendente('promissoria',$1::uuid,$2::uuid) r`, [cons.partyId, maletaCons])).dados!.id).toBe(r1.dados!.id);
    expect((await servico(`select public.assinatura_registrar($1::text::jsonb) r`, [d(t2, { substitui: r1.dados!.id })])).erro).toBeNull();
    expect((await um<{ status: string }>(`select status from public.assinaturas_digitais where doc_token = $1`, [t1])).status).toBe("cancelado");
    expect((await servico<{ status: string }>(`select public.assinatura_retorno($1,'signed',now()) r`, [t2])).dados!.status).toBe("assinado");
    expect((await servico<{ status: string }>(`select public.assinatura_retorno($1,'pending',null) r`, [t2])).dados!.status).toBe("assinado");   // não regride
    expect((await servico<{ ignorado: boolean }>(`select public.assinatura_retorno($1,'signed',null) r`, [crypto.randomUUID()])).dados!.ignorado).toBe(true);
    const l = await rpc<{ documentos: { status: string; sign_url: string | null }[]; maletas: { cycle_id: string; valor_cents: number }[] }>(
      repC, "assinaturas_da_consultora", { _party: cons.partyId, _rep: repC.partyId });
    expect(l.dados.documentos.map((x) => x.status)).toEqual(["assinado", "cancelado"]);
    expect(l.dados.documentos[0]!.sign_url).toBeNull();
    expect(l.dados.maletas.find((m) => m.cycle_id === maletaCons)!.valor_cents).toBe(29970);
    expect((await rpc(outroRep, "assinaturas_da_consultora", { _party: cons.partyId, _rep: outroRep.partyId })).ok).toBe(false);
  });

  test("modelo: só o Master edita; texto curto recusado", async () => {
    const atual = await um<{ texto: string }>(`select texto from public.assinatura_modelos where tipo = 'contrato'`);
    expect((await rpc(repC, "assinatura_modelo_salvar", { _tipo: "contrato", _titulo: "x", _texto: atual.texto, _revisado: true })).ok).toBe(false);
    expect((await rpc(master, "assinatura_modelo_salvar", { _tipo: "contrato", _titulo: "x", _texto: "curto", _revisado: true })).erro).toContain("curto");
    expect((await rpc(master, "assinatura_modelo_salvar", { _tipo: "contrato", _titulo: "Contrato — {{nome}}", _texto: atual.texto, _revisado: false })).erro).toBeNull();
  });
});

describe("5. funções puras", () => {
  test("modelo preenchido, campo vazio vira linha, markdown escapado; telefone", () => {
    const v = valoresDosCampos({ nome: "Ana *Souza*", cpf: "529.982.247-25", endereco: "Rua A, 10", bairro: "", cidade: "Ibiporã/PR", cep: "86200-000",
      whatsapp: "43999990000", representante: "Rep", praca: "Ibiporã", maleta: "MAL-1", remessa: "930", valor_cents: 29970, vencimento: "2026-12-21" },
      new Date("2026-11-05T15:00:00-03:00"));
    const t = preencherModelo("{{nome}} deve {{valor}} ({{valor_extenso}}) até {{vencimento}}, {{vencimento_extenso}}. Bairro {{bairro}} {{inexistente}}", v);
    expect(t).toContain("Ana \\*Souza\\*");
    expect(t).toMatch(/R\$\s299,70/);
    expect(t).toContain("21/12/2026, 21 de dezembro de 2026");
    expect(t).toContain("Bairro ________________ ________________");
    expect(v["hoje_extenso"]).toBe("5 de novembro de 2026");
    expect(telefoneZapsign("+55 (43) 99999-0000")).toEqual({ phone_country: "55", phone_number: "43999990000" });
    expect(telefoneZapsign("4332345678")).toEqual({ phone_country: "55", phone_number: "4332345678" });
    expect(telefoneZapsign("123")).toBeNull();
  });

  test("DANFE enxuto: lê o XML, 65 itens em 2 páginas, código de barras da chave", () => {
    const chave = "41261143319208000180550010000050051989610219";
    const itens = Array.from({ length: 65 }, (_, i) => `<det nItem="${i + 1}"><prod><cProd>LAN${i}</cProd><xProd>BRINCO ${i} &amp; CIA</xProd><NCM>71171900</NCM><CFOP>5917</CFOP><uCom>UND</uCom><qCom>1.0000</qCom><vUnCom>21.63</vUnCom><vProd>21.63</vProd></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto></det>`).join("");
    const xml = `<nfeProc><NFe><infNFe Id="NFe${chave}" versao="4.00"><ide><natOp>- REM/CONSIG.</natOp><serie>3</serie><nNF>1</nNF><dhEmi>2026-11-05T15:45:40-03:00</dhEmi><tpNF>1</tpNF><tpAmb>1</tpAmb></ide>
      <emit><CNPJ>43319208000180</CNPJ><xNome>TSM COMERCIO DE SEMIJOIAS LTDA</xNome><enderEmit><xLgr>Av</xLgr><nro>1</nro><xBairro>S</xBairro><xMun>Ibiporã</xMun><UF>PR</UF><CEP>86200055</CEP></enderEmit><IE>9090830101</IE><CRT>1</CRT></emit>
      <dest><CPF>52998224725</CPF><xNome>Amanda</xNome><enderDest><xLgr>Rua</xLgr><nro>2</nro><xBairro>C</xBairro><xMun>Londrina</xMun><UF>PR</UF><CEP>86000000</CEP></enderDest></dest>
      ${itens}<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vProd>1405.95</vProd><vNF>1405.95</vNF></ICMSTot></total><transp><modFrete>9</modFrete></transp>
      <infAdic><infCpl>----- REMESSA: 930 KIT: 4 -----</infCpl></infAdic></infNFe></NFe><protNFe><infProt><chNFe>${chave}</chNFe><dhRecbto>2026-11-05T15:45:44-03:00</dhRecbto><nProt>141260000682539</nProt></infProt></protNFe></nfeProc>`;
    const d = lerNfe(xml);
    expect(d).toMatchObject({ chave, numero: "1", serie: "3", natOp: "- REM/CONSIG.", homologacao: false, protocolo: "141260000682539" });
    expect(d.itens).toHaveLength(65);
    expect(d.itens[0]).toMatchObject({ codigo: "LAN0", descricao: "BRINCO 0 & CIA", cst: "0102", cfop: "5917", qtd: 1, unit: 21.63 });
    expect(paginarItens(d.itens).map((p) => p.length)).toEqual([46, 19]);
    const html = htmlDanfeCompacto(d);
    expect(html).toContain("FOLHA 1/2");
    expect(html).toContain("BRINCO 0 &amp; CIA");
    expect(html).toContain("65 itens · 65 peças");
    expect(html).not.toContain("SEM VALOR FISCAL");
    expect(svgCodigoBarras(chave)).toMatch(/^<svg[^>]+viewBox="0 0 \d+ 40"/);
    expect(htmlDanfeCompacto({ ...d, homologacao: true })).toContain("SEM VALOR FISCAL");
  });
});
