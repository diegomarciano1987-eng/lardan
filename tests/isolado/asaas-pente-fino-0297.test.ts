/**
 * 0297 — pente fino Asaas × Lardan (banco ISOLADO, dados sintéticos). Pedido do Diego em 12/11/2026:
 * 5) cobrança excluída ou alterada no Asaas gera alerta na hora (sem parcela fantasma);
 * 2) nada é apagado sozinho: a parcela fantasma só é cancelada por pessoa, com motivo, e pode ser desfeita;
 * Joyce) lançamento desfeito na Mesa não trava mais a mesma linha do extrato;
 * 1) comparação por pessoa do que está em aberto no Asaas e no Lardan.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

let master: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const oficial = async <T>(sql: string, p: unknown[] = []) =>
  (await adm.begin(async (tx) => {
    await tx.unsafe(`select set_config('lardann.asaas_link','on',true)`);
    return (await tx.unsafe(sql, p)) as T[];
  }))[0]!;

let fin: string, emp: string, acc: string, file: string, imp: string;
let linhaNo = 0;
async function pessoa(nome = `ISO 0297 ${marca()}`) {
  return (await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [nome])).id;
}
/** Conta a receber de uma parcela (como a importação do fiado faz). */
async function receber(party: string, valor: number, venc = "2026-10-10") {
  const t = await rpc<string>(master, "fin_title_create", { _payload: {
    direction: "receivable", party_id: party, descricao: "ISO 0297 fiado", valor_cents: valor, emissao: "2026-10-01", competencia: "2026-10-01",
    business_entity_id: emp, origem: "importacao", sistema_origem: "fiado_historico", id_externo: `iso0297:${marca()}`,
    parcelas: [{ vencimento: venc, valor_cents: valor }] } });
  if (!t.ok) throw new Error(t.erro!);
  const inst = (await um<{ id: string }>(`select id from public.financial_installments where title_id=$1`, [t.dados])).id;
  return { title: t.dados, inst };
}
/** Cobrança do Asaas já ligada à parcela do Lardan. */
async function cobranca(party: string, r: { title: string; inst: string } | null, valor: number, ref: string | null = null, status = "PENDING") {
  const ext = `pay_${marca()}`;
  const id = (await oficial<{ id: string }>(
    `insert into public.asaas_charges (account_id, external_id, customer_external_id, value_cents, due_date, billing_type, external_status, party_id, title_id, installment_id, raw, reconcile_status)
     values ($1,$2,'cus_iso',$3,'2026-10-10','BOLETO',$7,$4,$8,$5,$6::text::jsonb,$9) returning id`,
    [acc, ext, valor, party, r?.inst ?? null, JSON.stringify(ref ? { externalReference: ref } : {}), status, r?.title ?? null, r ? "vinculado" : "pendente"])).id;
  return { id, ext };
}
/** O que a busca da manhã grava quando o Asaas devolve a cobrança. */
const espelhar = (ext: string, extra: Record<string, unknown>) =>
  adm.unsafe(`select public.asaas_espelho_upsert($1, $2::text::jsonb)`, [acc, JSON.stringify([{
    id: ext, customer: "cus_iso", value: 300, dueDate: "2026-10-10", billingType: "BOLETO", status: "PENDING", ...extra }])]);
const alertas = (charge: string) =>
  adm.unsafe(`select tipo, resolvido_em is not null resolvido from public.asaas_divergencia_alertas where charge_id=$1 order by criado_em`, [charge]) as Promise<{ tipo: string; resolvido: boolean }[]>;

beforeAll(async () => {
  master = await criarConta({ nome: "master-0297", papeis: ["master"], comParty: true });
  fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`ISO Asaas 0297 ${marca()}`])).id;
  emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`ISO Emp 0297 ${marca()}`])).id;
  acc = (await um<{ id: string }>(
    `insert into public.asaas_accounts (label, environment, financial_account_id, owner_entity_id, is_active) values ($1,'sandbox',$2,$3,true) returning id`, [`ISO 0297 ${marca()}`, fin, emp])).id;
  file = (await um<{ id: string }>(`insert into public.financial_statement_files (financial_account_id, storage_path, original_name, format, sha256) values ($1,$2,'ISO','csv',$2) returning id`, [fin, `iso-0297-${marca()}`])).id;
  imp = (await um<{ id: string }>(`insert into public.financial_statement_imports (file_id, financial_account_id) values ($1,$2) returning id`, [file, fin])).id;
});

