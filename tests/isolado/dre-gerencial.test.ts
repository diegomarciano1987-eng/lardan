/**
 * DRE gerencial: matriz × fin_dre, contas fora da estrutura, fechamento de período,
 * reabertura com motivo, orçamento e desempenho. Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

let master: Conta;
let semAcesso: Conta;
let party: string;
const contas: Record<string, string> = {};
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;

async function titulo(dir: "receivable" | "payable", chart: string | null, comp: string, valor: number) {
  const t = await um<{ id: string }>(
    `insert into public.financial_titles (direction, party_id, descricao, emissao, competencia, valor_cents, chart_account_id, status)
     values ($1,$2,'ISO DRE',$3,$3,$4,$5,'ativo') returning id`, [dir, party, comp, valor, chart]);
  await adm.unsafe(`insert into public.financial_installments (title_id, numero, total_parcelas, vencimento, valor_cents, competencia)
     values ($1,1,1,$2,$3,$2)`, [t.id, comp, valor]);
  return t.id;
}

type Linha = { codigo: string; valores: Record<string, number>; total: number; total_comparativo: number; contas: { codigo: string }[] };
type Matriz = { meses: string[]; linhas: Linha[]; meses_fechados: string[]; alertas: unknown[] };

beforeAll(async () => {
  master = await criarConta({ nome: "master-dreg", papeis: ["master"], comParty: true });
  semAcesso = await criarConta({ nome: "cons-dreg", papeis: ["consultora"], comParty: true });
  party = master.partyId!;
  const defs: [string, string, string][] = [
    ["ISO.R", "Receita ISO", "receita"], ["ISO.D", "Dedução ISO", "deducao"], ["ISO.C", "CMV ISO", "custo"],
    ["ISO.A", "Administrativa ISO", "despesa"], ["ISO.F", "Tarifa ISO", "despesa"], ["ISO.X", "Sem mapa ISO", "despesa"],
    ["ISO.P", "Empréstimo ISO", "passivo"],
  ];
  for (const [cod, nome, nat] of defs) {
    contas[cod] = (await um<{ id: string }>(
      `insert into public.chart_of_accounts (codigo, nome, natureza) values ($1,$2,$3::fin_account_nature)
       on conflict do nothing returning id`, [cod, nome, nat]))?.id
      ?? (await um<{ id: string }>(`select id from public.chart_of_accounts where codigo=$1`, [cod])).id;
  }
  for (const [cod, linha] of [["ISO.R", "receita_bruta"], ["ISO.D", "deducoes"], ["ISO.C", "cmv"], ["ISO.A", "administrativas"], ["ISO.F", "financeiro"]]) {
    const r = await rpc(master, "fin_dre_mapa_set", { _chart: contas[cod!], _linha: linha });
    expect(r.erro).toBeNull();
  }
  // 12 meses sintéticos em 2023, valores variados
  for (let m = 1; m <= 12; m++) {
    const d = `2023-${String(m).padStart(2, "0")}-15`;
    await titulo("receivable", contas["ISO.R"]!, d, 1_000_000 + m * 12_345);
    await titulo("payable", contas["ISO.D"]!, d, 60_000 + m * 101);
    await titulo("payable", contas["ISO.C"]!, d, 300_000 + m * 777);
    await titulo("payable", contas["ISO.A"]!, d, 150_000 + (m === 7 ? 400_000 : m * 33));
    await titulo("payable", contas["ISO.F"]!, d, 1_99 * m);
    await titulo("payable", contas["ISO.X"]!, d, 5_000 + m);
    await titulo("payable", contas["ISO.P"]!, d, 77_000);
    await titulo("payable", null, d, 9_999);
  }
});

describe("DRE gerencial", () => {
  test("sem capacidade financeira é recusado", async () => {
    const r = await rpc(semAcesso, "fin_dre_gerencial", { _filtros: { de: "2023-01-01", ate: "2023-12-31" } });
    expect(r.ok).toBe(false);
  });

  test("Lucro líquido de cada um dos 12 meses = resultado da fin_dre (competência e caixa)", async () => {
    for (const regime of ["competencia", "caixa"]) {
      const g = await rpc<Matriz>(master, "fin_dre_gerencial", { _filtros: { de: "2023-01-01", ate: "2023-12-31", regime } });
      expect(g.erro).toBeNull();
      expect(g.dados.meses.length).toBe(12);
      const ll = g.dados.linhas.find((l) => l.codigo === "lucro_liquido")!;
      let soma = 0;
      for (const mes of g.dados.meses) {
        const fim = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).toISOString().slice(0, 10);
        const d = await rpc<{ totais: { resultado_cents: number } }>(master, "fin_dre", { _filtros: { de: `${mes}-01`, ate: fim, regime } });
        expect(d.erro).toBeNull();
        expect(ll.valores[mes]).toBe(d.dados.totais.resultado_cents);
        soma += d.dados.totais.resultado_cents;
      }
      expect(ll.total).toBe(soma);
    }
  }, 60_000);

  test("conta não mapeada aparece em 'fora da estrutura'; passivo fica fora da DRE", async () => {
    const g = await rpc<Matriz>(master, "fin_dre_gerencial", { _filtros: { de: "2023-01-01", ate: "2023-12-31" } });
    const fora = g.dados.linhas.find((l) => l.codigo === "fora_estrutura")!;
    expect(fora.contas.map((c) => c.codigo)).toContain("ISO.X");
    expect(g.dados.linhas.flatMap((l) => l.contas.map((c) => c.codigo))).not.toContain("ISO.P");
  });

  test("comparativo mês anterior e alerta de variação", async () => {
    const g = await rpc<Matriz>(master, "fin_dre_gerencial", { _filtros: { de: "2023-07-01", ate: "2023-07-31", comparativo: "mes_anterior" } });
    const rb = g.dados.linhas.find((l) => l.codigo === "receita_bruta")!;
    expect(rb.total_comparativo).toBeGreaterThan(0);
    expect(g.dados.alertas.length).toBeGreaterThan(0);
  });

  test("orçamento alimenta o comparativo 'orcado' com o sinal da linha", async () => {
    const s = await rpc(master, "fin_orcamento_salvar", { _linhas: [{ mes: "2023-03-01", linha: "administrativas", valor_cents: 200_000 }] });
    expect(s.erro).toBeNull();
    const neg = await rpc(master, "fin_orcamento_salvar", { _linhas: [{ mes: "2023-03-01", linha: "administrativas", valor_cents: -1 }] });
    expect(neg.ok).toBe(false);
    const g = await rpc<Matriz>(master, "fin_dre_gerencial", { _filtros: { de: "2023-03-01", ate: "2023-03-31", comparativo: "orcado" } });
    expect(g.dados.linhas.find((l) => l.codigo === "administrativas")!.total_comparativo).toBe(-200_000);
  });

  test("período fechado recusa lançamento e baixa; reabrir exige motivo", async () => {
    expect((await rpc(semAcesso, "fin_periodo_fechar", { _mes: "2023-05-01", _ent: null, _motivo: "x" })).ok).toBe(false);
    expect((await rpc(master, "fin_periodo_fechar", { _mes: "2023-05-01", _ent: null, _motivo: "Fechamento maio" })).erro).toBeNull();
    let erro = "";
    try { await titulo("payable", contas["ISO.A"]!, "2023-05-20", 100); } catch (e) { erro = (e as Error).message; }
    expect(erro).toContain("Período fechado");
    const t = await um<{ id: string }>(`select id from public.financial_titles where competencia='2023-05-15' and chart_account_id=$1`, [contas["ISO.A"]]);
    erro = "";
    try { await adm.unsafe(`update public.financial_titles set chart_account_id=$1 where id=$2`, [contas["ISO.C"], t.id]); } catch (e) { erro = (e as Error).message; }
    expect(erro).toContain("Período fechado");
    const g = await rpc<Matriz>(master, "fin_dre_gerencial", { _filtros: { de: "2023-01-01", ate: "2023-12-31" } });
    expect(g.dados.meses_fechados).toContain("2023-05");
    expect((await rpc(master, "fin_periodo_reabrir", { _mes: "2023-05-01", _ent: null, _motivo: "" })).ok).toBe(false);
    expect((await rpc(master, "fin_periodo_reabrir", { _mes: "2023-05-01", _ent: null, _motivo: "Ajuste aprovado pela diretoria" })).erro).toBeNull();
    const aud = await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='fin.periodo.reabrir' and entity_id='2023-05'`);
    expect(aud.n).toBeGreaterThan(0);
    await titulo("payable", contas["ISO.A"]!, "2023-05-20", 100); // reaberto: aceita
  });

  test("desempenho: 24 meses com 50 mil títulos", async () => {
    await adm.unsafe(`
      with t as (
        insert into public.financial_titles (direction, party_id, descricao, emissao, competencia, valor_cents, chart_account_id, status)
        select case when g % 3 = 0 then 'receivable' else 'payable' end::fin_direction, $1, 'ISO PERF',
               d, d, 1000 + g % 997, case when g % 3 = 0 then $2::uuid else $3::uuid end, 'ativo'
        from generate_series(1, 50000) g, lateral (select ('2021-01-01'::date + (g % 730))::date d) x
        returning id, competencia, valor_cents)
      insert into public.financial_installments (title_id, numero, total_parcelas, vencimento, valor_cents, competencia)
      select id, 1, 1, competencia, valor_cents, competencia from t`, [party, contas["ISO.R"], contas["ISO.A"]]);
    await adm.unsafe(`analyze public.financial_titles; analyze public.financial_installments`);
    const ini = performance.now();
    const g = await rpc<Matriz>(master, "fin_dre_gerencial", { _filtros: { de: "2021-01-01", ate: "2022-12-31" } });
    const ms = performance.now() - ini;
    console.log(`fin_dre_gerencial 24 meses / 50 mil títulos: ${ms.toFixed(0)} ms`);
    expect(g.erro).toBeNull();
    expect(g.dados.meses.length).toBe(24);
    expect(ms).toBeLessThan(1000);
  }, 120_000);
});
