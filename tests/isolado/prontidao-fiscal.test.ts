/**
 * Revisão 16/10/2026 (noite) — migração 0099 e pacote pendente 11. Banco ISOLADO, dados sintéticos.
 *  1. Saldo da parcela igual no portal do representante (desconto não aparece como dívida).
 *  2. Cartão Asaas: crédito nunca antecipado; varredura recupera o crédito quando o aviso não chega.
 *  3. Foto de divergência só de peça da maleta.
 *  4. Faixas de comissão: marketing lê, só Master/Diretoria alteram.
 *  5. Interruptor fiscal: só o Master, com provedor/emissor/ambiente, e auditado.
 *  6. Chave de acesso da NF-e validada (DV, CNPJ, modelo).
 *  7. Relatório de prontidão fiscal: só leitura, só contagens, sem acesso para consultora.
 *  8. Retorno do provedor só pelo servidor; autorização exige chave do emissor.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarVariante, ler, rpc, VISITANTE, type Conta } from "./base";

const DIA = "2024-02-22"; // data exclusiva desta bateria
let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const oficial = async <T>(sql: string, p: unknown[] = []) =>
  (await adm.begin(async (tx) => {
    await tx.unsafe(`select set_config('lardann.asaas_link','on',true)`);
    return (await tx.unsafe(sql, p)) as T[];
  }))[0]!;
const partyDe = async (c: Conta) => (await um<{ p: string }>(`select party_id p from public.profiles where id=$1`, [c.uid])).p;
const hojeSP = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const somarDias = (d: string, k: number) => new Date(Date.parse(d) + k * 86_400_000).toISOString().slice(0, 10);

async function comoServico<T = unknown>(sql: string, p: unknown[] = []) {
  const c = await adm.reserve();
  try {
    await c.unsafe(`set role service_role`);
    await c.unsafe(`select set_config('lardan.test_role','service_role',false), set_config('lardan.test_uid','',false)`);
    const r = (await c.unsafe(sql, p)) as { r: T }[];
    return { dados: r[0]!.r, erro: null as string | null };
  } catch (e) {
    return { dados: null as T, erro: (e as Error).message };
  } finally {
    try { await c.unsafe(`reset role`); await c.unsafe(`select set_config('lardan.test_role','',false)`); } catch { /* */ }
    c.release();
  }
}

