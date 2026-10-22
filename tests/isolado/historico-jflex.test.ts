/**
 * Histórico do JFLEX (migração 0112) — banco ISOLADO, dados sintéticos.
 *  1. Só Master (ou o servidor) importa; reimportar não duplica.
 *  2. Vínculo nunca cria pessoa: código antigo, depois CPF único; CPF repetido fica de fora.
 *  3. Tabelas sem acesso direto; consultora e representante não leem o histórico de outras.
 *  4. Consultora vê só o próprio histórico no app.
 *  5. Cockpit, rede e montagem devolvem números coerentes com o que foi importado.
 *  6. Numeração de remessa continua depois do JFLEX e recusa número já usado lá.
 *  7. Nada muda em maletas, estoque, pedidos, financeiro ou fiscal.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, ler, rpc, VISITANTE, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 800000 + Math.floor(Math.random() * 90000); // códigos exclusivos desta bateria
const REM = 60000 + Math.floor(Math.random() * 9000);    // números de remessa exclusivos
const cod = (i: number) => base + i;

function cpf() {
  const d = String(100000000 + Math.floor(Math.random() * 899999999)).slice(0, 9).split("").map(Number);
  const dv = (a: number[]) => { const r = (a.reduce((t, x, i) => t + x * (a.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(d);
  return [...d, d1, dv([...d, d1])].join("");
}

let master: Conta, financeiro: Conta, estoque: Conta, consA: Conta, consB: Conta, rep: Conta;
const cpfA = cpf(), cpfB = cpf(), cpfDuplo = cpf();
let partyA = "", partyB = "";

async function importar(tipo: string, linhas: Record<string, unknown>[], conta?: Conta) {
  return rpc(conta ?? master, "legado_importar", { _tipo: tipo, _lote: `iso-${base}`, _linhas: linhas });
}
/** Servidor (service_role, sem usuário), como uma carga feita pelo backend. */
async function importarServico(tipo: string, linhas: Record<string, unknown>[]) {
  const c = await adm.reserve();
  try {
    await c.unsafe(`set role service_role`);
    await c.unsafe(`select set_config('lardan.test_role','service_role',false), set_config('lardan.test_uid','',false)`);
    await c.unsafe(`select public.legado_importar($1, $2, $3::text::jsonb)`, [tipo, `iso-srv-${base}`, JSON.stringify(linhas)]);
    return null;
  } catch (e) { return (e as Error).message; } finally {
    try { await c.unsafe(`reset role`); await c.unsafe(`select set_config('lardan.test_role','',false)`); } catch { /* */ }
    c.release();
  }
}
const contagem = async () => um<Record<string, string>>(
  `select (select count(*) from public.parties) parties, (select count(*) from public.kit_cycles) ciclos,
          (select count(*) from public.stock_movements) estoque, (select count(*) from public.sales_orders) pedidos,
          (select count(*) from public.financial_titles) titulos, (select count(*) from public.fiscal_documents) fiscais,
          (select count(*) from public.remessas) remessas`);
let antes: Record<string, string>;

