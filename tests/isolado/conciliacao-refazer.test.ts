/**
 * Refazer conciliação depois de desfeita: a mesma chave da tela (linha + alocações)
 * precisa lançar de novo — nunca devolver "repetido" da conciliação estornada.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

let master: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}-${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const DIA = "2026-09-15";
let plano: string;

beforeAll(async () => {
  master = await criarConta({ nome: "master-refazer", papeis: ["master"], comParty: true });
  plano = (await um<{ id: string }>(
    `insert into public.chart_of_accounts (codigo, nome, natureza) values ($1,$1,'receita') returning id`, [`ISO-R-${marca()}`])).id;
});

describe("conciliar de novo depois de desfazer", () => {
  test("mesma linha e parcela: 299,22 entram de novo no razão e a parcela baixa", async () => {
    const acc = (await um<{ id: string }>(
      `insert into public.financial_accounts (nome, kind) values ($1,'conta_corrente') returning id`, [`ISO ${marca()}`])).id;
    const f = await um<{ id: string }>(
      `insert into public.financial_statement_files (financial_account_id, storage_path, original_name, format, sha256)
       values ($1,'iso/x.csv','x.csv','csv',$2) returning id`, [acc, marca()]);
    const imp = await um<{ id: string }>(
      `insert into public.financial_statement_imports (file_id, financial_account_id) values ($1,$2) returning id`, [f.id, acc]);
    const linha = (await um<{ id: string }>(
      `insert into public.financial_statement_lines (import_id, file_id, financial_account_id, line_no, data, valor_cents, kind, historico, hash, status)
       values ($1,$2,$3,1,$4,29922,'entrada','Cobrança recebida ISO',$5,'pendente') returning id`,
      [imp.id, f.id, acc, DIA, marca()])).id;
    const p = await um<{ id: string }>(
      `insert into public.parties (kind, display_name, legal_name, status) values ('pessoa',$1,$1,'ativo') returning id`, [`ISO ${marca()}`]);
    const t = await rpc<string>(master, "fin_title_create", {
      _payload: { direction: "receivable", party_id: p.id, descricao: `ISO ${marca()}`, valor_cents: 65622, emissao: DIA,
        competencia: DIA, chart_account_id: plano, parcelas: [{ vencimento: DIA, valor_cents: 65622 }] } });
    if (!t.ok) throw new Error(t.erro!);
    const inst = (await um<{ id: string }>(`select id from public.financial_installments where title_id=$1`, [t.dados])).id;

    const alocacoes = [{ installment_id: inst, valor_cents: 29922 }];
    const payload = { line_ids: [linha], alocacoes, idempotency_key: `${linha}:${JSON.stringify(alocacoes)}` };
    const primeira = await rpc<{ id: string }>(master, "fin_reconcile", { _payload: payload });
    expect(primeira.ok).toBe(true);
    const undo = await rpc(master, "fin_reconcile_undo", { _reconciliation: primeira.dados!.id, _motivo: "teste" });
    expect(undo.ok).toBe(true);

    const segunda = await rpc<{ id: string; repetido: boolean }>(master, "fin_reconcile", { _payload: payload });
    expect(segunda.ok).toBe(true);
    expect(segunda.dados!.repetido).toBe(false);
    expect(segunda.dados!.id).not.toBe(primeira.dados!.id);

    // Clique duplo depois de refazer continua sem duplicar.
    const terceira = await rpc<{ id: string; repetido: boolean }>(master, "fin_reconcile", { _payload: payload });
    expect(terceira.dados!.repetido).toBe(true);
    expect(terceira.dados!.id).toBe(segunda.dados!.id);

    const saldo = await um<{ s: number }>(
      `select sum(valor_cents)::int s from public.financial_account_movements where financial_account_id=$1`, [acc]);
    expect(saldo.s).toBe(29922);
    const st = await um<{ status: string }>(`select status from public.financial_statement_lines where id=$1`, [linha]);
    expect(st.status).toBe("conciliada");
    const aloc = await um<{ s: number }>(
      `select sum(valor_cents)::int s from public.financial_allocations where installment_id=$1`, [inst]);
    expect(aloc.s).toBe(29922);
  });
});
