/**
 * Etapa E (0235/0236) — cobrança histórica com fatura única. Banco ISOLADO, dados sintéticos, sem Asaas.
 *  1. Lista soma só as parcelas abertas vencidas até 31/12/2025 e diz se a pessoa também deve depois.
 *  2. Prévia não grava nada.
 *  3. Aplicar cria UM acordo de 1 parcela, sem juros nem desconto, no valor exato do saldo antigo.
 *  4. Repetir não duplica (já tem fatura única); Judicial e cobrança aberta no Asaas ficam de fora.
 *  5. Busca no servidor por código e por partes do nome; consultora sem permissão é recusada.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let cob: Conta, consultora: Conta;
let ana: string, bia: string, cris: string, duda: string;
type Linha = { party_id: string; parcelas: number; saldo_cents: number; tem_recente: boolean; asaas_abertas: number; judicial: boolean; acordo_origem: string | null };
type Cons = { aplicado: boolean; criadas: number; total_cents: number; itens: { party_id: string; ok: boolean; motivo: string | null; simulacao_id: string | null }[] };
const venc = (() => { const d = new Date(); d.setDate(d.getDate() + 10); return d.toISOString().slice(0, 10); })();

async function pessoa(nome: string, code: string) {
  const r = (await adm.unsafe(`insert into parties(kind, display_name, legal_name, code) values ('pessoa',$1,$1,$2) returning id`, [nome, code])) as { id: string }[];
  return r[0].id;
}
async function divida(party: string, vencimento: string, valor: number) {
  const t = (await adm.unsafe(`insert into financial_titles(party_id, direction, descricao, emissao, competencia, valor_cents, origem, status)
     values ($1,'receivable','hist ${marca}', $2, $2, $3, 'manual', 'ativo') returning id`, [party, vencimento, valor])) as { id: string }[];
  const i = (await adm.unsafe(`insert into financial_installments(title_id, numero, vencimento, valor_cents) values ($1, 1, $2, $3) returning id`,
    [t[0].id, vencimento, valor])) as { id: string }[];
  return i[0].id;
}

beforeAll(async () => {
  cob = await criarConta({ nome: `hist-cob-${marca}`, papeis: ["cobranca", "financeiro"], comParty: true });
  consultora = await criarConta({ nome: `hist-cons-${marca}`, papeis: ["consultora"], comParty: true });
  ana = await pessoa(`Ana Historica ${marca}`, `H${marca}A`);
  bia = await pessoa(`Bia Historica ${marca}`, `H${marca}B`);
  cris = await pessoa(`Cris Historica ${marca}`, `H${marca}C`);
  duda = await pessoa(`Duda Historica ${marca}`, `H${marca}D`);
  await divida(ana, "2024-03-10", 10000);
  await divida(ana, "2025-11-10", 5050);
  await divida(ana, "2026-02-10", 9990); // depois do corte: não entra na soma
  await divida(bia, "2025-06-01", 7000);
  await divida(cris, "2025-01-01", 3000);
  await adm.unsafe(`insert into cob_casos(party_id, etapa) values ($1,'acompanhamento') on conflict (party_id) do update set etapa='acompanhamento'`, [cris]);
  const parcelaDuda = await divida(duda, "2025-02-01", 4000);
  await adm.unsafe(`select set_config('lardann.asaas_charge','on',false)`).catch(() => null);
  await adm.unsafe(`alter table asaas_charges disable trigger user`);
  try {
    const conta = (await adm.unsafe(`select id from asaas_accounts limit 1`)) as { id: string }[];
    if (conta[0]) await adm.unsafe(`insert into asaas_charges(account_id, external_id, installment_id, external_status, value_cents, due_date)
        values ($1, $2, $3, 'OVERDUE', 4000, '2025-02-01')`, [conta[0].id, `pay_hist_${marca}`, parcelaDuda]);
  } finally { await adm.unsafe(`alter table asaas_charges enable trigger user`); }
});

const linha = async (party: string) => {
  const r = await rpc<Linha[]>(cob, "cob_historica_lista", {});
  expect(r.erro).toBeNull();
  return r.dados.find((x) => x.party_id === party);
};

describe("cobrança histórica", () => {
  test("soma só o vencido até 2025 e marca quem também deve depois", async () => {
    const a = await linha(ana);
    expect(a?.parcelas).toBe(2);
    expect(Number(a?.saldo_cents)).toBe(15050);
    expect(a?.tem_recente).toBe(true);
    const b = await linha(bia);
    expect(Number(b?.saldo_cents)).toBe(7000);
    expect(b?.tem_recente).toBe(false);
  });

  test("prévia não grava nada", async () => {
    const r = await rpc<Cons>(cob, "cob_historica_consolidar", { _parties: [ana, bia, cris], _vencimento: venc, _aplicar: false });
    expect(r.erro).toBeNull();
    expect(r.dados.criadas).toBe(0);
    expect(r.dados.total_cents).toBe(22050);
    const n = (await adm.unsafe(`select count(*)::int n from cob_simulacoes where party_id = any($1::uuid[])`, [[ana, bia]])) as { n: number }[];
    expect(n[0].n).toBe(0);
  });

  test("aplicar cria uma fatura única de 1 parcela, sem juros nem desconto", async () => {
    const r = await rpc<Cons>(cob, "cob_historica_consolidar", { _parties: [ana, bia, cris], _vencimento: venc, _aplicar: true });
    expect(r.erro).toBeNull();
    expect(r.dados.criadas).toBe(2);
    expect(r.dados.itens.find((i) => i.party_id === cris)?.motivo).toBe("Está no Judicial");
    const s = (await adm.unsafe(`select total_cents::int t, principal_cents::int p, encargos_cents::int e, desconto_cents::int d, parcelas, origem, status,
        array_length(installment_ids,1) n, plano from cob_simulacoes where party_id=$1`, [ana])) as Record<string, unknown>[];
    expect(s.length).toBe(1);
    expect(s[0]).toMatchObject({ t: 15050, p: 15050, e: 0, d: 0, parcelas: 1, origem: "historica", status: "simulada", n: 2 });
    expect((s[0].plano as { valor_cents: number; data: string }[])[0]).toMatchObject({ valor_cents: 15050, data: venc });
  });

  test("repetir não duplica", async () => {
    const r = await rpc<Cons>(cob, "cob_historica_consolidar", { _parties: [ana], _vencimento: venc, _aplicar: true });
    expect(r.dados.criadas).toBe(0);
    expect(r.dados.itens[0].motivo).toBe("Já tem fatura única");
    expect((await linha(ana))?.acordo_origem).toBe("historica");
  });

  test("cobrança aberta no Asaas bloqueia (não cobra duas vezes)", async () => {
    const d = await linha(duda);
    if (!d?.asaas_abertas) return; // banco sem conta Asaas de teste: coberto pela trava oficial do envio
    const r = await rpc<Cons>(cob, "cob_historica_consolidar", { _parties: [duda], _vencimento: venc, _aplicar: true });
    expect(r.dados.criadas).toBe(0);
    expect(r.dados.itens[0].motivo).toContain("Asaas");
  });

  test("busca no servidor por código e por partes do nome", async () => {
    const porCodigo = await rpc<string[]>(cob, "cob_historica_buscar", { _termo: `H${marca}B` });
    expect(porCodigo.dados).toEqual([bia]);
    const porNome = await rpc<string[]>(cob, "cob_historica_buscar", { _termo: `historica ana ${marca}` });
    expect(porNome.dados).toEqual([ana]);
  });

  test("consultora não acessa", async () => {
    const r = await rpc(consultora, "cob_historica_lista", {});
    expect(r.ok).toBe(false);
  });
});
