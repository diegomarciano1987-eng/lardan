/**
 * 0306 (Diego, 13/11/2026) — banco ISOLADO, dados sintéticos.
 * 1) Segunda maleta que o representante já deixou com a consultora: entrega oficial registrada; ela confirma o
 *    recebimento e aceita peça a peça no app, igual à primeira (nada de aceite inventado).
 * 2) Caso Cacilda: o pagamento de um boleto Asaas nunca é conciliado na parcela de outro boleto.
 * 3) Cadastro da cliente no Lardan pede o espelho no Asaas (fila + resultado auditado).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, type Conta } from "./base";

let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const oficial = async <T>(sql: string, p: unknown[] = []) =>
  (await adm.begin(async (tx) => {
    await tx.unsafe(`select set_config('lardann.asaas_link','on',true)`);
    return (await tx.unsafe(sql, p)) as T[];
  }))[0]!;
async function servico<T = unknown>(sql: string, p: unknown[] = []): Promise<{ dados: T; erro: string | null }> {
  const c = await adm.reserve();
  try {
    await c.unsafe(`set role service_role`);
    await c.unsafe(`select set_config('lardan.test_role','service_role',false), set_config('lardan.test_uid','',false), set_config('request.jwt.claims','',false)`);
    const r = (await c.unsafe(`select (${sql}) as r`, p)) as { r: T }[];
    return { dados: r[0]!.r, erro: null };
  } catch (e) {
    return { dados: null as T, erro: (e as Error).message };
  } finally {
    try { await c.unsafe(`reset role`); await c.unsafe(`select set_config('lardan.test_role','',false)`); } catch { /* */ }
    c.release();
  }
}
async function ok<T>(conta: Conta, fn: string, args: Record<string, unknown>) {
  const r = await rpc<T>(conta, fn, args);
  if (r.erro) throw new Error(`${fn}: ${r.erro}`);
  return r.dados;
}

let master: Conta, rep: Conta, juce: Conta, outra: Conta;
let deposito = "", vA = "", praca = "", remessa = "";
const transitoPara = async (cycle: string, para: string) =>
  um<{ id: string } | undefined>(`select id from public.kit_transfers where cycle_id=$1 and status='transito' and to_party_id=$2 order by seq desc limit 1`, [cycle, para]);
async function conferida(c: Conta | null) {
  const id = (await ok<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: c?.partyId ?? juce.partyId })).cycle_id;
  await ok(master, "kit_item_upsert", { _cycle: id, _variant: vA, _qty: 3 });
  await ok(master, "kit_conferir", { _cycle: id, _note: null });
  return id;
}
const pendentesDela = async (c: Conta) => ok<{ cycle_id: string }[]>(c, "consultora_aceites_pendentes", {});
const ciclo = (id: string) => um<{ status: string; custodian_party_id: string | null; consultora_party_id: string | null }>(
  `select status::text, custodian_party_id, consultora_party_id from public.kit_cycles where id=$1`, [id]);

