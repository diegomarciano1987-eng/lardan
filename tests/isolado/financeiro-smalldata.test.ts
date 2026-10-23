/**
 * 0149 — financeiro do SmallData no cockpit da consultora. Banco ISOLADO, dados sintéticos.
 *  1. cobrancas/fiados/pagamentos entram pela importação do histórico (reenviar não duplica).
 *  2. O cockpit lê pelo código do cliente: resumo, acertos, fiados e pagamentos; só a equipe de cobrança/financeiro.
 *  3. Conciliação: linha pendente da planilha (CPF sem cadastro) acha a pessoa pelo fiado aberto do SmallData
 *     e vira título; par ambíguo fica; título aberto quitado no SmallData é apontado; prévia não grava; desfazer volta.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 300000 + Math.floor(Math.random() * 90000);
const ANA = base + 1, BIA = base + 2, CAU = base + 3;
const LOTE = `fiado-iso-${base}`;
const ENT = "470f4648-849b-4b7d-91c4-042988e6727d";

let master: Conta, cobranca: Conta, consultora: Conta, ana = "", bia = "";
// datas únicas por execução: rodar de novo na mesma bancada não cria pares ambíguos com a execução anterior
const venc = (d: number) => new Date(Date.UTC(2020, 0, 1) + ((base % 2000) * 3 + d) * 864e5).toISOString().slice(0, 10);
function cpf(base9: string) {
  const d = base9.split("").map(Number);
  const dv = (arr: number[]) => { const s = arr.reduce((acc, n, i) => acc + n * (arr.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(d);
  return base9 + d1 + dv([...d, d1]);
}

async function servico<T>(sql: string, p: unknown[] = []) {
  const c = await adm.reserve();
  try {
    await c.unsafe(`set role service_role`);
    await c.unsafe(`select set_config('lardan.test_role','service_role',false), set_config('lardan.test_uid','',false)`);
    return ((await c.unsafe(sql, p)) as T[])[0]!;
  } finally {
    try { await c.unsafe(`reset role`); await c.unsafe(`select set_config('lardan.test_role','',false)`); } catch { /* */ }
    c.release();
  }
}
async function importar(tipo: string, linhas: Record<string, unknown>[]) {
  const r = await rpc(master, "legado_importar", { _tipo: tipo, _lote: `iso-fin-${base}`, _linhas: linhas });
  if (r.erro) throw new Error(`${tipo}: ${r.erro}`);
}
const fiado = (id: number, codcli: number, d: number, valor: string, status: "A" | "F", parcela = 1) =>
  ({ id: String(id), chave_cob: `C${id}`, codcli: String(codcli), data_cob: venc(d - 30), parcela: String(parcela), vencimento: venc(d),
     forma: "CARTEIRA", status, data_status: status === "F" ? venc(d + 3) : "", valor, juros: "0.00", multa: "0.00", desconto: "0.00",
     data_pgto: status === "F" ? venc(d + 3) : "", chave_baixa: status === "F" ? `B${id}` : "" });

beforeAll(async () => {
  master = await criarConta({ nome: `fin-master-${base}`, papeis: ["master"], comParty: true });
  cobranca = await criarConta({ nome: `fin-cob-${base}`, papeis: ["cobranca"], comParty: true });
  consultora = await criarConta({ nome: `fin-cons-${base}`, papeis: ["consultora"], comParty: true });
  ana = (await um<{ id: string }>(`insert into public.parties (kind, display_name, status) values ('pessoa',$1,'ativo') returning id`, [`Ana Fin ${base}`])).id;
  bia = (await um<{ id: string }>(`insert into public.parties (kind, display_name, status) values ('pessoa',$1,'ativo') returning id`, [`Bia Fin ${base}`])).id;
  await adm.unsafe(`insert into public.party_codigos_legados (party_id, sistema, codigo) values ($1,'cliente',$2),($3,'cliente',$4)`,
    [ana, String(ANA), bia, String(BIA)]);
  await adm.unsafe(`insert into public.legado_consultoras (codcli, nome, party_id, vinculo) values ($1,'Ana',$2,'codigo'),($3,'Bia',$4,'codigo'),($5,'Cau',null,null)
                    on conflict (codcli) do update set party_id = excluded.party_id`, [ANA, ana, BIA, bia, CAU]);
  if (!(await um<{ n: number }>(`select count(*)::int n from public.business_entities where id=$1`, [ENT])).n)
    await adm.unsafe(`insert into public.business_entities (id, legal_name, trade_name) values ($1,'Lardan ISO','Lardan ISO')`, [ENT]);
});

