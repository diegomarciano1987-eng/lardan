/**
 * Microtarifas de notificação do Asaas: prévia por mês e conciliação em lote.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

let master: Conta;
let semAcesso: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;

async function conta() {
  return (await um<{ id: string }>(
    `insert into public.financial_accounts (nome, kind) values ($1,'provedor') returning id`, [`ISO Asaas ${marca()}`])).id;
}
async function linha(acc: string, data: string, valor: number, tipo: string, hist: string) {
  const f = await um<{ id: string }>(
    `insert into public.financial_statement_files (financial_account_id, storage_path, original_name, format, sha256)
     values ($1,'iso/x.csv','x.csv','csv',$2) returning id`, [acc, marca()]);
  const i = await um<{ id: string }>(
    `insert into public.financial_statement_imports (file_id, financial_account_id) values ($1,$2) returning id`, [f.id, acc]);
  return (await um<{ id: string }>(
    `insert into public.financial_statement_lines (import_id, file_id, financial_account_id, line_no, data, valor_cents, kind, historico, hash, status, raw)
     values ($1,$2,$3,$4,$5,$6,'saida',$7,$8,'pendente',$9::jsonb) returning id`,
    [i.id, f.id, acc, ++n, data, valor, hist, marca(), JSON.stringify({ type: tipo, value: -valor / 100 })])).id;
}

beforeAll(async () => {
  master = await criarConta({ nome: "master-micro", papeis: ["master"], comParty: true });
  semAcesso = await criarConta({ nome: "cons-micro", papeis: ["consultora"], comParty: true });
  await adm.unsafe(`insert into public.parties (kind, display_name, legal_name, status)
    select 'organizacao','ASAAS - SISTEMA PAGAMENTO','ASAAS - SISTEMA PAGAMENTO','ativo'
    where not exists (select 1 from public.parties where display_name like 'ASAAS%')`);
  await adm.unsafe(`insert into public.chart_of_accounts (codigo, nome, natureza)
    select '5.1.1','Tarifas Bancárias','despesa' where not exists (select 1 from public.chart_of_accounts where codigo='5.1.1')`);
  await adm.unsafe(`insert into public.cost_centers (codigo, nome)
    select 'administrativo','Administrativo' where not exists (select 1 from public.cost_centers where codigo='administrativo')`);
  await adm.unsafe(`delete from public.site_settings where key='financeiro.aprovacao'`);
});

describe("microtarifas Asaas", () => {
  test("prévia agrupa por mês, ignora outras linhas e o futuro; lote concilia tudo uma vez só", async () => {
    const acc = await conta();
    const set = [
      await linha(acc, "2026-09-10", 45, "INSTANT_TEXT_MESSAGE_FEE", "Taxa de notificação por WhatsApp da cobrança 1 SARA FARIAS BARBOSA"),
      await linha(acc, "2026-09-11", 55, "PHONE_CALL_NOTIFICATION_FEE", "Taxa de notificação por robô de voz - fatura 2 ERICA"),
      await linha(acc, "2026-09-12", 45, "INSTANT_TEXT_MESSAGE_FEE", "Taxa de notificação por WhatsApp da cobrança 3 X"),
    ];
    const out = await linha(acc, "2026-10-01", 55, "PHONE_CALL_NOTIFICATION_FEE", "Taxa de notificação por robô de voz - fatura 4 Y");
    const outra = await linha(acc, "2026-09-10", 199, "PAYMENT_FEE", "Taxa do boleto");
    const futura = await linha(acc, "2099-01-01", 45, "INSTANT_TEXT_MESSAGE_FEE", "Taxa de notificação por WhatsApp futura");

    const p = await rpc<{ mes: string; qtd: number; qtd_whatsapp: number; qtd_voz: number; total_cents: number }[]>(
      master, "fin_microtarifas_previa", { _conta: acc, _ate: null });
    expect(p.ok).toBe(true);
    expect(p.dados).toEqual([
      expect.objectContaining({ mes: "2026-09", qtd: 3, qtd_whatsapp: 2, qtd_voz: 1, total_cents: 145 }),
      expect.objectContaining({ mes: "2026-10", qtd: 1, qtd_voz: 1, total_cents: 55 }),
    ]);

    const negado = await rpc(semAcesso, "fin_microtarifas_conciliar", { _conta: acc, _ate: null });
    expect(negado.ok).toBe(false);

    const r = await rpc<{ meses: { mes: string; title_id: string; linhas: number; total_cents: number }[] }>(
      master, "fin_microtarifas_conciliar", { _conta: acc, _ate: null });
    expect(r.ok).toBe(true);
    expect(r.dados.meses.map((m) => [m.mes, m.linhas, m.total_cents])).toEqual([["2026-09", 3, 145], ["2026-10", 1, 55]]);

    const st = (await adm.unsafe(
      `select id, status::text s from public.financial_statement_lines where id = any($1::uuid[])`,
      [[...set, out, outra, futura]])) as { id: string; s: string }[];
    const por = Object.fromEntries(st.map((x) => [x.id, x.s]));
    for (const id of [...set, out]) expect(por[id]).toBe("conciliada");
    expect(por[outra]).toBe("pendente");
    expect(por[futura]).toBe("pendente");

    const t = await um<{ direction: string; valor: number; party: string; plano: string; centro: string; status: string }>(
      `select t.direction::text, t.valor_cents::int valor, p.display_name party, c.codigo plano, cc.codigo centro, i.settlement_status::text status
         from public.financial_titles t join public.parties p on p.id=t.party_id
         left join public.chart_of_accounts c on c.id=t.chart_account_id
         left join public.cost_centers cc on cc.id=t.cost_center_id
         join public.financial_installments i on i.title_id=t.id where t.id=$1`, [r.dados.meses[0]!.title_id]);
    expect(t).toEqual({ direction: "payable", valor: 145, party: "ASAAS - SISTEMA PAGAMENTO", plano: "5.1.1", centro: "administrativo", status: "liquidado" });

    const mov = await um<{ s: number }>(
      `select coalesce(sum(valor_cents),0)::int s from public.financial_account_movements where financial_account_id=$1`, [acc]);
    expect(Math.abs(mov.s)).toBe(200);

    const de_novo = await rpc<{ meses: unknown[] }>(master, "fin_microtarifas_conciliar", { _conta: acc, _ate: null });
    expect(de_novo.ok).toBe(true);
    expect(de_novo.dados.meses).toEqual([]);
  });
});