/** CPF válido a partir de 9 dígitos aleatórios. */
function cpf() {
  const d = String(100000000 + Math.floor(Math.random() * 899999999)).slice(0, 9).split("").map(Number);
  const dv = (arr: number[]) => { const r = (arr.reduce((t, x, i) => t + x * (arr.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(d);
  return [...d, d1, dv([...d, d1])].join("");
}

/** Chave de acesso NF-e com DV correto. */
function chaveNfe(cnpj: string, numero: number, modelo = "55") {
  const base = `41${"2610"}${cnpj}${modelo}${"001"}${String(numero).padStart(9, "0")}1${"12345678"}`;
  let soma = 0, peso = 2;
  for (let i = base.length - 1; i >= 0; i--) { soma += Number(base[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const resto = soma % 11;
  return base + (resto < 2 ? 0 : 11 - resto);
}

let master: Conta, diretoria: Conta, marketing: Conta, financeiro: Conta, rep: Conta, consultora: Conta;
let repParty = "", plano = "";

beforeAll(async () => {
  master = await criarConta({ nome: "master-pf", papeis: ["master"], comParty: true });
  diretoria = await criarConta({ nome: "dir-pf", papeis: ["diretoria"], comParty: true });
  marketing = await criarConta({ nome: "mkt-pf", papeis: ["marketing"], comParty: true });
  financeiro = await criarConta({ nome: "fin-pf", papeis: ["financeiro"], comParty: true });
  rep = await criarConta({ nome: "rep-pf", papeis: ["representante"], comParty: true });
  consultora = await criarConta({ nome: "cons-pf", papeis: ["consultora"], comParty: true });
  repParty = await partyDe(rep);
  plano = (await um<{ id: string }>(`insert into public.chart_of_accounts (codigo, nome, natureza) values ($1,$1,'receita') returning id`, [`ISO-PF-${marca()}`])).id;
});

async function titulo(party: string, valor: number, emp: string) {
  const r = await rpc<string>(master, "fin_title_create", { _payload: { direction: "receivable", party_id: party, descricao: `ISO PF ${marca()}`,
    valor_cents: valor, emissao: DIA, competencia: DIA, business_entity_id: emp, chart_account_id: plano, parcelas: [{ vencimento: DIA, valor_cents: valor }] } });
  if (!r.ok) throw new Error(r.erro!);
  return { titulo: r.dados, inst: (await um<{ id: string }>(`select id from public.financial_installments where title_id=$1`, [r.dados])).id };
}

describe("1. saldo igual no portal do representante", () => {
  test("parcela quitada com desconto não aparece como dívida", async () => {
    const emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name) values ($1) returning id`, [`ISO Emp ${marca()}`])).id;
    const conta = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'conta_corrente') returning id`, [`ISO Banco ${marca()}`])).id;
    const cons = (await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO Cons ${marca()}`])).id;
    await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id) values ($1,$2)`, [cons, repParty]);
    const t = await titulo(cons, 10000, emp);
    const b = await rpc(master, "fin_settlement_create_ajustes", { _payload: {
      direction: "receivable", financial_account_id: conta, data: DIA, valor_cents: 7000, desconto_cents: 3000,
      idempotency_key: `iso-pf-${marca()}`, alocacoes: [{ installment_id: t.inst, valor_cents: 7000 }] } });
    expect(b.erro).toBeNull();
    expect(Number((await um<{ s: string }>(`select public.fin_installment_saldo($1) s`, [t.inst])).s)).toBe(0);

    const ficha = await rpc<{ aberto_cents: number; parcelas: unknown[] }>(rep, "rep_consultora_ficha_rep", { _party: cons, _rep: repParty });
    expect(ficha.erro).toBeNull();
    expect(Number(ficha.dados.aberto_cents)).toBe(0);
    expect(ficha.dados.parcelas).toEqual([]);
    // rotina interna do portal (sem GRANT para o navegador): conferida direto
    const abertos = await adm.unsafe(`select * from public.rep_portal_abertos($1)`, [repParty]);
    expect(JSON.stringify(abertos)).not.toContain(t.inst);
  });
});

describe("2. cartão Asaas", () => {
  async function cenario() {
    const fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`ISO Asaas ${marca()}`])).id;
    const cartao = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'compensacao') returning id`, [`ISO Cartão ${marca()}`])).id;
    const emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name) values ($1) returning id`, [`ISO Emp ${marca()}`])).id;
    const acc = (await um<{ id: string }>(
      `insert into public.asaas_accounts (label, environment, financial_account_id, owner_entity_id, is_active, conta_cartao_receber_id) values ($1,'sandbox',$2,$3,true,$4) returning id`,
      [`ISO ${marca()}`, fin, emp, cartao])).id;
    const p = (await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO P ${marca()}`])).id;
    const t = await titulo(p, 10000, emp);
    const ext = `pay_${marca()}`;
    const ch = (await oficial<{ id: string }>(
      `insert into public.asaas_charges (account_id, external_id, value_cents, due_date, billing_type, external_status, installment_id, title_id, party_id)
       values ($1,$2,10000,$3,'CREDIT_CARD','PENDING',$4,$5,$6) returning id`, [acc, ext, DIA, t.inst, t.titulo, p])).id;
    await oficial(`update public.asaas_charges set external_status='CONFIRMED', received_cents=10000, net_value_cents=9500, payment_date=$2 where id=$1 returning id`, [ch, DIA]);
    const r = await comoServico<{ baixa: boolean; conta: string }>(`select public.asaas_baixa_automatica($1::uuid) r`, [ch]);
    expect(r.dados.baixa).toBe(true);
    expect(r.dados.conta).toBe(cartao);
    return { fin, cartao, acc, ext, ch };
  }
  const razao = async (acc: string) =>
    ((await adm.unsafe(`select valor_cents::int v from public.financial_account_movements where financial_account_id=$1 order by valor_cents desc`, [acc])) as { v: number }[]).map((x) => x.v);

  test("crédito com data futura não é antecipado", async () => {
    const c = await cenario();
    await oficial(`update public.asaas_charges set external_status='RECEIVED', credit_date=$2 where id=$1 returning id`, [c.ch, somarDias(hojeSP(), 10)]);
    const r = await comoServico<{ transferido: boolean; motivo: string }>(`select public.asaas_cartao_creditar($1::uuid) r`, [c.ch]);
    expect(r.erro).toBeNull();
    expect(r.dados.transferido).toBe(false);
    expect(r.dados.motivo).toBe("aguardando_credito");
    expect(await razao(c.fin)).toEqual([]);
  });

  test("aviso perdido: a varredura diária encontra e transfere uma única vez", async () => {
    const c = await cenario();
    await oficial(`update public.asaas_charges set external_status='RECEIVED', credit_date='2024-03-20' where id=$1 returning id`, [c.ch]);
    // prévia: aparece como crédito pendente, nada é gravado
    const previa = await comoServico<{ itens: { cobranca: string; credito_cartao?: boolean }[] }>(`select public.asaas_baixa_pendentes(false) r`);
    expect(previa.erro).toBeNull();
    expect(previa.dados.itens.some((i) => i.cobranca === c.ext && i.credito_cartao)).toBe(true);
    expect(await razao(c.fin)).toEqual([]);
    // execução dentro de transação desfeita no fim: não mexe nas outras baterias
    const conexao = await adm.reserve();
    try {
      await conexao.unsafe(`begin`);
      await conexao.unsafe(`set local role service_role`);
      await conexao.unsafe(`select set_config('lardan.test_role','service_role',true), set_config('lardan.test_uid','',true)`);
      const r1 = (await conexao.unsafe(`select public.asaas_baixa_pendentes(true) r`)) as { r: { creditos_cartao: number } }[];
      expect(r1[0]!.r.creditos_cartao).toBeGreaterThanOrEqual(1);
      const r2 = (await conexao.unsafe(`select public.asaas_baixa_pendentes(true) r`)) as { r: { itens: { cobranca: string }[] } }[];
      expect(r2[0]!.r.itens.some((i) => i.cobranca === c.ext)).toBe(false);
      const mov = (await conexao.unsafe(`select valor_cents::int v, data::text d from public.financial_account_movements where financial_account_id=$1`, [c.fin])) as { v: number; d: string }[];
      expect(mov).toEqual([{ v: 9500, d: "2024-03-20" }]);
    } finally {
      await conexao.unsafe(`rollback`);
      conexao.release();
    }
  });

  test("baixa estornada não entra na varredura do cartão (não trava a fila)", async () => {
    const c = await cenario();
    await oficial(`update public.asaas_charges set external_status='RECEIVED', credit_date='2024-03-21' where id=$1 returning id`, [c.ch]);
    const s = (await um<{ id: string }>(`select id from public.financial_settlements where idempotency_key=$1`, [`asaas:baixa:${c.acc}:${c.ext}`])).id;
    const est = await rpc(master, "fin_settlement_reverse", { _settlement: s, _motivo: "ISO estorno da baixa de cartão" });
    expect(est.erro).toBeNull();
    const previa = await comoServico<{ itens: { cobranca: string }[] }>(`select public.asaas_baixa_pendentes(false) r`);
    expect(previa.erro).toBeNull();
    expect(previa.dados.itens.some((i) => i.cobranca === c.ext)).toBe(false);
    expect(await razao(c.fin)).toEqual([]);
  });
});

describe("3. foto de divergência", () => {
  test("só de peça que está na maleta", async () => {
    const party = await partyDe(consultora);
    const naMaleta = await criarVariante("pf-div-a");
    const fora = await criarVariante("pf-div-b");
    const kit = (await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [`ISO PF ${marca()}`])).id;
    const ciclo = (await um<{ id: string }>(`insert into public.kit_cycles (kit_id, cycle_no, consultora_party_id) values ($1,1,$2) returning id`, [kit, party])).id;
    await adm.unsafe(`update public.kit_cycles set status='recebida' where id=$1`, [ciclo]);
    await adm.unsafe(`insert into public.kit_balances (cycle_id, variant_id, qty_allocated, qty_accepted) values ($1,$2,2,2)`, [ciclo, naMaleta]);
    const caminho = (v: string) => `${consultora.uid}/maleta-${ciclo}/${v}-${marca()}.jpg`;
    const ruim = await rpc(consultora, "kit_divergencia_foto_registrar", { _cycle: ciclo, _variant: fora, _path: caminho(fora) });
    expect(ruim.ok).toBe(false);
    expect(String(ruim.erro)).toContain("não faz parte");
    const bom = await rpc(consultora, "kit_divergencia_foto_registrar", { _cycle: ciclo, _variant: naMaleta, _path: caminho(naMaleta) });
    expect(bom.erro).toBeNull();
  });
});

describe("4. faixas de comissão", () => {
  test("marketing lê mas não altera; diretoria altera", async () => {
    const minimo = 900_000_000 + Math.floor(Math.random() * 1_000_000);
    const leitura = await ler(marketing, `select count(*)::int n from public.consultora_comissao_faixas`);
    expect(leitura.ok).toBe(true);
    const mk = await ler(marketing, `insert into public.consultora_comissao_faixas (min_vendido_cents, percentual, titulo) values ($1, 80, 'golpe') returning id`, [minimo]);
    expect(mk.ok).toBe(false);
    const dir = await ler(diretoria, `insert into public.consultora_comissao_faixas (min_vendido_cents, percentual, titulo) values ($1, 12, 'ISO') returning id`, [minimo]);
    expect(dir.erro).toBeNull();
    await adm.unsafe(`delete from public.consultora_comissao_faixas where min_vendido_cents=$1`, [minimo]);
  });
});

describe("5. interruptor fiscal", () => {
  const original = { emission_active: false, provider: null as string | null, environment: "nenhum", emitter_entity_id: null as string | null };
  beforeAll(async () => {
    Object.assign(original, await um(`select emission_active, provider, environment, emitter_entity_id from public.fiscal_settings`));
  });
  afterAll(async () => {
    await adm.unsafe(`update public.fiscal_settings set emission_active=$1, provider=$2, environment=$3, emitter_entity_id=$4`,
      [original.emission_active, original.provider, original.environment, original.emitter_entity_id]);
  });

  test("ninguém além do Master mexe; ligar exige provedor, emissor e ambiente; tudo auditado", async () => {
    // O beforeAll preserva a configuração original; afterAll a restaura.
    await adm.unsafe(`update public.fiscal_settings set emission_active=false, provider=null, environment='nenhum', emitter_entity_id=null where id`);
    const antes = (await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='fiscal.configuracao_alterada'`)).n;
    const fin = await ler(financeiro, `update public.fiscal_settings set emission_active=true where id returning id`);
    expect(fin.linhas.length).toBe(0); // sem permissão de escrita: nada muda
    const semProvedor = await ler(master, `update public.fiscal_settings set emission_active=true where id returning id`);
    expect(semProvedor.ok).toBe(false);
    expect(String(semProvedor.erro)).toContain("provedor");
    const emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name) values ($1) returning id`, [`ISO Emissor ${marca()}`])).id;
    const prep = await ler(master, `update public.fiscal_settings set provider='focus_nfe', environment='homologacao', emitter_entity_id=$1 where id returning id`, [emp]);
    expect(prep.erro).toBeNull();
    const liga = await ler(master, `update public.fiscal_settings set emission_active=true where id returning id`);
    expect(liga.erro).toBeNull();
    const troca = await ler(master, `update public.fiscal_settings set environment='producao' where id returning id`);
    expect(troca.ok).toBe(false);
    const desliga = await ler(master, `update public.fiscal_settings set emission_active=false where id returning id`);
    expect(desliga.erro).toBeNull();
    const depois = (await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='fiscal.configuracao_alterada'`)).n;
    expect(depois - antes).toBe(3);
  });
});