describe("0297 — alerta na hora", () => {
  test("cobrança excluída no Asaas (deleted=true) vira DELETED no espelho e abre alerta da parcela em aberto", async () => {
    const p = await pessoa();
    const r = await receber(p, 51316);
    const c = await cobranca(p, r, 51316);
    await espelhar(c.ext, { value: 513.16, deleted: true });
    expect((await um<{ s: string }>(`select external_status s from public.asaas_charges where id=$1`, [c.id])).s).toBe("DELETED");
    expect(await alertas(c.id)).toEqual([{ tipo: "cobranca_excluida", resolvido: false }]);
    // a busca seguinte repete a mesma informação: nenhum alerta em dobro
    await espelhar(c.ext, { value: 513.16, deleted: true });
    expect((await alertas(c.id)).length).toBe(1);
  });

  test("parcela que ainda tem outra cobrança viva no Asaas não é fantasma: sem alerta", async () => {
    const p = await pessoa();
    const r = await receber(p, 60000);
    const a = await cobranca(p, r, 30000);
    await cobranca(p, r, 30000);
    await espelhar(a.ext, { deleted: true });
    expect(await alertas(a.id)).toEqual([]);
  });

  test("valor alterado no Asaas abre alerta com antes e depois; cobrança restaurada fecha o alerta de exclusão", async () => {
    const p = await pessoa();
    const r = await receber(p, 30000);
    const c = await cobranca(p, r, 30000);
    await espelhar(c.ext, { value: 250 });
    const al = await um<{ antes: { valor_cents: number }; depois: { valor_cents: number } }>(
      `select antes, depois from public.asaas_divergencia_alertas where charge_id=$1 and tipo='valor_alterado'`, [c.id]);
    expect([Number(al.antes.valor_cents), Number(al.depois.valor_cents)]).toEqual([30000, 25000]);
    await espelhar(c.ext, { value: 250, deleted: true });
    await espelhar(c.ext, { value: 250, status: "PENDING" });
    const ex = (await alertas(c.id)).find((x) => x.tipo === "cobranca_excluida");
    expect(ex?.resolvido).toBe(true);
  });
});

describe("0297 — parcela fantasma só cancela por pessoa, com motivo e desfazer", () => {
  test("cancelar exige motivo; cancela o título, fecha o alerta e o desfazer reativa", async () => {
    const p = await pessoa();
    const r = await receber(p, 51316);
    const c = await cobranca(p, r, 51316);
    await espelhar(c.ext, { value: 513.16, deleted: true });
    expect((await rpc(master, "asaas_fantasma_cancelar", { _inst: r.inst, _motivo: "" })).erro).toContain("motivo");
    const ok = await rpc<{ fantasma_id: string; saldo_cents: number }>(master, "asaas_fantasma_cancelar", { _inst: r.inst, _motivo: "Excluída no Asaas e reparcelada" });
    expect(ok.erro).toBeNull();
    expect(Number(ok.dados.saldo_cents)).toBe(51316);
    expect((await um<{ s: string }>(`select status::text s from public.financial_titles where id=$1`, [r.title])).s).toBe("cancelado");
    expect((await alertas(c.id))[0]?.resolvido).toBe(true);
    const d = await rpc(master, "asaas_fantasma_desfazer", { _id: ok.dados.fantasma_id, _motivo: "Cliente ainda deve" });
    expect(d.erro).toBeNull();
    expect((await um<{ s: string }>(`select status::text s from public.financial_titles where id=$1`, [r.title])).s).toBe("ativo");
  });

  test("recusa quando a cobrança ainda está viva no Asaas", async () => {
    const p = await pessoa();
    const r = await receber(p, 10000);
    await cobranca(p, r, 10000);
    expect((await rpc(master, "asaas_fantasma_cancelar", { _inst: r.inst, _motivo: "teste de trava" })).erro).toContain("viva no Asaas");
  });

  test("cliente com processo judicial fica para decisão manual, salvo se a mesma fatura já foi renegociada em outra parcela", async () => {
    const p = await pessoa();
    await adm.unsafe(`insert into public.cob_judicial_processos (origem_chave, lote, party_id, nome, numero_processo) values ($2,gen_random_uuid(),$1,'ISO','0000001-00.2026.8.16.0001')`, [p, `iso0297:${marca()}`]);
    const r = await receber(p, 40883);
    const ref = `ISO${marca()}`;
    const c = await cobranca(p, r, 40883, ref);
    await espelhar(c.ext, { deleted: true, externalReference: ref });
    expect((await rpc(master, "asaas_fantasma_cancelar", { _inst: r.inst, _motivo: "teste judicial" })).erro).toContain("processo judicial");
    // a mesma fatura (mesma referência) reparcelada no Asaas e já ligada a outra parcela do Lardan = dívida em dobro
    const nova = await receber(p, 30159);
    await cobranca(p, nova, 30159, ref);
    const ok = await rpc<{ renegociada: boolean }>(master, "asaas_fantasma_cancelar", { _inst: r.inst, _motivo: "Reparcelada em 3x no Asaas" });
    expect(ok.erro).toBeNull();
    expect(ok.dados.renegociada).toBe(true);
  });
});