beforeAll(async () => {
  master = await criarConta({ nome: "master-hist", papeis: ["master"], comParty: true });
  financeiro = await criarConta({ nome: "fin-hist", papeis: ["financeiro"], comParty: true });
  estoque = await criarConta({ nome: "est-hist", papeis: ["estoque"], comParty: true });
  consA = await criarConta({ nome: "consA-hist", papeis: ["consultora"], comParty: true });
  consB = await criarConta({ nome: "consB-hist", papeis: ["consultora"], comParty: true });
  rep = await criarConta({ nome: "rep-hist", papeis: ["representante"], comParty: true });
  partyA = consA.partyId!; partyB = consB.partyId!;
  await adm.unsafe(`update public.parties set doc=$2 where id=$1`, [partyA, cpfA]);
  await adm.unsafe(`update public.parties set doc=$2 where id=$1`, [partyB, cpfB]);
  // consultora B já tinha o código antigo registrado (como fez a importação do fiado)
  await adm.unsafe(`insert into public.party_codigos_legados (party_id, sistema, codigo) values ($1,'cliente',$2)`, [partyB, String(cod(2))]);
  // duas pessoas com o mesmo CPF: ambíguo, não pode ligar
  for (const n of ["Dupla 1", "Dupla 2"]) {
    await adm.unsafe(`insert into public.parties (kind, display_name, legal_name, status, doc) values ('pessoa',$1,$1,'ativo',$2)`, [`ISO ${n} ${base}`, cpfDuplo]);
  }
  // Roteiro fiscal observado no JFLEX: as mesmas referências já cadastradas no
  // projeto, reproduzidas aqui de forma idempotente para a bancada.
  await adm.unsafe(`insert into public.fiscal_roteiro_referencia (operacao,natureza,cfop_interno,cfop_interestadual,tipo_documento,finalidade,csosn,pis_cst,cofins_cst,ncm_padrao,origem,unidade,mod_frete,valor_base,texto_complementar,fonte,observacao) values
    ('remessa','- REM/CONSIG.','5917','6917','saida','1 normal','102','07','07','71171900','0','UND','9','1/3 do valor de varejo da peça','----- REMESSA: {remessa} KIT: {kit} -----','JFLEX série 2, nov/2023–out/2026 (28.390 notas)','Destinatária pessoa física, consumidor final; 30% das notas para SP (6917).'),
    ('devolucao','- DEVOLUCAO REMESSA','1918','2918','entrada','4 devolução','102','07','07','71171900','0','UND','9','1/3 do valor de varejo da peça','----- REMESSA: {remessa} KIT: {kit} -----;DEVOLUCAO DAS MERCADORIAS RECEBIDAS EM CONSIGNACAO MERCANTIL ATRAVES DA NF N. {nf_remessa}, DE {data_remessa}','JFLEX série 2 (26.269 notas)','Nota de entrada emitida pela própria Lardan, sempre referenciando a NF de remessa.'),
    ('venda','- VENDA CONSIGNADO','5114','6114','saida','1 normal','102','07','07','71171900','0','UND','9','1/3 do valor de varejo da peça','----- REMESSA: {remessa} KIT: {kit} -----;SIMPLES FATURAMENTO DE MERCADORIA EM CONSIGNACAO - NF N. {nf_remessa}, DE {data_remessa}','JFLEX série 2 (18.476 notas)','Só as peças vendidas. Não há nota de devolução simbólica no roteiro atual.'),
    ('perda','- PERDA DE PRODUTOS','5927','6949','saida','1 normal','102','07','07','71171900','0','UND','9','1/3 do valor de varejo da peça','----- REMESSA: {remessa} KIT: {kit} -----;NOTA REFERENTE A PERDA DE MERCADORIA EM CONSIGNACAO','JFLEX série 2 (276 notas)','Fora do PR o JFLEX usou 6949 (outras saídas): confirmar com o contador.')
    on conflict (operacao) do update set natureza=excluded.natureza, cfop_interno=excluded.cfop_interno, cfop_interestadual=excluded.cfop_interestadual, tipo_documento=excluded.tipo_documento, finalidade=excluded.finalidade, csosn=excluded.csosn, pis_cst=excluded.pis_cst, cofins_cst=excluded.cofins_cst, ncm_padrao=excluded.ncm_padrao, origem=excluded.origem, unidade=excluded.unidade, mod_frete=excluded.mod_frete, valor_base=excluded.valor_base, texto_complementar=excluded.texto_complementar, fonte=excluded.fonte, observacao=excluded.observacao`);
  antes = await contagem();
});

