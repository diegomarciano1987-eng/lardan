/**
 * 0305 — cobrança do SmallData no Asaas sem título no Lardan (banco ISOLADO, dados sintéticos).
 * Decisão do Diego (13/11/2026): a cobrança nova do acerto SUBSTITUI a dívida antiga; cobrança de mesmo valor
 * liga na dívida já lançada; boleto repetido é cancelado pelo espelho oficial; tudo desfazível por lote.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

let master: Conta, financeiro: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const oficial = async <T>(sql: string, p: unknown[] = []) =>
  (await adm.begin(async (tx) => {
    await tx.unsafe(`select set_config('lardann.asaas_link','on',true)`);
    return (await tx.unsafe(sql, p)) as T[];
  }))[0]!;
let fin: string, emp: string, acc: string;
let cod = 90000 + Math.floor(Math.random() * 9000);

async function pessoa() {
  return (await um<{ id: string }>(`insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO 0305 ${marca()}`])).id;
}
async function fiado(party: string, valor: number, venc: string) {
  const t = await rpc<string>(master, "fin_title_create", { _payload: {
    direction: "receivable", party_id: party, descricao: "ISO 0305 fiado", valor_cents: valor, emissao: "2026-06-01", competencia: "2026-06-01",
    business_entity_id: emp, origem: "importacao", sistema_origem: "fiado_historico", id_externo: `iso0305:${marca()}`,
    parcelas: [{ vencimento: venc, valor_cents: valor }] } });
  if (!t.ok) throw new Error(t.erro!);
  const inst = (await um<{ id: string }>(`select id from public.financial_installments where title_id=$1`, [t.dados])).id;
  return { title: t.dados, inst };
}
async function cobranca(party: string, valor: number, ref: string, ligada: { title: string; inst: string } | null = null, criada = "2026-10-06") {
  const ext = `pay_${marca()}`;
  return (await oficial<{ id: string }>(
    `insert into public.asaas_charges (account_id, external_id, customer_external_id, value_cents, due_date, billing_type, external_status, party_id, title_id, installment_id, raw, reconcile_status)
     values ($1,$2,'cus_iso',$3,'2026-11-10','BOLETO','OVERDUE',$4,$5,$6,$7::text::jsonb,$8) returning id`,
    [acc, ext, valor, party, ligada?.title ?? null, ligada?.inst ?? null, JSON.stringify({ externalReference: ref, dateCreated: criada }), ligada ? "vinculado" : "pendente"])).id;
}
const plano = async (party: string) => {
  const r = await rpc<Record<string, unknown>[]>(master, "asaas_smalldata_plano", { _parties: [party] });
  if (!r.ok) throw new Error(r.erro!);
  return r.dados;
};
const aplicar = (party: string, conta: Conta = master) => rpc<{ lote: string; aplicadas: number }>(conta, "asaas_smalldata_aplicar", { _parties: [party], _limite: 10 });
const statusTitulo = async (id: string) => (await um<{ status: string }>(`select status::text from public.financial_titles where id=$1`, [id])).status;
const ligacao = (charge: string) => um<{ title_id: string | null; installment_id: string | null }>(`select title_id, installment_id from public.asaas_charges where id=$1`, [charge]);

beforeAll(async () => {
  master = await criarConta({ nome: "master-0305", papeis: ["master"], comParty: true });
  financeiro = await criarConta({ nome: "fin-0305", papeis: ["financeiro"], comParty: true });
  for (const u of [master, financeiro]) {
    await adm.unsafe(`insert into public.user_financial_access (user_id, nivel) values ($1,'completo') on conflict do nothing`, [u.uid]).catch(() => undefined);
  }
  fin = (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`ISO Asaas 0305 ${marca()}`])).id;
  emp = (await um<{ id: string }>(`insert into public.business_entities (legal_name, trade_name) values ($1,$1) returning id`, [`ISO Emp 0305 ${marca()}`])).id;
  acc = (await um<{ id: string }>(
    `insert into public.asaas_accounts (label, environment, financial_account_id, owner_entity_id, is_active) values ($1,'sandbox',$2,$3,true) returning id`, [`ISO 0305 ${marca()}`, fin, emp])).id;
});

describe("0305 · cobrança nova do SmallData substitui a dívida antiga", () => {
  test("caso Lídia: dívida antiga R$ 291,78 + cobrança do acerto R$ 346,51 → um título de R$ 346,51, antigo cancelado, nada em dobro", async () => {
    const p = await pessoa(); const c1 = ++cod;
    await adm.unsafe(`insert into public.legado_acertos_consultora (remessa, codcli, valor_cents, data, tipo, dinheiro_cents, cheque_cents, prazo_cents, boleto_cents, cartao_cents, fonte)
                      values (864,$1,33964,'2026-10-06','remessa',10000,0,34651,0,0,'cobranca')`, [c1]);
    const antigo = await fiado(p, 29178, "2026-08-27");
    const futura = await fiado(p, 5000, "2026-12-30");
    const ch = await cobranca(p, 34651, `${String(c1).padStart(5, "0")}R00086401`, null, "2026-10-07");
    const pl = await plano(p);
    expect(pl).toHaveLength(1);
    expect(pl[0]!.acao).toBe("substituir");
    expect(pl[0]!.antigo_cents).toBe(29178);
    expect(pl[0]!.cobertura_cents).toBe(34651);
    expect(pl[0]!.data_referencia).toBe("2026-10-06");
    const r = await aplicar(p);
    expect(r.ok).toBe(true);
    expect(await statusTitulo(antigo.title)).toBe("cancelado");
    expect(await statusTitulo(futura.title)).toBe("ativo"); // vence depois do acerto: não é substituída
    const l = await ligacao(ch);
    expect(l.installment_id).not.toBeNull();
    const aberto = await um<{ total: string }>(
      `select sum(public.fin_installment_saldo(i.id))::bigint total from public.financial_installments i join public.financial_titles t on t.id=i.title_id
        where t.party_id=$1 and t.status='ativo'`, [p]);
    expect(Number(aberto.total)).toBe(34651 + 5000);
    // rodar de novo não duplica nada
    expect(await plano(p)).toHaveLength(0);
    // desfazer o lote devolve tudo como era
    const d = await rpc(master, "asaas_smalldata_desfazer", { _lote: r.dados!.lote, _motivo: "teste de desfazer" });
    expect(d.ok).toBe(true);
    expect(await statusTitulo(antigo.title)).toBe("ativo");
    expect((await ligacao(ch)).installment_id).toBeNull();
  });

  test("mesmo valor e a dívida não tem boleto: liga a cobrança na dívida existente (sem título novo)", async () => {
    const p = await pessoa();
    const antigo = await fiado(p, 6398, "2026-09-10");
    const ch = await cobranca(p, 6398, "05588R00086801");
    const pl = await plano(p);
    expect(pl[0]!.acao).toBe("ligar");
    expect((await aplicar(p)).ok).toBe(true);
    expect((await ligacao(ch)).installment_id).toBe(antigo.inst);
    expect(await statusTitulo(antigo.title)).toBe("ativo");
    expect(Number((await um<{ n: string }>(`select count(*) n from public.financial_titles where party_id=$1`, [p])).n)).toBe(1);
  });

  test("boleto repetido (dívida já tem boleto do mesmo valor): antigo cancelado e o espelho cancela o boleto repetido", async () => {
    const p = await pessoa();
    const antigo = await fiado(p, 20788, "2026-09-25");
    await cobranca(p, 20788, "x-antigo", antigo);
    const nova = await cobranca(p, 20788, "06062R00087801");
    const pl = await plano(p);
    expect(pl[0]!.acao).toBe("duplicado");
    expect((await aplicar(p)).ok).toBe(true);
    expect(await statusTitulo(antigo.title)).toBe("cancelado");
    expect((await ligacao(nova)).installment_id).not.toBeNull();
    const esp = await um<{ p: { acao: string; motivo: string } }>(`select public.asaas_saldo_plano($1) p`, [antigo.inst]);
    expect(esp.p.acao).toBe("cancelar");
  });

  test("dívida antiga maior que a nova cobrança: exceção, nada muda", async () => {
    const p = await pessoa();
    const antigo = await fiado(p, 253841, "2026-08-06");
    const ch = await cobranca(p, 35300, "05629R00087101");
    const pl = await plano(p);
    expect(pl[0]!.acao).toBe("excecao");
    expect(pl[0]!.motivo).toBe("divida_antiga_maior_que_a_nova");
    const r = await aplicar(p);
    expect(r.dados!.aplicadas).toBe(0);
    expect(await statusTitulo(antigo.title)).toBe("ativo");
    expect((await ligacao(ch)).installment_id).toBeNull();
  });

  test("dívida antiga com boleto próprio e valor diferente fica como está; a cobrança nova vira título", async () => {
    const p = await pessoa();
    const antigo = await fiado(p, 18125, "2026-10-06");
    await cobranca(p, 18125, "x-antigo2", antigo);
    const ch = await cobranca(p, 34080, "06997R00088301");
    const pl = await plano(p);
    expect(pl[0]!.acao).toBe("novo");
    expect((pl[0]!.mantidas as unknown[]).length).toBe(1);
    expect((await aplicar(p)).ok).toBe(true);
    expect(await statusTitulo(antigo.title)).toBe("ativo");
    expect((await ligacao(ch)).installment_id).not.toBeNull();
  });

  test("só o Master aplica e desfaz; visitante não vê o plano", async () => {
    const p = await pessoa();
    await fiado(p, 1000, "2026-08-01");
    await cobranca(p, 2000, "07777R00088001");
    const r = await aplicar(p, financeiro);
    expect(r.ok).toBe(false);
    const v = await rpc({ nome: "visitante", uid: null, partyId: null }, "asaas_smalldata_aplicar", { _parties: [p] });
    expect(v.ok).toBe(false);
  });
});