describe("0297 — Mesa e comparação", () => {
  test("lançamento desfeito (título cancelado) não trava novo lançamento da mesma linha", async () => {
    const favorecido = await pessoa();
    const l = (await um<{ id: string }>(
      `insert into public.financial_statement_lines (financial_account_id, file_id, import_id, line_no, data, valor_cents, kind, historico, documento, bank_id, raw, status)
       values ($1,$2,$3,$4,'2026-11-10',199,'saida','ISO tarifa','',$5,'{}'::jsonb,'pendente') returning id`,
      [fin, file, imp, ++linhaNo, `bk_${marca()}`])).id;
    const payload = { line_id: l, party_id: favorecido, descricao: "ISO tarifa", business_entity_id: emp };
    const a = await rpc<{ id: string; title_id: string }>(master, "fin_mesa_novo_conciliar", { _payload: payload });
    expect(a.erro).toBeNull();
    expect((await rpc(master, "fin_reconcile_undo", { _reconciliation: a.dados.id, _motivo: "lançado por engano" })).erro).toBeNull();
    const st = (await um<{ s: string }>(`select status::text s from public.financial_titles where id=$1`, [a.dados.title_id])).s;
    if (st !== "cancelado") expect((await rpc(master, "fin_title_cancel", { _title: a.dados.title_id, _motivo: "desfeito" })).erro).toBeNull();
    const b = await rpc<{ title_id: string }>(master, "fin_mesa_novo_conciliar", { _payload: payload });
    expect(b.erro).toBeNull();
    expect(b.dados.title_id).not.toBe(a.dados.title_id);
    // o cancelado continua guardado, só com a chave liberada
    expect((await um<{ s: string }>(`select status::text s from public.financial_titles where id=$1`, [a.dados.title_id])).s).toBe("cancelado");
  });

  test("comparação por pessoa: R$ 500 em aberto no Lardan e R$ 300 no Asaas = Lardan maior", async () => {
    const p = await pessoa(`ISO 0297 compara ${marca()}`);
    const r = await receber(p, 50000);
    await cobranca(p, r, 30000);
    const pf = await rpc<{ pessoas: { nome: string; categoria: string; lardan_cents: number; asaas_cents: number }[] }>(master, "asaas_pente_fino", { _limite: 5000 });
    expect(pf.erro).toBeNull();
    const eu = pf.dados.pessoas.find((x) => x.nome.startsWith("ISO 0297 compara"));
    expect(eu).toMatchObject({ categoria: "lardan_maior", lardan_cents: 50000, asaas_cents: 30000 });
  });
});