afterAll(async () => {
  for (const t of ["legado_maleta_vendidos", "legado_maleta_categorias", "legado_notas", "legado_maletas"])
    await adm.unsafe(`delete from public.${t} where codcli between $1 and $2`, [base, base + 99]);
  await adm.unsafe(`delete from public.legado_remessas where numero between $1 and $2`, [REM, REM + 99]);
  await adm.unsafe(`delete from public.legado_consultoras where codcli between $1 and $2`, [base, base + 99]);
  await adm.unsafe(`delete from public.legado_produtos where codigo between $1 and $2`, [base, base + 99]);
  await adm.unsafe(`delete from public.legado_pracas where codigo = $1`, [base]);
});

const maleta = (remessa: number, c: number, enviadas: number, devolvidas: number, valorEnv: number, valorDev: number, fechamento = "2025-03-10") =>
  ({ remessa, codcli: c, kit: 1, tipo: "remessa", emissao: "2025-02-01", fechamento, pecas_enviadas: enviadas, pecas_devolvidas: devolvidas,
     pecas_defeito: 0, valor_enviado: valorEnv, valor_devolvido: valorDev, nf_remessa: "10", nf_devolucao: "11", nf_venda: "12", nf_perda: "" });

describe("1. importação", () => {
  test("consultora, financeiro e visitante não importam", async () => {
    for (const c of [consA, financeiro, VISITANTE]) expect((await importar("pracas", [{ codigo: base, nome: "X" }], c)).ok).toBe(false);
  });

  test("o servidor também importa (carga pelo backend)", async () => {
    expect(await importarServico("pracas", [{ codigo: base, nome: "PRACA ISO", dias: "42" }])).toBeNull();
  });

  test("Master importa tudo; reenviar não duplica e atualiza", async () => {
    const r = await importar("pracas", [{ codigo: base, nome: "PRACA ISO", dias: "42", cidades: "Ibiporã/PR" }], master);
    expect(r.erro).toBeNull();
    expect((await importar("consultoras", [
      { codcli: cod(1), nome: "Ana", cpf: cpfA, cidade: "Ibiporã", uf: "PR", praca: base, ativo: "1" },
      { codcli: cod(2), nome: "Bia", cpf: "", cidade: "Cambé", uf: "PR", praca: base, ativo: "1" },
      { codcli: cod(3), nome: "Duplo", cpf: cpfDuplo, cidade: "Londrina", uf: "PR", praca: base, ativo: "0" },
      { codcli: cod(4), nome: "Sem cadastro", cpf: cpf(), cidade: "Assis", uf: "SP", praca: base, ativo: "1" },
    ])).erro).toBeNull();
    expect((await importar("produtos", [
      { codigo: cod(51), nome: "Brinco ISO", referencia: `ISO-${base}-1`, categoria: "BRINCO", subcategoria: "ARGOLA", ativo: "1", preco_venda: "50.00" },
      { codigo: cod(52), nome: "Anel ISO", referencia: `ISO-${base}-2`, categoria: "ANEL", subcategoria: "SOLITARIO", ativo: "1", preco_venda: "80.00" },
    ])).erro).toBeNull();
    expect((await importar("remessas", [
      { numero: REM, emissao: "2025-02-01", vencimento: "2025-03-15", status: "fechada", praca: base, representante: "" },
      { numero: REM + 1, emissao: "2025-04-01", vencimento: "2025-05-15", status: "aberta", praca: base, representante: "" },
    ])).erro).toBeNull();
    expect((await importar("maletas", [
      maleta(REM, cod(1), 60, 50, 3000, 2500),      // Ana vendeu 10 (R$ 500)
      maleta(REM, cod(2), 40, 38, 2000, 1900),      // Bia vendeu 2 (R$ 100)
      maleta(REM + 1, cod(1), 50, 0, 2500, 0, ""),  // aberta: não conta venda
    ])).erro).toBeNull();
    expect((await importar("maleta_categorias", [
      { remessa: REM, codcli: cod(1), kit: 1, categoria: "brinco", pecas_enviadas: 40, pecas_devolvidas: 32, valor_enviado: 2000, valor_devolvido: 1600 },
      { remessa: REM, codcli: cod(1), kit: 1, categoria: "ANEL", pecas_enviadas: 20, pecas_devolvidas: 18, valor_enviado: 1000, valor_devolvido: 900 },
      { remessa: REM, codcli: cod(2), kit: 1, categoria: "BRINCO", pecas_enviadas: 30, pecas_devolvidas: 29, valor_enviado: 1500, valor_devolvido: 1450 },
      { remessa: REM, codcli: cod(2), kit: 1, categoria: "ANEL", pecas_enviadas: 10, pecas_devolvidas: 9, valor_enviado: 500, valor_devolvido: 450 },
    ])).erro).toBeNull();
    expect((await importar("maleta_vendidos", [
      { remessa: REM, codcli: cod(1), kit: 1, produto: cod(51), tamanho: "U", quantidade: 8, valor_unitario: "50.00" },
      { remessa: REM, codcli: cod(1), kit: 1, produto: cod(52), tamanho: "16", quantidade: 2, valor_unitario: "50.00" },
    ])).erro).toBeNull();
    expect((await importar("notas", [
      { nf_id: base, numero: base, serie: 2, chave: "", emitida_em: "2025-02-01T10:00:00", natureza: "REM/CONSIG.", tipo: "R",
        codcli: cod(1), remessa: REM, kit: 1, valor: "1000.00", pecas: 60, cfop: "5917", situacao: "autorizada", operacao: "saida" },
    ])).erro).toBeNull();

    // reenviar a mesma maleta com outro valor: atualiza, não duplica
    expect((await importar("maletas", [maleta(REM, cod(2), 40, 37, 2000, 1850)])).erro).toBeNull();
    const m = await um<{ n: number; vend: number }>(
      `select count(*)::int n, sum(pecas_vendidas)::int vend from public.legado_maletas where remessa=$1 and codcli=$2`, [REM, cod(2)]);
    expect(m).toEqual({ n: 1, vend: 3 });
    expect(Number((await um<{ v: string }>(`select valor_vendido_cents v from public.legado_maletas where remessa=$1 and codcli=$2`, [REM, cod(2)])).v)).toBe(15000);
    // categoria normalizada em maiúsculas
    expect((await um<{ n: number }>(`select count(*)::int n from public.legado_maleta_categorias where codcli=$1 and categoria='BRINCO'`, [cod(1)])).n).toBe(1);
  });

  test("mais de 2.000 linhas por envio é recusado", async () => {
    const muitas = Array.from({ length: 2001 }, (_, i) => ({ codigo: base, nome: `X${i}` }));
    expect((await importar("pracas", muitas)).ok).toBe(false);
  });
});

