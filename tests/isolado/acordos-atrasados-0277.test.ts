/**
 * 0277 — "Acordos atrasados" mostra QUEM está em atraso. Banco ISOLADO, dados sintéticos, sem Asaas real.
 *  1. Acordo com parcela vencida e não paga aparece com nome, parcelas, valor e data mais antiga.
 *  2. Acordo com parcela vencida já paga, ou acordo cancelado, não aparece.
 *  3. A lista tem exatamente a mesma quantidade do indicador do topo.
 *  4. Consultora sem permissão de cobrança é recusada.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, ler, rpc, type Conta } from "./base";

const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let cob: Conta, consultora: Conta;
let conta: string, acc: string, emp: string;
let simAna: string, simBia: string, simCris: string;
type Linha = { party_id: string; simulacao_id: string; nome: string; parcelas_atrasadas: number; atrasado_cents: number; dias_atraso: number; vencimento_mais_antigo: string; fatura_url: string | null; judicial: boolean };

const dia = (n: number) => { const d = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const um = async <T>(sql: string, p: unknown[] = []) => { const r = (await adm.unsafe(sql, p)) as T[]; if (!r[0]) throw new Error("Cenário não criado"); return r[0]; };

async function pessoa(nome: string) {
  return (await um<{ id: string }>(`insert into parties(kind, display_name, legal_name, code) values ('pessoa',$1,$1,$2) returning id`, [nome, `AT${marca}${nome[0]}`])).id;
}
async function acordo(party: string, status: string, cobrancas: { venc: string; st: string; v: number }[]) {
  const t = await um<{ id: string }>(`insert into financial_titles(party_id, direction, descricao, emissao, competencia, valor_cents, origem, status, business_entity_id)
     values ($1,'receivable','acordo ${marca}', $2, $2, 50000, 'manual', 'ativo', $3) returning id`, [party, dia(-60), emp]);
  const i = await um<{ id: string }>(`insert into financial_installments(title_id, numero, vencimento, valor_cents) values ($1,1,$2,50000) returning id`, [t.id, dia(-60)]);
  const s = await um<{ id: string }>(`insert into cob_simulacoes(party_id, installment_ids, data_base, multa_pct, juros_mes_pct, principal_cents, encargos_cents, total_cents, parcelas, status)
     values ($1, array[$2]::uuid[], $3, 0, 0, 30000, 0, 30000, $4, $5) returning id`, [party, i.id, dia(-30), cobrancas.length, status]);
  let n = 0;
  for (const c of cobrancas) {
    n++;
    const ext = `sim_atr_${marca}_${s.id.slice(0, 6)}_${n}`;
    const ch = await adm.begin(async (tx) => {
      await tx.unsafe("select set_config('lardann.asaas_link','on',true)");
      const r = (await tx.unsafe(`insert into asaas_charges(account_id, external_id, value_cents, due_date, billing_type, external_status, installment_id, title_id, party_id, invoice_url)
        values ($1,$2,$3,$4,'PIX',$5,$6,$7,$8,$9) returning id`, [acc, ext, c.v, c.venc, c.st, i.id, t.id, party, `/financeiro/simulacao/${ext}`])) as { id: string }[];
      return r[0]!.id;
    });
    await adm.begin(async (tx) => {
      await tx.unsafe("select set_config('lardann.asaas_intent','on',true)");
      const ref = `iso-atr:${s.id}:${n}`;
      await tx.unsafe(`insert into asaas_charge_intents(account_id,title_id,installment_id,party_id,value_cents,due_date,billing_type,internal_reference,idempotency_key,content_hash,acordo_simulacao_id,acordo_parcela,charge_id,external_id,state)
        values ($1,$2,$3,$4,$5,$6,'PIX',$7,$7,$7,$8,$9,$10,$11,'criada')`, [acc, t.id, i.id, party, c.v, c.venc, ref, s.id, n, ch, ext]);
    });
  }
  return s.id;
}

beforeAll(async () => {
  cob = await criarConta({ nome: `atr-cob-${marca}`, papeis: ["cobranca"], comParty: true });
  consultora = await criarConta({ nome: `atr-cons-${marca}`, papeis: ["consultora"], comParty: true });
  conta = (await um<{ id: string }>("insert into financial_accounts(nome,kind) values($1,'conta_corrente') returning id", [`ISO Atraso ${marca}`])).id;
  emp = (await um<{ id: string }>("insert into business_entities(legal_name) values($1) returning id", [`ISO Empresa Atraso ${marca}`])).id;
  acc = (await um<{ id: string }>("insert into asaas_accounts(label,environment,financial_account_id,owner_entity_id,state) values($1,'sandbox',$2,$3,'simulada') returning id", [`ISO Asaas Atraso ${marca}`, conta, emp])).id;
  const ana = await pessoa(`Ana Atrasada ${marca}`);
  const bia = await pessoa(`Bia Em Dia ${marca}`);
  const cris = await pessoa(`Cris Cancelada ${marca}`);
  simAna = await acordo(ana, "efetivada", [{ venc: dia(-10), st: "PENDING", v: 10000 }, { venc: dia(-3), st: "OVERDUE", v: 5000 }, { venc: dia(20), st: "PENDING", v: 15000 }]);
  simBia = await acordo(bia, "efetivada", [{ venc: dia(-5), st: "RECEIVED", v: 10000 }, { venc: dia(25), st: "PENDING", v: 20000 }]);
  simCris = await acordo(cris, "cancelada", [{ venc: dia(-8), st: "OVERDUE", v: 30000 }]);
});

const lista = async (c: Conta) => { const r = await ler<Linha>(c, "select * from cob_acordos_atrasados_lista()"); return { erro: r.erro, dados: r.linhas }; };

describe("acordos em atraso (0277)", () => {
  test("quem tem parcela do acordo vencida e não paga aparece com nome, parcelas, valor e data", async () => {
    const r = await lista(cob);
    expect(r.erro).toBeNull();
    const a = r.dados.find((x) => x.simulacao_id === simAna);
    expect(a?.nome).toBe(`Ana Atrasada ${marca}`);
    expect(a?.parcelas_atrasadas).toBe(2);
    expect(Number(a?.atrasado_cents)).toBe(15000);
    expect(a?.dias_atraso).toBe(10);
    expect(new Date(String(a?.vencimento_mais_antigo)).toISOString().slice(0, 10)).toBe(dia(-10));
    expect(a?.fatura_url).toContain(`sim_atr_${marca}`);
  });

  test("acordo com parcela vencida já paga ou acordo cancelado não aparecem", async () => {
    const r = await lista(cob);
    const ids = r.dados.map((x) => x.simulacao_id);
    expect(ids).not.toContain(simBia);
    expect(ids).not.toContain(simCris);
  });

  test("a lista tem exatamente a quantidade do indicador Acordos atrasados", async () => {
    const r = await lista(cob);
    const k = await rpc<{ acordos_atrasados: number }>(cob, "cob_kpis_periodo", { _de: dia(-30), _ate: dia(0) });
    expect(k.erro).toBeNull();
    expect(r.dados.length).toBe(Number(k.dados.acordos_atrasados));
    expect(r.dados.length).toBeGreaterThan(0);
  });

  test("consultora sem permissão de cobrança é recusada", async () => {
    const r = await ler<Linha>(consultora, "select * from cob_acordos_atrasados_lista()");
    expect(r.ok).toBe(false);
  });
});