describe("1. importação do financeiro do SmallData", () => {
  test("cobranças, fiados e pagamentos entram em centavos; reenviar não duplica", async () => {
    const cob = { chave: `${ANA}R1`, codcli: String(ANA), praca: "1", vendedor: "3009", tipo: "1", data: "2025-03-10", remessa: "700",
      valor_remessa: "5000.00", venda_bruta: "1200.50", venda_liquida: "840.35", venda_pago: "640.35", venda_fiado: "200.00",
      fiado_anterior: "0", fiado_pago: "0", fiado_pendente: "0", juros: "0", multa: "0", cheque_devolvido: "0", total_pago: "640.35",
      desconto: "0", dinheiro: "140.35", cheque: "0", cartao: "0", deposito: "500.00", boleto: "0", credito_cartao: "0", fiado_novo: "200.00", encerramento: "8" };
    await importar("cobrancas", [cob, { ...cob, chave: `${ANA}F1`, tipo: "4", data: "2025-05-02", remessa: "", venda_bruta: "0", venda_liquida: "0",
      venda_pago: "0", venda_fiado: "0", fiado_pago: "100.00", total_pago: "100.00", dinheiro: "0", deposito: "100.00", fiado_novo: "0" }]);
    await importar("cobrancas", [cob]);
    await importar("fiados", [
      fiado(base * 10 + 1, ANA, 10, "100.00", "F"), fiado(base * 10 + 2, ANA, 40, "100.00", "A", 2),
      fiado(base * 10 + 3, BIA, 50, "77.70", "A"),                                       // casa com a linha pendente
      fiado(base * 10 + 4, BIA, 60, "55.50", "A"), fiado(base * 10 + 5, ANA, 60, "55.50", "A"),   // ambíguo
      fiado(base * 10 + 6, ANA, 70, "33.30", "F"),                                       // título aberto no Lardan, quitado no SmallData
    ]);
    await importar("pagamentos", [
      { origem: "deposito", id: String(base), chave_cob: `${ANA}R1`, codcli: String(ANA), data: "2025-03-10", vencimento: "", data_pgto: "",
        data_devolucao: "", valor: "500.00", valor_pago: "500.00", taxa: "0", parcela: "1", parcelas: "", situacao: "", detalhe: "" },
      { origem: "cheque", id: String(base), chave_cob: `${ANA}R1`, codcli: String(ANA), data: "2025-03-10", vencimento: "2025-04-10", data_pgto: "",
        data_devolucao: "2025-04-15", valor: "90.00", valor_pago: "90.00", taxa: "0", parcela: "1", parcelas: "", situacao: "R", detalhe: "" },
    ]);
    const c = await um<{ n: number; bruta: string; dep: string }>(
      `select count(*)::int n, sum(venda_bruta_cents)::text bruta, sum(deposito_cents)::text dep from public.legado_cobrancas where codcli=$1`, [ANA]);
    expect(c).toEqual({ n: 2, bruta: "120050", dep: "60000" });
  });
});

describe("2. cockpit", () => {
  test("lê pelo código do cliente: resumo, acertos, fiados e pagamentos", async () => {
    const r = await rpc<{ codigos: number[]; resumo: Record<string, number>; acertos: { rotulo: string }[]; fiados: { situacao: string }[];
      pagamentos: { origem: string; situacao: string }[] }>(cobranca, "consultora_financeiro_smalldata", { _party: ana });
    expect(r.erro).toBeNull();
    expect(r.dados.codigos).toEqual([ANA]);
    expect(Number(r.dados.resumo["acertos"])).toBe(1);
    expect(Number(r.dados.resumo["venda_bruta_cents"])).toBe(120050);
    expect(Number(r.dados.resumo["total_pago_cents"])).toBe(74035);
    expect(Number(r.dados.resumo["fiado_aberto_cents"])).toBe(15550);
    expect(Number(r.dados.resumo["fiado_quitado_cents"])).toBe(13330);
    expect(r.dados.acertos.map((a) => a.rotulo).sort()).toEqual(["Acerto da maleta", "Pagamento de fiado"]);
    expect(r.dados.fiados[0]!.situacao).toBe("aberto");
    expect(r.dados.pagamentos.find((p) => p.origem === "cheque")!.situacao).toBe("devolvido");
  });

  test("consultora não lê o financeiro (nem o próprio por aqui)", async () => {
    expect((await rpc(consultora, "consultora_financeiro_smalldata", { _party: ana })).ok).toBe(false);
  });
});