describe("6. chave de acesso", () => {
  const CNPJ = "43319208000180";
  test("DV, CNPJ do emissor e modelo", async () => {
    const boa = chaveNfe(CNPJ, 123);
    const ok = async (k: string, c: string | null, m = "55") => (await um<{ v: boolean }>(`select public.nfe_chave_valida($1,$2,$3) v`, [k, c, m])).v;
    expect(await ok(boa, CNPJ)).toBe(true);
    expect(await ok(boa, "43.319.208/0001-80")).toBe(true);
    expect(await ok(boa.slice(0, 43) + ((Number(boa[43]) + 1) % 10), CNPJ)).toBe(false);
    expect(await ok(boa, "11222333000181")).toBe(false);
    expect(await ok(boa, CNPJ, "65")).toBe(false);
    expect(await ok("123", CNPJ)).toBe(false);
  });
});

describe("7. prontidão fiscal", () => {
  type Pront = { pronto: boolean; bloqueios: string[]; consultoras: Record<string, number>; pecas: Record<string, number>; emissor: { definido: boolean } };
  test("consultora e visitante não acessam", async () => {
    expect((await rpc(consultora, "fiscal_prontidao")).ok).toBe(false);
    expect((await rpc(VISITANTE, "fiscal_prontidao")).ok).toBe(false);
  });

  test("conta cadastro completo, incompleto e peças sem NCM", async () => {
    const a = await rpc<Pront>(master, "fiscal_prontidao");
    expect(a.erro).toBeNull();
    expect(a.dados.pronto).toBe(false);
    expect(a.dados.bloqueios.length).toBeGreaterThan(0);

    await adm.unsafe(`insert into public.ibge_municipios (codigo_ibge, uf, nome) values ('4109807','PR','Ibiporã') on conflict do nothing`);
    const nova = async (doc: string, completo: boolean) => {
      const id = (await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status, doc) values ('pessoa',$1,$1,'ativo',$2) returning id`, [`ISO PF ${marca()}`, doc])).id;
      await adm.unsafe(`insert into public.consultant_profiles (party_id) values ($1)`, [id]);
      await adm.unsafe(`insert into public.party_addresses (party_id, street, street_number, district, city, uf, postal_code, is_primary) values ($1,'Rua A',$2,'Centro','Ibiporã','PR','86200-055',true)`,
        [id, completo ? "10" : null]);
      return id;
    };
    const completa = await nova(cpf(), true);
    await nova(cpf(), false);
    const variante = await criarVariante("pf-ncm");
    const kit = (await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [`ISO PF ${marca()}`])).id;
    const ciclo = (await um<{ id: string }>(`insert into public.kit_cycles (kit_id, cycle_no, consultora_party_id) values ($1,1,$2) returning id`, [kit, completa])).id;
    await adm.unsafe(`update public.kit_cycles set status='operacao' where id=$1`, [ciclo]);
    await adm.unsafe(`insert into public.kit_balances (cycle_id, variant_id, qty_allocated, qty_accepted) values ($1,$2,1,1)`, [ciclo, variante]);

    const b = await rpc<Pront>(master, "fiscal_prontidao");
    expect(b.erro).toBeNull();
    expect(b.dados.consultoras["total"]! - a.dados.consultoras["total"]!).toBe(2);
    expect(b.dados.consultoras["prontas"]! - a.dados.consultoras["prontas"]!).toBe(1);
    expect(b.dados.consultoras["sem_numero"]! - a.dados.consultoras["sem_numero"]!).toBe(1);
    expect(b.dados.pecas["sem_ncm"]! - a.dados.pecas["sem_ncm"]!).toBe(1);
    // só contagens: nenhum nome, documento ou endereço sai no relatório
    expect(JSON.stringify(b.dados)).not.toContain("ISO PF");
    expect(JSON.stringify(b.dados)).not.toContain("Rua A");
  });

  test("peça sem preço de referência em maleta ativa vira bloqueio", async () => {
    const party = (await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO SP ${marca()}`])).id;
    await adm.unsafe(`insert into public.consultant_profiles (party_id) values ($1)`, [party]);
    const variante = await criarVariante("pf-sem-preco", 0);
    const kit = (await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [`ISO SP ${marca()}`])).id;
    const ciclo = (await um<{ id: string }>(`insert into public.kit_cycles (kit_id, cycle_no, consultora_party_id) values ($1,1,$2) returning id`, [kit, party])).id;
    await adm.unsafe(`update public.kit_cycles set status='operacao' where id=$1`, [ciclo]);
    await adm.unsafe(`insert into public.kit_balances (cycle_id, variant_id, qty_allocated, qty_accepted) values ($1,$2,1,1)`, [ciclo, variante]);
    const r = await rpc<{ bloqueios: string[] }>(master, "fiscal_prontidao");
    expect(r.erro).toBeNull();
    expect(r.dados.bloqueios.some((b) => b.includes("sem preço de referência"))).toBe(true);
  });
});

