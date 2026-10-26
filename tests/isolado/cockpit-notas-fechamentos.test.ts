/**
 * 0161 — Cockpit da consultora: toda NF lançada contra ela e todo fechamento de maleta (SmallData + Lardan).
 * Banco ISOLADO, dados sintéticos.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 600000 + Math.floor(Math.random() * 90000);
const COD = base, REM = 90000 + (base % 9000);
let master: Conta, cobranca: Conta, cons: Conta, outra: Conta, deposito = "", praca = "", ciclo = "", vA = "";

beforeAll(async () => {
  master = await criarConta({ nome: `nf-master-${base}`, papeis: ["master"], comParty: true });
  cobranca = await criarConta({ nome: `nf-cob-${base}`, papeis: ["cobranca"], comParty: true });
  cons = await criarConta({ nome: `nf-cons-${base}`, papeis: ["consultora"], comParty: true });
  outra = await criarConta({ nome: `nf-outra-${base}`, papeis: ["consultora"], comParty: true });
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora') on conflict do nothing`, [cons.partyId]);
  await adm.unsafe(`insert into public.party_codigos_legados (party_id, sistema, codigo) values ($1,'cliente',$2)`, [cons.partyId, String(COD)]);
  // SmallData: uma maleta fechada (remessa → devolução → venda) e uma aberta
  await adm.unsafe(`insert into public.legado_maletas (remessa, codcli, kit, emissao, fechamento, pecas_enviadas, pecas_devolvidas, valor_enviado_cents, valor_devolvido_cents, nf_remessa, nf_devolucao, nf_venda)
                    values ($1,$2,1,'2025-02-01','2025-03-10',60,40,600000,400000,'1001','1201','1301'),($3,$2,1,'2025-04-01',null,50,0,500000,0,'1002',null,null)`, [REM, COD, REM + 1]);
  await adm.unsafe(`insert into public.legado_notas (nf_id, numero, serie, emitida_em, natureza, tipo, codcli, remessa, kit, valor_cents, pecas, cfop, situacao, operacao) values
    ($1,1001,1,'2025-02-01 10:00','Remessa em consignação','R',$2,$3,1,600000,60,'5917','autorizada','saida'),
    ($1+1,1201,1,'2025-03-10 09:00','Devolução de consignação','D',$2,$3,1,400000,40,'1918','autorizada','entrada'),
    ($1+2,1301,1,'2025-03-10 09:05','Venda','V',$2,$3,1,200000,20,'5115','autorizada','saida'),
    ($1+3,1002,1,'2025-04-01 10:00','Remessa em consignação','R',$2,$4,1,500000,50,'5917','cancelada','saida')`, [base, COD, REM, REM + 1]);
  await adm.unsafe(`insert into public.legado_cobrancas (chave, codcli, tipo, data, remessa, venda_bruta_cents, venda_liquida_cents, total_pago_cents)
                    values ($1,$2,1,'2025-03-10',$3,200000,140000,140000)`, [`NF${base}`, COD, REM]);
  // Lardan: uma maleta aceita com NF-e de remessa
  deposito = await criarDeposito(`nf-${base}`);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça NF ${base}`])).linhas[0]!.id;
  await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id) values ($1,$2) on conflict (party_id) do update set praca_id=excluded.praca_id`, [cons.partyId, praca]);
  vA = await criarVariante(`nf-a-${base}`, 10000);
  await porEstoque(vA, deposito, 10);
  const rem = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _deposito: deposito })).dados.id;
  const m = await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: rem, _consultora: cons.partyId });
  ciclo = m.dados.cycle_id;
  await rpc(master, "kit_item_upsert", { _cycle: ciclo, _variant: vA, _qty: 3 });
  await rpc(master, "kit_conferir", { _cycle: ciclo, _note: null });
  await rpc(master, "kit_expedir", { _cycle: ciclo, _payload: { rota: "direta" } });
  // NF-e já autorizada (a emissão fiscal está desligada na bancada: grava direto, sem os gatilhos de emissão)
  await adm.begin(async (tx) => {
    await tx.unsafe(`set local session_replication_role = replica`);
    await tx.unsafe(`insert into public.fiscal_documents (cycle_id, kind, status, recipient_party_id, series, number, total_cents, authorized_at, environment, simulado)
                     values ($1,'remessa','autorizado',$2,'1','5555',30000,now(),'homologacao',true)`, [ciclo, cons.partyId]);
  });
});

afterAll(async () => {
  await adm.begin(async (tx) => { await tx.unsafe(`set local session_replication_role = replica`); await tx.unsafe(`delete from public.fiscal_documents where cycle_id=$1`, [ciclo]); });
  await adm.unsafe(`delete from public.legado_notas where nf_id between $1 and $1+3`, [base]);
  await adm.unsafe(`delete from public.legado_cobrancas where chave=$1`, [`NF${base}`]);
  await adm.unsafe(`delete from public.legado_maletas where codcli=$1`, [COD]);
});

type Nota = { origem: string; numero: string; tipo: string; situacao: string; valor_cents: number; remessa: number | null };
type Fech = { origem: string; remessa: number | null; situacao: string; pecas_vendidas: number; vendido_cents: number; cobranca: { comissao_cents: number; pago_cents: number } | null; notas: Record<string, string> };

describe("cockpit: notas e fechamentos", () => {
  test("toda NF da consultora (SmallData + Lardan), inclusive cancelada", async () => {
    const r = await rpc<{ notas: Nota[] }>(cobranca, "consultora_notas_e_fechamentos", { _party: cons.partyId });
    expect(r.erro).toBeNull();
    const n = r.dados.notas;
    expect(n.filter((x) => x.origem === "smalldata").map((x) => x.numero).sort()).toEqual(["1001", "1002", "1201", "1301"]);
    expect(n.find((x) => x.numero === "1201")).toMatchObject({ tipo: "devolucao", valor_cents: 400000 });
    expect(n.find((x) => x.numero === "1002")!.situacao).toBe("cancelada");
    expect(n.find((x) => x.origem === "lardan")).toMatchObject({ numero: "5555", tipo: "remessa", valor_cents: 30000 });
  });

  test("todo fechamento: SmallData com acerto e notas; Lardan com a maleta", async () => {
    const r = await rpc<{ fechamentos: Fech[] }>(cobranca, "consultora_notas_e_fechamentos", { _party: cons.partyId });
    const f = r.dados.fechamentos;
    const fechada = f.find((x) => x.origem === "smalldata" && x.remessa === REM)!;
    expect(fechada).toMatchObject({ situacao: "fechada", pecas_vendidas: 20, vendido_cents: 200000, notas: { remessa: "1001", devolucao: "1201", venda: "1301" } });
    expect(fechada.cobranca).toMatchObject({ comissao_cents: 60000, pago_cents: 140000 });
    expect(f.find((x) => x.origem === "smalldata" && x.remessa === REM + 1)!.situacao).toBe("aberta");
    expect(f.find((x) => x.origem === "lardan")).toMatchObject({ notas: { remessa: "5555" } });
  });

  test("só equipe de cobrança/financeiro vê", async () => {
    expect((await rpc(outra, "consultora_notas_e_fechamentos", { _party: cons.partyId })).ok).toBe(false);
    expect((await rpc(cons, "consultora_notas_e_fechamentos", { _party: cons.partyId })).ok).toBe(false);
  });
});
