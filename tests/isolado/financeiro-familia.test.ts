/**
 * 0177 — Financeiro da família (consultora e representante).
 * Privacidade: cada login só vê e mexe nas próprias linhas; nem Master enxerga. Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, ler, rpc, VISITANTE, type Conta } from "./base";

let cons: Conta, rep: Conta, master: Conta;
const um = async <T>(c: Conta, sql: string, p: unknown[] = []) => {
  const r = await ler<T>(c, sql, p);
  if (!r.ok) throw new Error(r.erro ?? "falhou");
  return r.linhas[0]!;
};

beforeAll(async () => {
  cons = await criarConta({ nome: "fam-cons", papeis: ["consultora"], comParty: true });
  rep = await criarConta({ nome: "fam-rep", papeis: ["representante"], comParty: true });
  master = await criarConta({ nome: "fam-master", papeis: ["master"], comParty: true });
});

describe("financeiro da família", () => {
  test("categorias padrão só uma vez, com Ganhos LARDAN nas receitas", async () => {
    const r1 = await rpc<number>(cons, "familia_garantir_categorias_padrao");
    expect(r1.erro).toBeNull();
    expect(r1.dados).toBe(19);
    expect((await rpc<number>(cons, "familia_garantir_categorias_padrao")).dados).toBe(0);
    const g = await ler<{ nome: string }>(cons, `select nome from public.familia_categorias where tipo = 'receita' order by ordem limit 1`);
    expect(g.linhas[0]!.nome).toBe("Ganhos LARDAN");
    expect((await rpc(VISITANTE, "familia_garantir_categorias_padrao")).ok).toBe(false);
  });

  test("lançamentos da consultora: ninguém mais vê nem altera (nem Master)", async () => {
    const cat = await um<{ id: string }>(cons, `select id from public.familia_categorias where tipo = 'despesa' and nome = 'Mercado'`);
    const fixa = await um<{ id: string; user_id: string }>(cons,
      `insert into public.familia_despesas_fixas (nome, valor, dia_vencimento, mes_inicio, categoria_id) values ('Aluguel', 1200, 10, '2026-01-01', $1) returning id, user_id`, [cat.id]);
    expect(fixa.user_id).toBe(cons.uid!);
    await um(cons, `insert into public.familia_despesas_variaveis (descricao, valor, data) values ('Mercado do mês', 350.5, '2026-10-05') returning id`);
    await um(cons, `insert into public.familia_receitas (fonte, valor, data) values ('Comissão maleta', 900, '2026-10-20') returning id`);

    for (const outro of [rep, master]) {
      for (const t of ["familia_despesas_fixas", "familia_despesas_variaveis", "familia_receitas", "familia_categorias"]) {
        const r = await ler<{ n: number }>(outro, `select count(*)::int n from public.${t} where user_id = $1`, [cons.uid]);
        expect(r.linhas[0]!.n).toBe(0);
      }
      const alt = await ler(outro, `update public.familia_despesas_fixas set valor = 1 where id = $1 returning id`, [fixa.id]);
      expect(alt.linhas.length).toBe(0);
      const apaga = await ler(outro, `delete from public.familia_despesas_fixas where id = $1 returning id`, [fixa.id]);
      expect(apaga.linhas.length).toBe(0);
    }
    expect((await ler(VISITANTE, `select 1 from public.familia_receitas`)).linhas.length).toBe(0);
    const anon = (await adm.unsafe(`select bool_or(has_table_privilege('anon', 'public.' || t, 'select')) x
      from unnest(array['familia_categorias','familia_contas','familia_projetos','familia_despesas_fixas','familia_fixas_ocorrencias','familia_despesas_variaveis','familia_receitas']) t`)) as { x: boolean }[];
    expect(anon[0]!.x).toBe(false);
    const ainda = await um<{ valor: string }>(cons, `select valor from public.familia_despesas_fixas where id = $1`, [fixa.id]);
    expect(Number(ainda.valor)).toBe(1200);
  });

  test("não grava linha em nome de outra pessoa nem troca o dono", async () => {
    const r = await ler(rep, `insert into public.familia_receitas (user_id, fonte, valor, data) values ($1, 'x', 10, '2026-10-01')`, [cons.uid]);
    expect(r.ok).toBe(false);
    const minha = await um<{ id: string }>(cons, `insert into public.familia_receitas (fonte, valor, data) values ('Extra', 50, '2026-10-02') returning id`);
    const troca = await ler(cons, `update public.familia_receitas set user_id = $2 where id = $1`, [minha.id, rep.uid]);
    expect(troca.ok).toBe(false);
  });

  test("não usa categoria, conta ou projeto de outra pessoa", async () => {
    await rpc(rep, "familia_garantir_categorias_padrao");
    const catRep = await um<{ id: string }>(rep, `select id from public.familia_categorias where tipo = 'despesa' limit 1`);
    const r = await ler(cons, `insert into public.familia_despesas_variaveis (descricao, valor, data, categoria_id) values ('x', 10, '2026-10-01', $1)`, [catRep.id]);
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("Categoria inválida");
    // categoria de receita não serve para despesa
    const catRec = await um<{ id: string }>(cons, `select id from public.familia_categorias where tipo = 'receita' limit 1`);
    const r2 = await ler(cons, `insert into public.familia_despesas_variaveis (descricao, valor, data, categoria_id) values ('x', 10, '2026-10-01', $1)`, [catRec.id]);
    expect(r2.erro).toContain("Categoria inválida");
  });

  test("reajuste preserva o histórico e leva os pagamentos dali em diante", async () => {
    const f = await um<{ id: string }>(cons,
      `insert into public.familia_despesas_fixas (nome, valor, dia_vencimento, mes_inicio) values ('Internet', 100, 5, '2026-01-01') returning id`);
    await um(cons, `insert into public.familia_fixas_ocorrencias (fixa_id, competencia, status, valor_pago, data_pagamento) values ($1, '2026-03-01', 'paga', 100, '2026-03-05'), ($1, '2026-07-01', 'paga', 120, '2026-07-05') returning id`, [f.id]);
    const r = await rpc<string>(cons, "familia_reajustar_fixa", { _id: f.id, _novo_valor: 120, _a_partir: "2026-06-15" });
    expect(r.erro).toBeNull();
    const antiga = await um<{ encerrada_em: string }>(cons, `select encerrada_em::text from public.familia_despesas_fixas where id = $1`, [f.id]);
    expect(antiga.encerrada_em).toBe("2026-05-01");
    const nova = await um<{ valor: string; mes_inicio: string }>(cons, `select valor, mes_inicio::text from public.familia_despesas_fixas where id = $1`, [r.dados]);
    expect(Number(nova.valor)).toBe(120);
    expect(nova.mes_inicio).toBe("2026-06-01");
    const ocs = await ler<{ fixa_id: string; competencia: string }>(cons, `select fixa_id, competencia::text from public.familia_fixas_ocorrencias where fixa_id in ($1, $2) order by competencia`, [f.id, r.dados]);
    expect(ocs.linhas.map((o) => [o.competencia, o.fixa_id === f.id ? "antiga" : "nova"])).toEqual([["2026-03-01", "antiga"], ["2026-07-01", "nova"]]);
    // ninguém mais reajusta a despesa dela
    expect((await rpc(master, "familia_reajustar_fixa", { _id: r.dados, _novo_valor: 1, _a_partir: "2026-09-01" })).erro).toContain("não encontrada");
  });

  test("categoria em uso não troca de tipo", async () => {
    const cat = await um<{ id: string }>(cons, `select id from public.familia_categorias where tipo = 'despesa' and nome = 'Mercado'`);
    const r = await ler(cons, `update public.familia_categorias set tipo = 'receita' where id = $1`, [cat.id]);
    expect(r.erro).toContain("não pode mudar de tipo");
  });
});