beforeAll(async () => {
  const b = Math.floor(Math.random() * 1e6);
  master = await criarConta({ nome: `p306-master-${b}`, papeis: ["master"], comParty: true });
  rep = await criarConta({ nome: `p306-rep-${b}`, papeis: ["representante"], comParty: true });
  juce = await criarConta({ nome: `p306-juce-${b}`, papeis: ["consultora"], comParty: true });
  outra = await criarConta({ nome: `p306-outra-${b}`, papeis: ["consultora"], comParty: true });
  deposito = await criarDeposito(`p306-${marca()}`);
  vA = await criarVariante(`p306-a-${marca()}`, 10000);
  await porEstoque(vA, deposito, 60);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`P306 ${marca()}`])).linhas[0]!.id;
  for (const c of [juce, outra]) {
    await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
                      on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id`,
      [c.partyId, rep.partyId, praca]);
  }
  remessa = (await ok<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito,
    _data_acerto: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10) })).id;
});

describe("1 · segunda maleta já com ela segue o mesmo aceite da primeira", () => {
  let primeira = "", segunda = "", terceira = "";
  beforeAll(async () => {
    primeira = await conferida(juce);
    segunda = await conferida(outra); // montada para outra; a equipe transfere como 2ª maleta da Jucélia
    terceira = await conferida(outra);
    await ok(master, "remessa_expedir_representante", { _remessa: remessa });
    for (const m of [primeira, segunda, terceira]) await ok(rep, "kit_transfer_confirm", { _transfer: (await transitoPara(m, rep.partyId!))!.id, _payload: {} });
    // primeira maleta: entregue, confirmada e aceita
    await ok(rep, "kit_transfer_forward", { _cycle: primeira, _payload: { note: "Entregue em mãos" } });
    await ok(juce, "kit_transfer_confirm", { _transfer: (await transitoPara(primeira, juce.partyId!))!.id, _payload: {} });
    await ok(juce, "kit_aceitar", { _cycle: primeira, _itens: [{ variant_id: vA, qty_accepted: 3, qty_divergent: 0 }], _idempotency_key: `p306-${primeira}` });
  });

  test("só transferir (como foi na MAL-00446): fica com o representante e não pede aceite — o problema", async () => {
    await ok(master, "remessa_maleta_segunda", { _cycle: segunda, _consultora: juce.partyId, _motivo: "reforçar venda de fim de ano" });
    const c = await ciclo(segunda);
    expect(c).toMatchObject({ status: "transito", custodian_party_id: rep.partyId, consultora_party_id: juce.partyId });
    expect((await pendentesDela(juce)).map((x) => x.cycle_id)).not.toContain(segunda);
  });

  test("consultora e representante não registram a entrega pela equipe; motivo é obrigatório", async () => {
    expect((await rpc(juce, "maleta_entregue_em_maos", { _cycle: segunda, _motivo: "já está comigo" })).erro).toContain("equipe");
    expect((await rpc(rep, "maleta_entregue_em_maos", { _cycle: segunda, _motivo: "já está com ela" })).erro).toContain("equipe");
    expect((await rpc(master, "maleta_entregue_em_maos", { _cycle: segunda, _motivo: "ok" })).erro).toContain("motivo");
  });

  test("conserto: equipe registra que já está com ela → app dela pede o recebimento; nada aceito por ela", async () => {
    const r = await ok<{ transfer_id: string }>(master, "maleta_entregue_em_maos", { _cycle: segunda, _motivo: "representante deixou com ela em 12/11" });
    expect(r.transfer_id).toBeTruthy();
    expect((await pendentesDela(juce)).map((x) => x.cycle_id)).toContain(segunda);
    expect(Number((await um<{ c: string }>(`select count(*) c from public.kit_acceptances where cycle_id=$1`, [segunda])).c)).toBe(0);
    const ev = await um<{ c: string }>(`select count(*) c from public.kit_events where cycle_id=$1 and kind='entrega.em_maos_registrada'`, [segunda]);
    expect(Number(ev.c)).toBe(1);
    // repetir não cria segunda entrega
    expect((await rpc(master, "maleta_entregue_em_maos", { _cycle: segunda, _motivo: "de novo por engano" })).erro).toBeTruthy();
  });

  test("ela confirma o recebimento e aceita peça a peça: mesma sequência da primeira", async () => {
    await ok(juce, "kit_transfer_confirm", { _transfer: (await transitoPara(segunda, juce.partyId!))!.id, _payload: {} });
    expect((await ciclo(segunda)).status).toBe("recebida");
    expect((await pendentesDela(juce)).map((x) => x.cycle_id)).toContain(segunda); // ainda trava até aceitar
    await ok(juce, "kit_aceitar", { _cycle: segunda, _itens: [{ variant_id: vA, qty_accepted: 3, qty_divergent: 0 }], _idempotency_key: `p306-${segunda}` });
    expect((await ciclo(segunda)).status).toBe("operacao");
    expect((await pendentesDela(juce)).map((x) => x.cycle_id)).not.toContain(segunda);
    const ordem = (await adm.unsafe(`select kind from public.kit_events where cycle_id=$1 and kind in ('entrega.encaminhada','entrega.confirmada','maleta.aceita') order by created_at, id`, [segunda])) as { kind: string }[];
    expect(ordem.map((x) => x.kind).slice(-3)).toEqual(["entrega.encaminhada", "entrega.confirmada", "maleta.aceita"]);
  });

  test("daqui pra frente: transferir + 'já está com ela' numa transação só", async () => {
    const r = await ok<{ entrega_registrada: boolean }>(master, "remessa_maleta_transferir_entregue",
      { _cycle: terceira, _consultora: juce.partyId, _motivo: "terceira para teste do fluxo", _segunda: true });
    expect(r.entrega_registrada).toBe(true);
    expect((await pendentesDela(juce)).map((x) => x.cycle_id)).toContain(terceira);
  });

  test("representante ainda não confirmou que recebeu: recusa e não transfere nada (tudo ou nada)", async () => {
    const quarta = await conferida(outra);
    await ok(master, "remessa_expedir_representante", { _remessa: remessa });
    const antes = await ciclo(quarta);
    const r = await rpc(master, "remessa_maleta_transferir_entregue", { _cycle: quarta, _consultora: juce.partyId, _motivo: "teste sem confirmação", _segunda: true });
    expect(r.erro).toContain("representante ainda não confirmou");
    expect((await ciclo(quarta)).consultora_party_id).toBe(antes.consultora_party_id);
  });
});

describe("2 · pagamento do boleto só na parcela dele (caso Cacilda)", () => {
  let fin = "", emp = "", acc = "", file = "", imp = "", party = "";
  let linhaNo = 0;
  async function titulo(valor: number, venc: string) {
    const t = await ok<string>(master, "fin_title_create", { _payload: {
      direction: "receivable", party_id: party, descricao: "ISO 0306", valor_cents: valor, emissao: "2026-08-25", competencia: "2026-08-25",
      business_entity_id: emp, origem: "importacao", sistema_origem: "fiado_historico", id_externo: `iso0306:${marca()}`,
      parcelas: [{ vencimento: venc, valor_cents: valor }] } });
    return (await um<{ id: string }>(`select id from public.financial_installments where title_id=$1`, [t])).id;
  }
  async function boleto(valor: number, venc: string, inst: string | null, st = "RECEIVED") {
    const ext = `pay_${marca()}`;
    await oficial(`insert into public.asaas_charges (account_id, external_id, value_cents, received_cents, due_date, payment_date, billing_type, external_status, party_id, installment_id, title_id, raw)
       values ($1,$2,$3,$3,$4,$4,'BOLETO',$5,$6,$7,(select title_id from public.financial_installments where id=$7),'{}'::jsonb) returning id`, [acc, ext, valor, venc, st, party, inst]);
    return ext;
  }
  async function linha(valor: number, pay: string) {
    return (await um<{ id: string }>(
      `insert into public.financial_statement_lines (financial_account_id, file_id, import_id, line_no, data, valor_cents, kind, historico, documento, bank_id, raw, status)
       values ($1,$2,$3,$4,'2026-10-02',$5,'entrada','Cobrança recebida',$6,$7,$8::text::jsonb,'pendente') returning id`,
      [fin, file, imp, ++linhaNo, valor, pay, `bk_${marca()}`, JSON.stringify({ paymentId: pay, type: "PAYMENT_RECEIVED" })])).id;
  }
  const conciliar = (line: string, inst: string, valor: number) =>
    rpc(master, "fin_reconcile", { _payload: { line_ids: [line], alocacoes: [{ installment_id: inst, valor_cents: valor }], idempotency_key: `iso0306-${marca()}` } });

  beforeAll(async () => {
    for (const u of [master]) await adm.unsafe(`insert into public.user_financial_access (user_id, nivel) values ($1,'completo') on conflict do nothing`, [u.uid]).catch(() => undefined);
    fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`ISO Asaas 0306 ${marca()}`])).id;
    emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`ISO Emp 0306 ${marca()}`])).id;
    acc = (await um<{ id: string }>(`insert into public.asaas_accounts (label, environment, financial_account_id, owner_entity_id, is_active) values ($1,'sandbox',$2,$3,true) returning id`, [`ISO 0306 ${marca()}`, fin, emp])).id;
    file = (await um<{ id: string }>(`insert into public.financial_statement_files (financial_account_id, storage_path, original_name, format, sha256) values ($1,$2,'ISO','csv',$2) returning id`, [fin, `iso-0306-${marca()}`])).id;
    imp = (await um<{ id: string }>(`insert into public.financial_statement_imports (file_id, financial_account_id) values ($1,$2) returning id`, [file, fin])).id;
    party = (await um<{ id: string }>(`insert into public.parties (kind, display_name, status) values ('pessoa',$1,'ativo') returning id`, [`ISO Cacilda ${marca()}`])).id;
  });

  test("boleto de R$ 50 sem parcela não entra na parcela 2 que tem o boleto dela (R$ 305,63)", async () => {
    const p2 = await titulo(30563, "2026-10-30");
    await boleto(30563, "2026-10-30", p2, "OVERDUE");
    const b50 = await boleto(5000, "2026-10-01", null);
    const l = await linha(5000, b50);
    const r = await conciliar(l, p2, 5000);
    expect(r.erro).toContain("outro boleto");
    expect(Number((await um<{ c: string }>(`select count(*) c from public.financial_allocations where installment_id=$1`, [p2])).c)).toBe(0);
  });

  test("boleto já ligado a uma parcela não entra em outra", async () => {
    const p1 = await titulo(5000, "2026-10-01");
    const p2 = await titulo(30563, "2026-10-30");
    const b = await boleto(5000, "2026-10-01", p1);
    const r = await conciliar(await linha(5000, b), p2, 5000);
    expect(r.erro).toContain("pertence ao título");
  });

  test("na parcela certa concilia normalmente; reemissão (boleto antigo excluído) também passa", async () => {
    const p1 = await titulo(5000, "2026-10-01");
    const b = await boleto(5000, "2026-10-01", p1);
    expect((await conciliar(await linha(5000, b), p1, 5000)).erro).toBeNull();
    const p3 = await titulo(21100, "2026-11-05");
    await boleto(21100, "2026-11-05", p3, "DELETED");
    const novo = await boleto(21100, "2026-10-05", null);
    expect((await conciliar(await linha(21100, novo), p3, 21100)).erro).toBeNull();
  });
});

describe("3 · cadastro do Lardan pede o espelho no Asaas", () => {
  let party = "", cust = "", acc = "";
  beforeAll(async () => {
    const fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`ISO Asaas cli ${marca()}`])).id;
    acc = (await um<{ id: string }>(`insert into public.asaas_accounts (label, environment, financial_account_id, is_active) values ($1,'sandbox',$2,true) returning id`, [`ISO cli ${marca()}`, fin])).id;
    party = (await um<{ id: string }>(`insert into public.parties (kind, display_name, doc_digits, status) values ('pessoa',$1,'06181892974','ativo') returning id`, [`ISO Espelho ${marca()}`])).id;
    cust = (await um<{ id: string }>(`insert into public.asaas_customers (account_id, external_id, name, party_id, match_status) values ($1,$2,'X',$3,'vinculado') returning id`, [acc, `cus_${marca()}`, party])).id;
  });
  const estado = async () => um<{ estado: string; motivo: string }>(`select estado, motivo from public.asaas_cliente_espelho where customer_id=$1`, [cust]);

  test("vincular a cliente e trocar o WhatsApp põem na fila; dados saem no formato do Asaas", async () => {
    expect((await estado()).estado).toBe("pendente");
    await adm.unsafe(`update public.asaas_cliente_espelho set estado='igual' where customer_id=$1`, [cust]);
    await adm.unsafe(`insert into public.contact_points (party_id, kind, value, value_norm, is_primary) values ($1,'whatsapp','+5542999121933','+5542999121933',true)`, [party]);
    await adm.unsafe(`insert into public.contact_points (party_id, kind, value, value_norm, is_primary) values ($1,'telefone','+554299121933','+554299121933',false)`, [party]);
    await adm.unsafe(`insert into public.party_addresses (party_id, postal_code, street, street_number, district, city, uf, is_primary) values ($1,'85200-000','Rua Guairaca','1481','Maristela','Pitanga','PR',true)`, [party]);
    expect(await estado()).toMatchObject({ estado: "pendente" });
    const d = await servico<Record<string, string | null>>(`public.asaas_cliente_dados_lardan($1::uuid)`, [party]);
    expect(d.erro).toBeNull();
    expect(d.dados).toMatchObject({ cpfCnpj: "06181892974", mobilePhone: "42999121933", phone: null, postalCode: "85200000", address: "Rua Guairaca", addressNumber: "1481", province: "Maristela" });
  });

  test("ninguém do app lê o cadastro cru pela rota do servidor", async () => {
    expect((await rpc(master, "asaas_cliente_dados_lardan", { _party: party })).erro).toBeTruthy();
    expect((await rpc(master, "asaas_cliente_espelho_proximos", { _worker: "x" })).erro).toBeTruthy();
  });

  test("rotina reserva, confere e grava; mudança no meio da conferência volta para a fila", async () => {
    const lote = await servico<{ customer_id: string }[]>(`public.asaas_cliente_espelho_proximos('w1', 50, $1::uuid)`, [party]);
    expect(lote.dados.map((x) => x.customer_id)).toContain(cust);
    await adm.unsafe(`update public.contact_points set value='+5542988887777', value_norm='+5542988887777' where party_id=$1 and kind='whatsapp'`, [party]);
    const r = await servico<string>(`public.asaas_cliente_espelho_registrar($1::uuid,'w1','atualizado','[]'::jsonb,'{"mobilePhone":{"de":"5542999121933","para":"42999121933"}}'::jsonb)`, [cust]);
    expect(r.dados).toBe("pendente");
    const log = await um<{ c: string }>(`select count(*) c from public.asaas_cliente_espelho_log where customer_id=$1`, [cust]);
    expect(Number(log.c)).toBe(1);
    const sit = await ok<{ vinculadas: number; ultimas: unknown[] }>(master, "asaas_cliente_espelho_situacao", { _party: party });
    expect(sit.vinculadas).toBe(1);
    expect(sit.ultimas).toHaveLength(1);
  });

  test("resposta de outro worker é ignorada", async () => {
    await servico(`public.asaas_cliente_espelho_proximos('w2', 50, $1::uuid)`, [party]);
    const r = await servico<string>(`public.asaas_cliente_espelho_registrar($1::uuid,'w-velho','igual','[]'::jsonb)`, [cust]);
    expect(r.dados).toBe("ignorado");
  });
});