describe("8. retorno do provedor só pelo servidor", () => {
  test("autorização exige chave do emissor; série e número saem da chave", async () => {
    const CNPJ = "43319208000180";
    const c = await adm.reserve();
    try {
      await c.unsafe(`begin`);
      // o CNPJ vale pela fotografia do emissor gravada no documento
      const emp = ((await c.unsafe(`insert into public.business_entities (legal_name) values ($1) returning id`, [`ISO Emissor ${marca()}`])) as { id: string }[])[0]!.id;
      await c.unsafe(`update public.fiscal_settings set emission_active=true, provider='focus_nfe', environment='homologacao', emitter_entity_id=$1`, [emp]);
      const doc = ((await c.unsafe(
        `insert into public.fiscal_documents (kind, status, emitter_entity_id, emitter_snapshot, environment) values ('remessa','na_fila',$1, jsonb_build_object('tax_id',$2::text),'homologacao') returning id`,
        [emp, CNPJ])) as { id: string }[])[0]!.id;
      await c.unsafe(`set local role service_role`);
      await c.unsafe(`select set_config('lardan.test_role','service_role',true), set_config('lardan.test_uid','',true)`);
      await c.unsafe(`savepoint s1`);
      let erro = "";
      try { await c.unsafe(`select public.fiscal_doc_autorizar($1, $2, '141260000000001', null, null)`, [doc, chaveNfe("11222333000181", 5)]); }
      catch (e) { erro = (e as Error).message; }
      await c.unsafe(`rollback to savepoint s1`);
      expect(erro).toContain("Chave de acesso inválida");
      const r = (await c.unsafe(`select public.fiscal_doc_autorizar($1, $2, '141260000000001', null, null) r`, [doc, chaveNfe(CNPJ, 4321)])) as { r: { status: string } }[];
      expect(r[0]!.r.status).toBe("autorizado");
      const d = ((await c.unsafe(`select series, number, model from public.fiscal_documents where id=$1`, [doc])) as Record<string, string>[])[0]!;
      expect(d).toEqual({ series: "1", number: "4321", model: "55" });
      const repetido = (await c.unsafe(`select public.fiscal_doc_autorizar($1, $2, '141260000000001', null, null) r`, [doc, chaveNfe(CNPJ, 4321)])) as { r: { repetido: boolean } }[];
      expect(repetido[0]!.r.repetido).toBe(true);
    } finally {
      await c.unsafe(`rollback`);
      c.release();
    }
  });

  test("pessoa logada não registra rejeição nem cancelamento homologado", async () => {
    const fake = "00000000-0000-0000-0000-000000000000";
    expect((await rpc(master, "fiscal_doc_rejeitar", { _doc: fake, _codigo: "999", _motivo: "x" })).ok).toBe(false);
    expect((await rpc(master, "fiscal_doc_cancelar_registrar", { _doc: fake, _protocolo: "x" })).ok).toBe(false);
    const r = await rpc(master, "fiscal_doc_rejeitar", { _doc: fake, _codigo: "999", _motivo: "x" });
    expect(String(r.erro)).toMatch(/permission denied|servidor/);
  });

  test("emissor sem CNPJ não autoriza nota", async () => {
    const c = await adm.reserve();
    try {
      await c.unsafe(`begin`);
      const emp = ((await c.unsafe(`insert into public.business_entities (legal_name) values ($1) returning id`, [`ISO Emissor ${marca()}`])) as { id: string }[])[0]!.id;
      await c.unsafe(`update public.fiscal_settings set emission_active=true, provider='focus_nfe', environment='homologacao', emitter_entity_id=$1`, [emp]);
      const doc = ((await c.unsafe(`insert into public.fiscal_documents (kind, status, emitter_entity_id, environment) values ('remessa','na_fila',$1,'homologacao') returning id`, [emp])) as { id: string }[])[0]!.id;
      await c.unsafe(`set local role service_role`);
      await c.unsafe(`select set_config('lardan.test_role','service_role',true), set_config('lardan.test_uid','',true)`);
      let erro = "";
      try { await c.unsafe(`select public.fiscal_doc_autorizar($1, $2, '141260000000001', null, null)`, [doc, chaveNfe("43319208000180", 9)]); }
      catch (e) { erro = (e as Error).message; }
      expect(erro).toContain("Emissor sem CNPJ");
    } finally {
      await c.unsafe(`rollback`);
      c.release();
    }
  });
});

describe("9. visitante sem login", () => {
  test("não executa rotinas internas de cobrança, PDV, catálogo e maletas", async () => {
    const r = (await adm.unsafe(
      `select p.proname n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
        where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
          and pg_get_function_result(p.oid) <> 'trigger'
          and p.proname = any (array['cob_carteira','cob_pode','fin_projecao_diaria','kit_consultora_doc','pdv_gestao','catalog_overview','remessa_parametros_salvar'])`,
    )) as { n: string }[];
    expect(r).toEqual([]);
    const publico = (await adm.unsafe(
      `select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
        where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
          and p.proname = any (array['public_catalog_browse','showcase_public','submit_candidatura','pdv_unidade_acesso'])`,
    )) as { n: number }[];
    expect(publico[0]!.n).toBe(4);
  });
});