describe("3. conciliação com a planilha de fiados", () => {
  test("unificação: o lastro que ficou na duplicada aparece no cockpit da canônica", async () => {
    const dup = (await um<{ id: string }>(`insert into public.parties (kind, display_name, status) values ('pessoa',$1,'ativo') returning id`, [`Dup Fin ${base}`])).id;
    await adm.unsafe(`select set_config('lardan.fiado_rollback','on',false)`);
    await adm.unsafe(`insert into public.cob_fiado_linhas (lote, linha, payload, party_id, vencimento, valor_cents, situacao) values ($1, 99, '{}', $2, $3, 1234, 'importada')`,
      [LOTE + "-dup", dup, venc(5)]);
    await adm.unsafe(`select set_config('lardan.fiado_rollback','',false)`);
    await adm.unsafe(`insert into public.party_unificacoes (canonica_id, duplicada_id, motivo) values ($1,$2,'teste')`, [ana, dup]);
    const ck = await rpc<{ fiado: { linha: number }[] }>(cobranca, "consultora_cockpit_financeiro", { _party: ana });
    expect(ck.dados.fiado.map((f) => f.linha)).toContain(99);
  });

  const linha = (n: number, doc: string, codcli: number, d: number, valor: number, parc = 1) =>
    ({ linha: n, payload: { origem: "teste" }, doc, codcli: String(codcli), praca: "", rep: "", dcob: venc(d - 30), venc: venc(d), parc, valor });

  test("planilha: Ana tem CPF cadastrado (importa); Bia e o par ambíguo ficam pendentes", async () => {
    await adm.unsafe(`update public.parties set doc=$2 where id=$1`, [ana, cpf(String(100000000 + Math.floor(Math.random() * 799999999)))]);
    const doc = (await um<{ d: string }>(`select doc_digits d from public.parties where id=$1`, [ana])).d;
    expect(doc).toHaveLength(11);
    const r = await servico<{ r: Record<string, number> }>(`select public.cob_fiado_importar($1, $2::text::jsonb) r`, [LOTE, JSON.stringify([
      linha(1, doc, ANA, 40, 10000, 2), linha(2, "99988877766", BIA, 50, 7770), linha(3, "99988877755", BIA, 60, 5550), linha(4, doc, ANA, 70, 3330),
    ])]);
    expect([r.r["importadas"], r.r["pendentes"]]).toEqual([2, 2]);
  });

  test("prévia não grava; a cobrança vê a prévia mas não aplica", async () => {
    const p = await rpc<Record<string, number | boolean>>(cobranca, "cob_fiado_smalldata_conciliar", { _aplicar: false });
    expect(p.erro).toBeNull();
    expect(p.dados["aplicado"]).toBe(false);
    expect(Number(p.dados["pendentes_resolvidas"])).toBeGreaterThanOrEqual(1);
    expect((await um<{ n: number }>(`select count(*)::int n from public.legado_fiado_vinculo where fiado_id between $1 and $2`, [base * 10, base * 10 + 9])).n).toBe(0);
    expect((await rpc(cobranca, "cob_fiado_smalldata_conciliar", { _aplicar: true })).ok).toBe(false);
  });

  test("aplicar: pendente da Bia vira título dela; ambíguo fica; quitado no SmallData é apontado; cockpit mostra 'no Lardan'", async () => {
    const a = await rpc<{ lote: string; titulos_criados: number; lardan_aberto_quitado_no_smalldata: number }>(master, "cob_fiado_smalldata_conciliar", { _aplicar: true });
    expect(a.erro).toBeNull();
    // o lastro não muda: a pessoa achada e o título ficam no vínculo
    const l2 = await um<{ id: string; situacao: string; party_id: string | null }>(
      `select id::text, situacao, party_id::text from public.cob_fiado_linhas where lote=$1 and linha=2`, [LOTE]);
    expect(l2).toMatchObject({ situacao: "pendente", party_id: null });
    const v = await um<{ party_id: string; title_id: string }>(
      `select party_id::text, title_id::text from public.legado_fiado_vinculo where linha_id=$1`, [l2.id]);
    expect(v.party_id).toBe(bia);
    const t = await um<{ party: string; origem: string; valor: number }>(
      `select party_id::text party, sistema_origem origem, valor_cents::int valor from public.financial_titles where id=$1`, [v.title_id]);
    expect(t).toEqual({ party: bia, origem: "fiado_historico", valor: 7770 });
    const l3 = await um<{ situacao: string }>(`select situacao from public.cob_fiado_linhas where lote=$1 and linha=3`, [LOTE]);
    expect(l3.situacao).toBe("pendente");
    expect(Number(a.dados.lardan_aberto_quitado_no_smalldata)).toBeGreaterThanOrEqual(1);

    const ck = await rpc<{ fiados: { id: number; no_lardan: boolean }[] }>(cobranca, "consultora_financeiro_smalldata", { _party: bia });
    expect(ck.dados.fiados.find((f) => f.id === base * 10 + 3)!.no_lardan).toBe(true);
    const lardan = await rpc<{ parcelas: unknown[]; fiado: { linha: number; situacao_titulo: string | null }[] }>(cobranca, "consultora_cockpit_financeiro", { _party: bia });
    expect(lardan.dados.parcelas.length).toBe(1);
    expect(lardan.dados.fiado.map((f) => f.linha)).toEqual([2]);
    expect(lardan.dados.fiado[0]!.situacao_titulo).toBe("nao_liquidado");

    // rodar de novo não cria outro título
    const b = await rpc<{ titulos_criados: number }>(master, "cob_fiado_smalldata_conciliar", { _aplicar: true });
    expect(b.dados.titulos_criados).toBe(0);

    const d = await rpc<{ titulos_cancelados: number }>(master, "cob_fiado_smalldata_desfazer", { _lote: a.dados.lote });
    expect(d.erro).toBeNull();
    expect(d.dados.titulos_cancelados).toBe(a.dados.titulos_criados); // bancada compartilhada: pode haver sobras de outra execução
    expect((await um<{ n: number }>(`select count(*)::int n from public.legado_fiado_vinculo where linha_id=$1`, [l2.id])).n).toBe(0);
    expect((await um<{ s: string }>(`select status s from public.financial_titles where id=$1`, [v.title_id])).s).toBe("cancelado");
  });
});
