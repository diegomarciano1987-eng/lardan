/**
 * 0337 — situação do termo de confissão por acordo (aba Histórica). Banco ISOLADO, dados sintéticos, sem ZapSign.
 *  1. Assinado vence pendente/cancelado do mesmo acordo; pendente mostra o link; acordo sem termo não aparece.
 *  2. Link de termo cancelado nunca é devolvido.
 *  3. Consultora (sem cobrança) é recusada.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, ler, type Conta } from "./base";

const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let cob: Conta, consultora: Conta;
let simAssinado: string, simPendente: string, simSem: string;
type Linha = { simulacao_id: string; status: string; sign_url: string | null };

async function sim(party: string) {
  const r = (await adm.unsafe(`insert into cob_simulacoes(party_id, installment_ids, data_base, multa_pct, juros_mes_pct, principal_cents, encargos_cents, total_cents, plano, origem)
     values ($1, '{}', current_date, 0, 0, 10000, 0, 10000, '[{"numero":1,"data":"2026-12-10","valor_cents":10000}]', 'historica') returning id`, [party])) as { id: string }[];
  return r[0].id;
}
async function termo(party: string, simId: string, status: string, url: string, quando: string) {
  await adm.unsafe(`insert into assinaturas_digitais(ambiente, tipo, party_id, simulacao_id, status, titulo, texto_hash, sign_url, criado_em)
     values ('sandbox','confissao',$1,$2,$3,'Termo ${marca}','h',$4,$5)`, [party, simId, status, url, quando]);
}

beforeAll(async () => {
  cob = await criarConta({ nome: `termo-cob-${marca}`, papeis: ["cobranca", "financeiro"], comParty: true });
  consultora = await criarConta({ nome: `termo-cons-${marca}`, papeis: ["consultora"], comParty: true });
  const p = ((await adm.unsafe(`insert into parties(kind, display_name, legal_name) values ('pessoa',$1,$1) returning id`, [`Gabi ${marca}`])) as { id: string }[])[0].id;
  simAssinado = await sim(p); simPendente = await sim(p); simSem = await sim(p);
  await termo(p, simAssinado, "cancelado", "https://x/cancelado", "2026-11-01");
  await termo(p, simAssinado, "assinado", "https://x/assinado", "2026-11-02");
  await termo(p, simAssinado, "pendente", "https://x/pendente-velho", "2026-11-03");
  await termo(p, simPendente, "cancelado", "https://x/cancelado2", "2026-11-05");
  await termo(p, simPendente, "pendente", "https://x/pendente", "2026-11-04");
});

const consulta = (conta: Conta, ids: string[]) =>
  ler<Linha>(conta, `select simulacao_id, status, sign_url from public.cob_termos_confissao($1::uuid[])`, [`{${ids.join(",")}}`]);

describe("0337 termo de confissão na Histórica", () => {
  test("assinado vence; pendente traz link; sem termo não aparece", async () => {
    const r = await consulta(cob, [simAssinado, simPendente, simSem]);
    expect(r.erro).toBeNull();
    const m = new Map(r.linhas.map((l) => [l.simulacao_id, l]));
    expect(m.get(simAssinado)?.status).toBe("assinado");
    expect(m.get(simAssinado)?.sign_url).toBeNull();
    expect(m.get(simPendente)?.status).toBe("pendente");
    expect(m.get(simPendente)?.sign_url).toBe("https://x/pendente");
    expect(m.has(simSem)).toBe(false);
  });
  test("consultora sem cobrança é recusada", async () => {
    const r = await consulta(consultora, [simAssinado]);
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("Sem permissão");
  });
});