describe("2. vínculo sem duplicar pessoas", () => {
  test("liga por código antigo e por CPF único; CPF repetido e sem cadastro ficam de fora; nenhuma pessoa nova", async () => {
    const pessoasAntes = (await um<{ n: number }>(`select count(*)::int n from public.parties`)).n;
    const r = await rpc<{ consultoras: Record<string, number> }>(master, "legado_vincular", { _gravar_codigos: true });
    expect(r.erro).toBeNull();
    const l = (await adm.unsafe(`select codcli, party_id, vinculo from public.legado_consultoras where codcli between $1 and $2 order by codcli`,
      [base, base + 99])) as { codcli: number; party_id: string | null; vinculo: string | null }[];
    expect(l.find((x) => x.codcli === cod(1))).toMatchObject({ party_id: partyA, vinculo: "cpf" });
    expect(l.find((x) => x.codcli === cod(2))).toMatchObject({ party_id: partyB, vinculo: "codigo" });
    expect(l.find((x) => x.codcli === cod(3))!.party_id).toBeNull();
    expect(l.find((x) => x.codcli === cod(4))!.party_id).toBeNull();
    expect((await um<{ n: number }>(`select count(*)::int n from public.parties`)).n).toBe(pessoasAntes);
    // o código antigo da Ana passa a ficar registrado no cadastro dela
    expect((await um<{ p: string }>(`select party_id p from public.party_codigos_legados where sistema='cliente' and codigo=$1`, [String(cod(1))])).p).toBe(partyA);
    // reexecutar não muda nada
    expect((await rpc(master, "legado_vincular", { _gravar_codigos: true })).erro).toBeNull();
    expect((await um<{ n: number }>(`select count(*)::int n from public.party_codigos_legados where codigo=$1`, [String(cod(1))])).n).toBe(1);
  });

  test("vínculo manual só pelo Master, auditado", async () => {
    expect((await rpc(financeiro, "legado_consultora_vincular", { _codcli: cod(4), _party: partyB })).ok).toBe(false);
    const r = await rpc(master, "legado_consultora_vincular", { _codcli: cod(4), _party: partyB });
    expect(r.erro).toBeNull();
    expect((await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='legado.vinculo_manual' and entity_id=$1`, [String(cod(4))])).n).toBe(1);
    await rpc(master, "legado_consultora_vincular", { _codcli: cod(4), _party: null });
    expect((await um<{ p: string | null }>(`select party_id p from public.legado_consultoras where codcli=$1`, [cod(4)])).p).toBeNull();
  });

  test("pendências mostram quem tem maleta e não tem cadastro, com CPF mascarado", async () => {
    const r = await rpc<{ codcli: number; cpf_mascarado: string | null }[]>(master, "legado_pendencias_vinculo", { _busca: null, _limite: 500 });
    expect(r.erro).toBeNull();
    expect(JSON.stringify(r.dados)).not.toContain(cpfDuplo);
  });
});

describe("3. acesso", () => {
  test("ninguém lê as tabelas direto", async () => {
    for (const c of [master, consA, rep]) expect((await ler(c, `select * from public.legado_maletas limit 1`)).ok).toBe(false);
  });

  test("consultora e representante não leem o histórico de outra pessoa nem a rede", async () => {
    for (const c of [consA, rep]) {
      expect((await rpc(c, "legado_consultora_historico", { _party: partyB })).ok).toBe(false);
      expect((await rpc(c, "legado_rede_ranking", { _agrupar: "praca" })).ok).toBe(false);
      expect((await rpc(c, "legado_remessas_lista", {})).ok).toBe(false);
      expect((await rpc(c, "montagem_sugestao", { _party: partyA, _total: 50 })).ok).toBe(false);
    }
  });
});

describe("4. app da consultora", () => {
  test("Ana vê só o próprio histórico", async () => {
    const r = await rpc<{ vinculada: boolean; resumo: Record<string, number>; categorias: { categoria: string }[]; maletas: Record<string, unknown>[] }>(
      consA, "consultora_meu_historico");
    expect(r.erro).toBeNull();
    expect(r.dados.vinculada).toBe(true);
    expect(r.dados.resumo["maletas"]).toBe(2);           // inclui a aberta
    expect(r.dados.resumo["maletas_fechadas"]).toBe(1);
    expect(r.dados.resumo["pecas_vendidas"]).toBe(10);
    expect(r.dados.categorias[0]!.categoria).toBe("BRINCO");
    expect(JSON.stringify(r.dados)).not.toContain(String(cod(2)));
    expect(r.dados.maletas.every((m) => !("codcli" in m))).toBe(true);
    // maleta aberta não aparece como "tudo vendido"
    const aberta = r.dados.maletas.find((m) => m["fechamento"] === null)!;
    expect(aberta["pecas_vendidas"]).toBeNull();
    expect(aberta["valor_vendido_cents"]).toBeNull();
  });
});

describe("5. cockpit, rede e montagem", () => {
  test("ficha da consultora para a equipe", async () => {
    const r = await rpc<{ vinculada: boolean; resumo: Record<string, number>; produtos_top: { produto: number; quantidade: number }[] }>(
      financeiro, "legado_consultora_historico", { _party: partyA });
    expect(r.erro).toBeNull();
    expect(r.dados.resumo["valor_vendido_cents"]).toBe(50000);
    expect(r.dados.resumo["giro_pct"]).toBe(16.7);
    expect(r.dados.produtos_top[0]).toMatchObject({ produto: cod(51), quantidade: 8 });
  });

  test("remessas e ranking da praça", async () => {
    const l = await rpc<{ itens: { numero: number; maletas: number; pecas_vendidas: number }[] }>(estoque, "legado_remessas_lista",
      { _praca: base, _limite: 10 });
    expect(l.erro).toBeNull();
    expect(l.dados.itens.find((x) => x.numero === REM)).toMatchObject({ maletas: 2, pecas_vendidas: 13 });
    const d = await rpc<{ maletas: unknown[] }>(estoque, "legado_remessa_detalhe", { _numero: REM });
    expect(d.dados.maletas.length).toBe(2);
    const k = await rpc<{ chave: string; pecas_vendidas: number; consultoras: number }[]>(master, "legado_rede_ranking",
      { _agrupar: "praca", _praca: base });
    expect(k.dados[0]).toMatchObject({ chave: String(base), pecas_vendidas: 13, consultoras: 2 });
    const c = await rpc<{ chave: string; pecas_vendidas: number }[]>(master, "legado_rede_ranking", { _agrupar: "categoria", _praca: base });
    expect(c.dados.find((x) => x.chave === "BRINCO")!.pecas_vendidas).toBe(9);
  });

  test("montagem: soma exatamente o total e puxa para o que ela vende", async () => {
    const r = await rpc<{ total_pecas: number; confianca: string; categorias: { categoria: string; pecas_sugeridas: number }[] }>(
      estoque, "montagem_sugestao", { _party: partyA, _total: 77 });
    expect(r.erro).toBeNull();
    expect(r.dados.categorias.reduce((t, c) => t + c.pecas_sugeridas, 0)).toBe(77);
    expect(r.dados.categorias[0]!.categoria).toBe("BRINCO");
    // consultora sem histórico recebe a mistura da referência, também somando o total
    const n = await rpc<{ confianca: string; categorias: { pecas_sugeridas: number }[] }>(estoque, "montagem_sugestao", { _party: rep.partyId, _total: 40 });
    expect(n.dados.confianca).toBe("baixa");
    expect(n.dados.categorias.reduce((t, c) => t + c.pecas_sugeridas, 0)).toBe(40);
  });
});

describe("6. numeração de remessa", () => {
  test("continua depois do maior número do JFLEX e recusa número já usado lá", async () => {
    const praca = await um<{ id: string }>(`insert into public.cob_pracas (codigo, nome) values ($1, $2) on conflict (codigo) do update set nome=excluded.nome returning id`,
      [base, `ISO ${base}`]);
    const resumo = await rpc<{ numeracao: { proxima_remessa_lardan: number } }>(master, "legado_resumo");
    expect(resumo.dados.numeracao.proxima_remessa_lardan).toBeGreaterThan(REM + 1); // REM é maior que qualquer remessa real
    const ruim = await rpc(master, "remessa_criar", { _praca: praca.id, _numero: REM });
    expect(ruim.ok).toBe(false);
    expect(String(ruim.erro)).toContain("JFLEX");
  });
});

describe("7. operação intocada", () => {
  test("nenhuma pessoa, maleta, estoque, pedido, título ou nota fiscal criados", async () => {
    expect(await contagem()).toEqual(antes);
  });

  test("roteiro fiscal observado: só leitura, para financeiro", async () => {
    const r = await rpc<{ operacao: string; cfop_interno: string }[]>(financeiro, "fiscal_roteiro_observado");
    expect(r.erro).toBeNull();
    expect(r.dados.map((x) => `${x.operacao}:${x.cfop_interno}`)).toEqual(["remessa:5917", "devolucao:1918", "venda:5114", "perda:5927"]);
    expect((await rpc(consA, "fiscal_roteiro_observado")).ok).toBe(false);
  });
});
