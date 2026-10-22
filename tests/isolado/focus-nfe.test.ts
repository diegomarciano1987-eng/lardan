/**
 * Focus NFe (0118) — montagem da nota pelo roteiro (sem rede) e banco ISOLADO.
 *  1. Remessa, devolução, venda e perda saem com natureza, CFOP, tipo, finalidade e referência do roteiro.
 *  2. Valor = 1/3 do varejo; homologação usa o nome exigido pela SEFAZ.
 *  3. Pendência de cadastro impede o envio.
 *  4. Banco: permissão, dados da consultora, registro só pelo servidor, retorno idempotente e sem regressão de estado.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarVariante, rpc, type Conta } from "./base";
import { montarNfe, NOME_HOMOLOGACAO, pendenciasNfe, valorFiscalUnitario, type EntradaNfe } from "../../src/lib/focus/nfe";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const CHAVE = "41261043319208000180550020000123451000012345";
const base: EntradaNfe = {
  operacao: "remessa",
  ambiente: "homologacao",
  cnpjEmitente: "43.319.208/0001-80",
  ufEmitente: "PR",
  destinatario: {
    nome: "Maria Teste", cpf: "529.982.247-25", logradouro: "Rua A", numero: "10", bairro: "Centro", municipio: "Ibiporã",
    uf: "PR", cep: "86200-000", codigo_municipio: "4109807", email: "maria@exemplo.com", telefone: "(43) 99999-0000",
  },
  itens: [
    { codigo: "BR001", descricao: "Brinco argola", ncm: "71171900", quantidade: 2, preco_varejo_cents: 8990 },
    { codigo: "AN002", descricao: "Anel solitário", ncm: "71171900", quantidade: 1, preco_varejo_cents: 12000 },
  ],
  remessa: { numero: 922, kit: 1 },
  dataEmissao: "2026-10-22T10:00:00-03:00",
};

describe("1. roteiro", () => {
  test("remessa dentro do PR", () => {
    const n = montarNfe(base);
    expect(n).toMatchObject({ natureza_operacao: "- REM/CONSIG.", tipo_documento: 1, finalidade_emissao: 1, local_destino: 1,
      consumidor_final: 1, presenca_comprador: 1, modalidade_frete: 9, indicador_inscricao_estadual_destinatario: 9,
      cnpj_emitente: "43319208000180", cpf_destinatario: "52998224725", nome_destinatario: NOME_HOMOLOGACAO,
      codigo_municipio_destinatario: "4109807", informacoes_adicionais_contribuinte: "----- REMESSA: 922 KIT: 1 -----" });
    const itens = n["items"] as Record<string, unknown>[];
    expect(itens[0]).toMatchObject({ cfop: "5917", icms_situacao_tributaria: "102", pis_situacao_tributaria: "07",
      cofins_situacao_tributaria: "07", icms_origem: 0, unidade_comercial: "UND", valor_unitario_comercial: 29.97, valor_bruto: 59.94 });
    expect(itens[1]).toMatchObject({ valor_unitario_comercial: 40, valor_bruto: 40 });
    expect(n["valor_total"]).toBe(99.94);
    expect(n["notas_referenciadas"]).toBeUndefined();
  });

  test("remessa para SP é interestadual (6917)", () => {
    const n = montarNfe({ ...base, destinatario: { ...base.destinatario, uf: "SP", codigo_municipio: "3504008" } });
    expect(n["local_destino"]).toBe(2);
    expect((n["items"] as { cfop: string }[])[0]!.cfop).toBe("6917");
  });

  test("devolução é ENTRADA, finalidade 4 e referencia a remessa", () => {
    const n = montarNfe({ ...base, operacao: "devolucao", origem: { chave: CHAVE, numero: 12345, data: "2026-10-01" } });
    expect(n).toMatchObject({ natureza_operacao: "- DEVOLUCAO REMESSA", tipo_documento: 0, finalidade_emissao: 4 });
    expect(n["notas_referenciadas"]).toEqual([{ chave_nfe: CHAVE }]);
    expect((n["items"] as { cfop: string }[])[0]!.cfop).toBe("1918");
    expect(String(n["informacoes_adicionais_contribuinte"])).toContain("ATRAVES DA NF N. 12345, DE 01.10.2026");
  });

  test("venda (simples faturamento) e perda fora do PR", () => {
    const v = montarNfe({ ...base, operacao: "venda", origem: { chave: CHAVE, numero: 7, data: "2026-10-01" } });
    expect((v["items"] as { cfop: string }[])[0]!.cfop).toBe("5114");
    expect(String(v["informacoes_adicionais_contribuinte"])).toContain("SIMPLES FATURAMENTO");
    expect(v["notas_referenciadas"]).toBeUndefined();
    const p = montarNfe({ ...base, operacao: "perda", origem: { chave: CHAVE, numero: 7, data: "2026-10-01" },
      destinatario: { ...base.destinatario, uf: "SP", codigo_municipio: "3504008" } });
    expect((p["items"] as { cfop: string }[])[0]!.cfop).toBe("6949");
  });

  test("produção usa o nome real; 1/3 arredonda por peça", () => {
    expect(montarNfe({ ...base, ambiente: "producao" })["nome_destinatario"]).toBe("Maria Teste");
    expect(valorFiscalUnitario(100)).toBe(0.33);
    expect(valorFiscalUnitario(8990)).toBe(29.97);
  });

  test("pendências impedem o envio", () => {
    const ruim = { ...base, destinatario: { ...base.destinatario, codigo_municipio: null, cpf: "123" } };
    expect(pendenciasNfe(ruim)).toEqual(expect.arrayContaining(["cidade sem código IBGE", "CPF da consultora inválido"]));
    expect(() => montarNfe(ruim)).toThrow("Nota não pode ser enviada");
    expect(() => montarNfe({ ...base, operacao: "devolucao" })).toThrow("falta a NF de remessa de origem");
  });
});

// ------------------------------------------------------------- banco ---
let master: Conta, financeiro: Conta, consultora: Conta;
let completa = "", incompleta = "", variante = "";
const REF = `iso-focus-${Date.now().toString(36)}`;

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
const registrar = (ref: string, op = "remessa", origem: string | null = null, ambiente = "homologacao") =>
  servico<{ ref: string }>(`select public.fiscal_focus_envio_registrar($1,$2,$3,$4,$5,$6::text::jsonb,$7) r`,
    [ref, ambiente, op, origem, completa, JSON.stringify({ items: [{ codigo_produto: "X", quantidade_comercial: 1 }], valor_total: 1 }), master.uid]);
const retorno = (ref: string, fonte: string, resp: unknown, dedupe: string | null = null) =>
  servico<{ status: string; repetido?: boolean; ignorado?: boolean }>(`select public.fiscal_focus_retorno($1,$2,$3::text::jsonb,$4) r`, [ref, fonte, JSON.stringify(resp), dedupe]);

beforeAll(async () => {
  master = await criarConta({ nome: "master-focus", papeis: ["master"], comParty: true });
  financeiro = await criarConta({ nome: "fin-focus", papeis: ["financeiro"], comParty: true });
  consultora = await criarConta({ nome: "cons-focus", papeis: ["consultora"], comParty: true });
  completa = consultora.partyId!;
  incompleta = financeiro.partyId!;
  await adm.unsafe(`update public.parties set doc = '52998224725' where id = $1`, [completa]);
  await adm.unsafe(`insert into public.party_addresses (party_id, label, postal_code, street, street_number, district, city, uf, ibge_city_code, is_primary, country)
                    values ($1,'Principal','86200000','Rua A','10','Centro','Ibiporã','PR','4109807',true,'BR')`, [completa]);
  variante = await criarVariante("focus-a", 8990);
});

afterAll(async () => {
  await adm.unsafe(`delete from public.fiscal_focus_eventos where ref like 'iso-focus-%'`);
  await adm.unsafe(`delete from public.fiscal_focus_envios where ref like 'iso-focus-%' and ref_origem is not null`);
  await adm.unsafe(`delete from public.fiscal_focus_envios where ref like 'iso-focus-%'`);
});

describe("2. banco", () => {
  test("permissões e leitura dos dados", async () => {
    expect((await rpc<boolean>(master, "fiscal_focus_pode", { _acao: "emitir" })).dados).toBe(true);
    expect((await rpc<boolean>(financeiro, "fiscal_focus_pode", { _acao: "ver" })).dados).toBe(true);
    expect((await rpc<boolean>(financeiro, "fiscal_focus_pode", { _acao: "emitir" })).dados).toBe(false);
    expect((await rpc<boolean>(consultora, "fiscal_focus_pode", { _acao: "ver" })).dados).toBe(false);
    expect((await rpc(financeiro, "fiscal_focus_dados", { _party: completa, _itens: [] })).ok).toBe(false);

    const d = await rpc<{ destinatario: { cpf: string; codigo_municipio: string }; itens: { ncm: string; preco_varejo_cents: number; quantidade: number }[]; pendencias: string[] }>(
      master, "fiscal_focus_dados", { _party: completa, _itens: [{ variant_id: variante, quantidade: 3 }] });
    expect(d.erro).toBeNull();
    expect(d.dados.pendencias).toEqual([]);
    expect(d.dados.destinatario).toMatchObject({ cpf: "52998224725", codigo_municipio: "4109807" });
    expect(d.dados.itens[0]).toMatchObject({ ncm: "71171900", preco_varejo_cents: 8990, quantidade: 3 });

    const p = await rpc<{ pendencias: string[] }>(master, "fiscal_focus_dados", { _party: incompleta, _itens: [] });
    expect(p.dados.pendencias).toEqual(expect.arrayContaining(["CPF inválido ou ausente", "sem endereço"]));
  });

  test("só o servidor registra; só homologação; derivada exige remessa autorizada", async () => {
    const naoServidor = await rpc(master, "fiscal_focus_envio_registrar", { _ref: REF, _ambiente: "homologacao", _operacao: "remessa",
      _ref_origem: null, _party: completa, _payload: {}, _ator: master.uid });
    expect(naoServidor.ok).toBe(false);
    expect((await registrar(`${REF}-p`, "remessa", null, "producao")).ok).toBe(false);
    expect((await registrar(`${REF}-d`, "devolucao", null)).ok).toBe(false);
    expect((await registrar(REF)).ok).toBe(true);
    expect((await registrar(`${REF}-d`, "devolucao", REF)).erro).toContain("remessa autorizada");
  });

  test("retorno: autoriza, deduplica, não regride e cancela", async () => {
    expect((await retorno(REF, "envio", { status: "processando_autorizacao" })).dados!.status).toBe("processando_autorizacao");
    const aut = { ref: REF, status: "autorizado", status_sefaz: "100", mensagem_sefaz: "Autorizado o uso da NF-e", chave_nfe: `NFe${CHAVE}`,
                  numero: "12345", serie: "3", caminho_danfe: "/arquivos/danfe.pdf", caminho_xml_nota_fiscal: "/arquivos/nfe.xml" };
    expect((await retorno(REF, "webhook", aut, "d1")).dados!.status).toBe("autorizado");
    expect((await retorno(REF, "webhook", aut, "d1")).dados!.repetido).toBe(true);
    // aviso atrasado de "processando" não volta a nota
    expect((await retorno(REF, "webhook", { status: "processando_autorizacao" }, "d2")).dados!.status).toBe("autorizado");
    const e = await um<{ chave_nfe: string; numero: string; serie: string; caminho_danfe: string }>(
      `select chave_nfe, numero, serie, caminho_danfe from public.fiscal_focus_envios where ref=$1`, [REF]);
    expect(e).toEqual({ chave_nfe: CHAVE, numero: "12345", serie: "3", caminho_danfe: "/arquivos/danfe.pdf" });

    // com a remessa autorizada, a devolução de teste pode ser registrada
    expect((await registrar(`${REF}-d`, "devolucao", REF)).ok).toBe(true);
    // cancelamento recusado mantém autorizada; aceito cancela
    expect((await retorno(REF, "cancelamento", { status: "erro_cancelamento", mensagem_sefaz: "Prazo" })).dados!.status).toBe("autorizado");
    expect((await retorno(REF, "cancelamento", { status: "cancelado", caminho_xml_cancelamento: "/arquivos/c.xml" })).dados!.status).toBe("cancelado");
    expect((await retorno(REF, "webhook", { status: "autorizado" }, "d3")).dados!.status).toBe("cancelado");
    expect((await retorno("iso-focus-desconhecida", "webhook", { status: "autorizado" })).dados!.ignorado).toBe(true);
    expect((await rpc(master, "fiscal_focus_retorno", { _ref: REF, _fonte: "webhook", _resposta: { status: "autorizado" } })).ok).toBe(false);
  });

  test("lista para a tela sem CPF; tabelas sem acesso direto", async () => {
    const l = await rpc<{ ref: string; status: string }[]>(financeiro, "fiscal_focus_envios_lista", { _limite: 50 });
    expect(l.erro).toBeNull();
    expect(l.dados.find((x) => x.ref === REF)!.status).toBe("cancelado");
    expect(JSON.stringify(l.dados)).not.toContain("52998224725");
    expect((await rpc(consultora, "fiscal_focus_envios_lista", {})).ok).toBe(false);
    const direto = await adm.reserve();
    try {
      await direto.unsafe(`set role authenticated`);
      let erro = "";
      try { await direto.unsafe(`select count(*) from public.fiscal_focus_envios`); } catch (e) { erro = (e as Error).message; }
      expect(erro).toContain("permission denied");
    } finally {
      await direto.unsafe(`reset role`);
      direto.release();
    }
  });
});
