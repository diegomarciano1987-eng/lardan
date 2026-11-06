/**
 * 0254 — maletas de abertura do SmallData (remessas 924/925) entram numa remessa do Cloud pelo motor oficial.
 * Banco ISOLADO, dados sintéticos (as linhas reais de 924/925 da migração não são usadas aqui).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, ler, porEstoque, rpc, rpcServico, saldo, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => {
  const row = ((await adm.unsafe(sql, p)) as T[])[0];
  if (!row) throw new Error("Missing isolated test row");
  return row;
};
const sufixo = Math.floor(Math.random() * 90000);
const LEG = 800000 + sufixo; // remessa do SmallData
const LEG_OUTRO = 700000 + sufixo; // remessa de outro representante
const DEST = 600000 + sufixo; // remessa do Cloud
const REP_COD = 900000 + sufixo;
const PROD_A = 5000000 + sufixo * 3, PROD_B = PROD_A + 1, ANEL = PROD_A + 2, SEM = PROD_A + 9;
let master: Conta, cons: Conta, rep: Conta, rep2: Conta;
let deposito = "", vA = "", vB = "", vAnel = "", remessa = "";

type Previa = {
  pode_aplicar: boolean; problemas: string[]; ja_feitas: number;
  totais: { maletas: number; pecas: number; sem_cadastro: number; aro_a_criar: number; valor_cloud_cents: number };
  maletas: { kit: number; pecas: number; situacao: string }[];
  pecas_pendentes: { produto: number; situacao: string }[];
  falta_no_deposito: { codigo: string; precisa: number; disponivel: number }[];
};

async function variante(nome: string, codigo: number, preco: number) {
  const p = await um<{ id: string }>(`insert into products(name,slug,status) values($1,$2,'rascunho') returning id`, [nome, `iso-lt-${codigo}`]);
  const v = await um<{ id: string }>(`update product_variants set barcode=$2, price_cents=$3, is_active=true where product_id=$1 and is_default returning id`, [p.id, String(codigo), preco]);
  return v.id;
}

function cpf(base9: string) {
  const d = base9.split("").map(Number);
  for (const n of [9, 10]) { const soma = d.slice(0, n).reduce((a, x, i) => a + x * (n + 1 - i), 0); const r = (soma * 10) % 11; d.push(r === 10 ? 0 : r); }
  return d.join("");
}

beforeAll(async () => {
  master = await criarConta({ nome: `lt-master-${sufixo}`, papeis: ["master"], comParty: true });
  cons = await criarConta({ nome: `lt-cons-${sufixo}`, papeis: ["consultora"], comParty: true });
  rep = await criarConta({ nome: `lt-rep-${sufixo}`, papeis: ["representante"], comParty: true });
  rep2 = await criarConta({ nome: `lt-rep2-${sufixo}`, papeis: ["representante"], comParty: true });
  deposito = await criarDeposito(`lt-${sufixo}`);
  vA = await variante(`PUL TESTE ${sufixo}`, PROD_A, 10000);
  vB = await variante(`BR TESTE ${sufixo}`, PROD_B, 5000);
  vAnel = await variante(`AN TESTE ${sufixo}`, ANEL, 4000);
  await porEstoque(vA, deposito, 10);
  await porEstoque(vB, deposito, 1); // falta 1
  // como no banco real: o código do representante está ligado a OUTRA pessoa (quem opera a rota); vale o CPF do SmallData
  const cpf1 = cpf(`3${String(sufixo).padStart(5, "0")}417`), cpf2 = cpf(`5${String(sufixo).padStart(5, "0")}239`);
  await adm.unsafe(`update parties set doc=$2 where id=$1`, [rep.partyId, cpf1]);
  await adm.unsafe(`update parties set doc=$2 where id=$1`, [rep2.partyId, cpf2]);
  await adm.unsafe(`insert into legado_representantes(codigo,nome,cpf,party_id,vinculo) values($1,'Rep teste',$2,$3,'manual'),($4,'Rep 2',$5,$6,'manual')`,
    [REP_COD, cpf1, cons.partyId, REP_COD + 1, cpf2, rep2.partyId]);
  const pracaRow = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`LT ${sufixo}`])).linhas[0];
  if (!pracaRow) throw new Error("Praça não criada na bancada isolada");
  const praca = pracaRow.id;
  const r = await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _numero: DEST, _representante: rep.partyId, _deposito: deposito,
    _data_acerto: new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10) });
  if (!r.ok) throw new Error(r.erro ?? "Remessa não criada");
  remessa = r.dados.id;
  await adm.unsafe(`insert into legado_transferencia_remessas(legado_remessa,representante,praca,emissao,remessa_destino) values
    ($1,$2,14,'2026-10-30',$3),($4,$5,14,'2026-10-30',$3)`, [LEG, REP_COD, DEST, LEG_OUTRO, REP_COD + 1]);
  await adm.unsafe(`insert into legado_transferencia_maletas(legado_remessa,codcli,kit,valor_legado_cents,pecas_legado) values
    ($1,20,1,25000,3),($1,20,2,14000,3),($2,74,1,10000,1)`, [LEG, LEG_OUTRO]);
  await adm.unsafe(`insert into legado_transferencia_pecas(legado_remessa,codcli,kit,produto,tamanho,quantidade,conferida,nome) values
    ($1,20,1,$3,'U',2,2,'PUL'),($1,20,1,$4,'U',1,1,'BR'),
    ($1,20,2,$4,'U',1,1,'BR'),($1,20,2,$5,'17',1,1,'AN aro 17'),($1,20,2,$3,'U',1,1,'PUL'),
    ($2,74,1,$3,'U',1,1,'PUL')`, [LEG, LEG_OUTRO, PROD_A, PROD_B, ANEL]);
});

describe("prévia", () => {
  test("só quem monta e vê todas as remessas", async () => {
    expect((await rpc(cons, "legado_transferencia_previa", { _legado: LEG })).ok).toBe(false);
    expect((await rpc(rep, "legado_transferencia_previa", { _legado: LEG })).ok).toBe(false);
    // logado não pode se passar por outra pessoa
    expect((await rpc(cons, "legado_transferencia_previa", { _legado: LEG, _actor: master.uid })).erro).toContain("sem _actor");
  });

  test("mostra maletas, peças, aro a registrar e a falta no depósito, sem gravar nada", async () => {
    const p = await rpc<Previa>(master, "legado_transferencia_previa", { _legado: LEG });
    expect(p.erro).toBeNull();
    expect(p.dados.problemas).toEqual([]);
    expect(p.dados.totais).toMatchObject({ maletas: 2, pecas: 6, sem_cadastro: 0, aro_a_criar: 1 });
    expect(p.dados.maletas.map((m) => [m.kit, m.pecas])).toEqual([[1, 3], [2, 3]]);
    expect(p.dados.pecas_pendentes).toEqual([expect.objectContaining({ produto: ANEL, situacao: "aro_a_criar" })]);
    const faltas = Object.fromEntries(p.dados.falta_no_deposito.map((f) => [f.codigo, [f.precisa, f.disponivel]]));
    expect(faltas).toEqual({ [String(PROD_B)]: [2, 1], [`${ANEL}17`]: [1, 0] });
    expect(p.dados.pode_aplicar).toBe(true);
    expect((await um<{ n: number }>(`select count(*)::int n from kit_cycles where remessa_id=$1`, [remessa])).n).toBe(0);
  });

  test("remessa de outro representante é recusada (pelo CPF do SmallData)", async () => {
    const p = await rpc<Previa>(master, "legado_transferencia_previa", { _legado: LEG_OUTRO });
    expect(p.dados.pode_aplicar).toBe(false);
    expect(p.dados.problemas.join(" ")).toContain("CPF diferente");
    // a ligação do código não foi tocada
    expect((await um<{ p: string }>(`select party_id::text p from legado_representantes where codigo=$1`, [REP_COD])).p).toBe(cons.partyId);
    expect((await rpc(master, "legado_transferencia_aplicar", { _legado: LEG_OUTRO, _aceitar_falta: true })).erro).toContain("Não dá para aplicar");
  });

  test("peça sem cadastro trava a aplicação", async () => {
    await adm.unsafe(`insert into legado_transferencia_pecas(legado_remessa,codcli,kit,produto,tamanho,quantidade,nome) values($1,20,1,$2,'U',1,'SEM CADASTRO')`, [LEG, SEM]);
    const p = await rpc<Previa>(master, "legado_transferencia_previa", { _legado: LEG });
    expect(p.dados.totais.sem_cadastro).toBe(1);
    expect(p.dados.pode_aplicar).toBe(false);
    expect((await rpc(master, "legado_transferencia_aplicar", { _legado: LEG, _aceitar_falta: true })).erro).toContain("sem cadastro");
    await adm.unsafe(`delete from legado_transferencia_pecas where legado_remessa=$1 and produto=$2`, [LEG, SEM]);
  });
});

describe("aplicar e desfazer", () => {
  test("com falta no depósito, exige confirmação", async () => {
    const r = await rpc(master, "legado_transferencia_aplicar", { _legado: LEG });
    expect(r.erro).toContain("_aceitar_falta");
    expect((await um<{ n: number }>(`select count(*)::int n from kit_cycles where remessa_id=$1`, [remessa])).n).toBe(0);
  });

  test("monta e confere pelo motor oficial: ABERTURA com o representante, aro registrado, sem mexer no estoque", async () => {
    const r = await rpc<{ maletas: number; pecas: number; aros_criados: number; lista: { kit_smalldata: number; abertura: number; cycle_id: string }[] }>(
      master, "legado_transferencia_aplicar", { _legado: LEG, _aceitar_falta: true });
    expect(r.erro).toBeNull();
    expect(r.dados).toMatchObject({ maletas: 2, pecas: 6, aros_criados: 1 });
    const c = (await adm.unsafe(`select c.status::text s, c.representante_party_id::text rep, c.consultora_party_id cons, c.abertura_numero n, k.label,
        (select sum(i.quantity)::int from kit_composition_items i join kit_compositions kc on kc.id=i.composition_id where kc.cycle_id=c.id) pecas
      from kit_cycles c join kits k on k.id=c.kit_id where c.remessa_id=$1 order by c.abertura_numero`, [remessa])) as { s: string; rep: string; cons: string | null; n: number; label: string; pecas: number }[];
    expect(c.map((x) => [x.s, x.rep, x.cons, x.n, x.pecas])).toEqual([["conferida", rep.partyId, null, 1, 3], ["conferida", rep.partyId, null, 2, 3]]);
    expect(c[0]?.label).toBe(`ABERTURA 1 · Remessa ${DEST}`);
    const aro = await um<{ size: string; barcode: string }>(`select size, barcode from product_variants where product_id=(select product_id from product_variants where id=$1) and barcode=$2`, [vAnel, `${ANEL}17`]);
    expect(aro).toEqual({ size: "17", barcode: `${ANEL}17` });
    expect(await saldo(vA, deposito)).toBe(10); // conferir só reserva; a saída é na expedição
    const audit = await um<{ n: number }>(`select count(*)::int n from audit_logs where action='legado_transferencia_aplicar' and entity_id=$1`, [remessa]);
    expect(audit.n).toBe(1);
  });

  test("repetir não duplica", async () => {
    const r = await rpc<{ maletas: number; repetida: boolean }>(master, "legado_transferencia_aplicar", { _legado: LEG, _aceitar_falta: true });
    expect(r.dados).toMatchObject({ maletas: 0, repetida: true });
    expect((await um<{ n: number }>(`select count(*)::int n from kit_cycles where remessa_id=$1 and status<>'cancelada'`, [remessa])).n).toBe(2);
    const p = await rpc<Previa>(master, "legado_transferencia_previa", { _legado: LEG });
    expect(p.dados.ja_feitas).toBe(2);
    expect(p.dados.falta_no_deposito).toEqual([]);
  });

  test("desfazer exclui pelo caminho oficial e devolve a reserva; pode trazer de novo", async () => {
    expect((await rpc(master, "legado_transferencia_desfazer", { _legado: LEG, _motivo: "x" })).erro).toContain("motivo");
    const d = await rpc<{ desfeitas: number }>(master, "legado_transferencia_desfazer", { _legado: LEG, _motivo: "teste de desfazer" });
    expect(d.erro).toBeNull();
    expect(d.dados.desfeitas).toBe(2);
    expect((await um<{ n: number }>(`select count(*)::int n from kit_cycles where remessa_id=$1 and status<>'cancelada'`, [remessa])).n).toBe(0);
    expect((await um<{ r: number }>(`select coalesce(reserved,0)::int r from stock_balances where variant_id=$1 and location_id=$2`, [vA, deposito])).r).toBe(0);
  });

  test("servidor em nome do Master; expedir manda para o representante e ele recebe no app", async () => {
    expect((await rpcServico("legado_transferencia_aplicar", { _legado: LEG, _aceitar_falta: true, _expedir: true })).ok).toBe(false);
    const r = await rpcServico<{ maletas: number; expedidas: boolean }>("legado_transferencia_aplicar", { _legado: LEG, _aceitar_falta: true, _expedir: true, _actor: master.uid });
    expect(r.erro).toBeNull();
    expect(r.dados).toMatchObject({ maletas: 2, expedidas: true });
    expect(await saldo(vA, deposito)).toBe(7);
    const m = await rpc<{ a_receber: { transfer_id: string }[] }>(rep, "rep_portal_maletas", { _rep: rep.partyId });
    expect(m.dados.a_receber.length).toBe(2);
    const d = await rpc<{ desfeitas: number; ja_sairam: unknown[] }>(master, "legado_transferencia_desfazer", { _legado: LEG, _motivo: "já saiu, não desfaz" });
    expect(d.dados.desfeitas).toBe(0);
    expect(d.dados.ja_sairam.length).toBe(2);
  });
});
