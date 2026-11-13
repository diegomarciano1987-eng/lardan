/**
 * 0316 — recusa SEFAZ 635/204/539 ("em processamento"/duplicidade) não reemite sozinha: a nota original pode ter sido autorizada.
 * Caso real (12–13/11/2026): refs com 635 viraram as notas 197, 213 e 214 e os números 179–181 sumiram da sequência.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, fin: Conta;

async function novoCiclo(n: number) {
  // sessão limpa: outro teste da bateria pode ter deixado um usuário simulado na conexão compartilhada
  return adm.begin(async (tx) => {
    await tx.unsafe(`select set_config('lardan.test_uid','',true), set_config('lardan.test_role','',true)`);
    const kit = ((await tx.unsafe(`insert into public.kits (label) values ($1) returning id`, [`ISO 0316 ${marca} ${n}`])) as { id: string }[])[0]!;
    return ((await tx.unsafe(`insert into public.kit_cycles (kit_id, cycle_no, status) values ($1,1,'montagem') returning id`, [kit.id])) as { id: string }[])[0]!.id;
  });
}
async function nota(ref: string, ciclo: string, status: string) {
  await adm.unsafe(`insert into public.fiscal_focus_envios (ref, ambiente, operacao, status, payload, cycle_id) values ($1,'producao','remessa',$2,'{}',$3)`,
    [ref, status, ciclo]);
}
const fila = async (ciclo: string) =>
  um<{ status: string; erro: string | null }>(`select status, erro from public.fiscal_fila where cycle_id=$1 and etapa='remessa'`, [ciclo]);
const viva = async (ciclo: string) =>
  um<{ n: number }>(`select count(*)::int n from public.fiscal_focus_envios where cycle_id=$1 and operacao='remessa' and ambiente='producao'
                       and (status in ('pendente','processando_autorizacao','autorizado') or public.fiscal_recusa_incerta(status,status_sefaz,mensagem_sefaz,ref))`, [ciclo]);

beforeAll(async () => {
  master = await criarConta({ nome: `iso-0316-master-${marca}`, papeis: ["master"], comParty: true });
  fin = await criarConta({ nome: `iso-0316-fin-${marca}`, papeis: ["financeiro"], comParty: true });
});

describe("0316: recusa incerta da SEFAZ", () => {
  test("635 depois do envio: a fila NÃO reabre e fica pedindo conferência; a maleta conta como tendo nota", async () => {
    const c = await novoCiclo(1);
    const ref = `iso-0316-a-${marca}`;
    await nota(ref, c, "processando_autorizacao");
    await adm.unsafe(`insert into public.fiscal_fila (cycle_id, etapa, status) values ($1,'remessa','feito')`, [c]);
    await adm.unsafe(`update public.fiscal_focus_envios set status='erro_autorizacao', status_sefaz='635',
                        mensagem_sefaz='NF-e com mesmo numero e Serie ja transmitida e aguardando processamento' where ref=$1`, [ref]);
    const f = await fila(c);
    expect(f.status).toBe("erro");
    expect(f.erro).toContain("CONFERIR NA FOCUS");
    expect((await viva(c)).n).toBe(1);
    const log = await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='fiscal.recusa_incerta' and entity_id=$1`, [ref]);
    expect(log.n).toBe(1);
  });

  test("conferência 'não foi autorizada' libera e reabre a fila; só Master confere; exige observação", async () => {
    const c = await novoCiclo(2);
    const ref = `iso-0316-b-${marca}`;
    await nota(ref, c, "processando_autorizacao");
    await adm.unsafe(`insert into public.fiscal_fila (cycle_id, etapa, status) values ($1,'remessa','feito')`, [c]);
    await adm.unsafe(`update public.fiscal_focus_envios set status='erro_autorizacao', status_sefaz='204', mensagem_sefaz='Duplicidade de NF-e' where ref=$1`, [ref]);
    expect((await rpc(fin, "fiscal_recusa_conferir", { _ref: ref, _resultado: "nao_autorizada", _observacao: "conferi no painel da Focus" })).ok).toBe(false);
    expect((await rpc(master, "fiscal_recusa_conferir", { _ref: ref, _resultado: "nao_autorizada", _observacao: "curta" })).ok).toBe(false);
    const r = await rpc<{ fila_reaberta: boolean }>(master, "fiscal_recusa_conferir", { _ref: ref, _resultado: "nao_autorizada", _observacao: "conferi no painel da Focus: rejeitada" });
    expect(r.erro).toBeNull();
    expect(r.dados.fila_reaberta).toBe(true);
    expect((await fila(c)).status).toBe("pendente");
    expect((await viva(c)).n).toBe(0);
  });

  test("conferência 'foi autorizada' mantém a maleta com nota e exige o número", async () => {
    const c = await novoCiclo(3);
    const ref = `iso-0316-c-${marca}`;
    await nota(ref, c, "processando_autorizacao");
    await adm.unsafe(`update public.fiscal_focus_envios set status='erro_autorizacao', status_sefaz='635' where ref=$1`, [ref]);
    expect((await rpc(master, "fiscal_recusa_conferir", { _ref: ref, _resultado: "autorizada", _observacao: "autorizada na SEFAZ" })).ok).toBe(false);
    const r = await rpc(master, "fiscal_recusa_conferir", { _ref: ref, _resultado: "autorizada", _numero: "180", _observacao: "autorizada na SEFAZ, nº 180" });
    expect(r.erro).toBeNull();
    expect((await viva(c)).n).toBe(1);
  });

  test("recusa comum (schema) continua reabrindo a fila como na 0313", async () => {
    const c = await novoCiclo(4);
    const ref = `iso-0316-d-${marca}`;
    await nota(ref, c, "processando_autorizacao");
    await adm.unsafe(`insert into public.fiscal_fila (cycle_id, etapa, status) values ($1,'remessa','feito')`, [c]);
    await adm.unsafe(`update public.fiscal_focus_envios set status='erro_autorizacao', status_sefaz='225', mensagem_sefaz='Falha no Schema XML' where ref=$1`, [ref]);
    expect((await fila(c)).status).toBe("pendente");
    expect((await viva(c)).n).toBe(0);
  });

  test("raio-x tem F10 e F11", async () => {
    const r = await rpc<{ itens?: { codigo: string }[] } | { codigo: string }[]>(master, "auditoria_integridade", {});
    expect(r.erro).toBeNull();
    const itens = (Array.isArray(r.dados) ? r.dados : r.dados.itens ?? []) as { codigo: string }[];
    expect(itens.some((i) => i.codigo === "F10")).toBe(true);
    expect(itens.some((i) => i.codigo === "F11")).toBe(true);
  });
});
