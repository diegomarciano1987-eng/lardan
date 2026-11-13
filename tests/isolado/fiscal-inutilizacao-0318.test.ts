/**
 * 0318 — inutilização de números pulados pela tela fiscal (Focus /v2/nfe/inutilizacao).
 * Caso real: série 3, nº 179–181 (recusa 635 em 12/11/2026). Banco ISOLADO, dados sintéticos (série 97).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const SERIE = "97";
let master: Conta;

async function novoCiclo(n: number) {
  return adm.begin(async (tx) => {
    await tx.unsafe(`select set_config('lardan.test_uid','',true), set_config('lardan.test_role','',true)`);
    const kit = ((await tx.unsafe(`insert into public.kits (label) values ($1) returning id`, [`ISO 0318 ${marca} ${n}`])) as { id: string }[])[0]!;
    return ((await tx.unsafe(`insert into public.kit_cycles (kit_id, cycle_no, status) values ($1,1,'montagem') returning id`, [kit.id])) as { id: string }[])[0]!.id;
  });
}
const autorizada = (ref: string, numero: number) =>
  adm.unsafe(`insert into public.fiscal_focus_envios (ref, ambiente, operacao, status, payload, numero, serie) values ($1,'producao','remessa','autorizado','{}',$2,$3)`,
    [ref, String(numero), SERIE]);
const motivo = (ini: number, fim: number) =>
  um<{ m: string | null }>(`select public.fiscal_inutilizacao_faixa_motivo('producao',$1,$2,$3) m`, [SERIE, ini, fim]);
const registrar = (ini: number, fim: number, resposta: unknown, refs: string[]) =>
  um<{ r: { ok: boolean; resultado: string; recusas_baixadas: number } }>(
    `select public.fiscal_inutilizacao_registrar('producao',$1,$2,$3,'Numeracao nao utilizada: rejeitada 635',$4::text::jsonb,$5::text[],$6) r`,
    [SERIE, ini, fim, JSON.stringify(resposta), refs, master.uid]);

beforeAll(async () => {
  master = await criarConta({ nome: `iso-0318-master-${marca}`, papeis: ["master"], comParty: true });
  // série sintética: 10, 11 autorizadas; 12–14 puladas; 15 autorizada
  await adm.unsafe(`delete from public.fiscal_inutilizacoes where serie=$1`, [SERIE]);
  await adm.unsafe(`delete from public.fiscal_focus_envios where serie=$1`, [SERIE]);
  for (const n of [10, 11, 15]) await autorizada(`iso-0318-n${n}-${marca}`, n);
});

describe("0318: inutilização de números pulados", () => {
  test("faixa: só números passados, sem nota registrada, até 20", async () => {
    expect((await motivo(12, 14)).m).toBeNull();
    expect((await motivo(14, 16)).m).toContain("ficaram para trás");
    expect((await motivo(11, 13)).m).toContain("têm nota registrada");
    expect((await motivo(1, 30)).m).toContain("20 números");
  });

  test("usuário comum não chama as funções do servidor", async () => {
    const r = await rpc(master, "fiscal_inutilizacao_registrar", {
      _ambiente: "producao", _serie: SERIE, _ini: 12, _fim: 14, _justificativa: "x".repeat(20), _resposta: { status: "autorizado" }, _refs: [], _usuario: master.uid,
    });
    expect(r.ok).toBe(false);
  });

  test("SEFAZ disse 'número já utilizado' (241): nada é conferido e o número continua pulado", async () => {
    const c = await novoCiclo(1);
    const ref = `iso-0318-a-${marca}`;
    await adm.unsafe(`insert into public.fiscal_focus_envios (ref, ambiente, operacao, status, payload, cycle_id) values ($1,'producao','remessa','processando_autorizacao','{}',$2)`, [ref, c]);
    await adm.unsafe(`update public.fiscal_focus_envios set status='erro_autorizacao', status_sefaz='635' where ref=$1`, [ref]);
    const { r } = await registrar(12, 12, { status: "erro_autorizacao", status_sefaz: "241", mensagem_sefaz: "Rejeicao: Um numero da faixa ja foi utilizado" }, [ref]);
    expect(r.ok).toBe(false);
    expect(r.resultado).toBe("numero_usado");
    expect(r.recusas_baixadas).toBe(0);
    const conf = await um<{ n: number }>(`select count(*)::int n from public.fiscal_recusas_conferidas where ref=$1`, [ref]);
    expect(conf.n).toBe(0);
    expect((await motivo(12, 12)).m).toBeNull();
  });

  test("SEFAZ homologou (102): recusas marcadas viram 'não autorizada', a fila reabre e F11/pulados somem", async () => {
    const c = await novoCiclo(2);
    const ref = `iso-0318-b-${marca}`;
    await adm.unsafe(`insert into public.fiscal_focus_envios (ref, ambiente, operacao, status, payload, cycle_id) values ($1,'producao','remessa','processando_autorizacao','{}',$2)`, [ref, c]);
    await adm.unsafe(`insert into public.fiscal_fila (cycle_id, etapa, status) values ($1,'remessa','feito')`, [c]);
    await adm.unsafe(`update public.fiscal_focus_envios set status='erro_autorizacao', status_sefaz='635',
                        mensagem_sefaz='NF-e com mesmo numero e Serie ja transmitida e aguardando processamento' where ref=$1`, [ref]);
    expect((await um<{ status: string }>(`select status from public.fiscal_fila where cycle_id=$1`, [c])).status).toBe("erro");
    const { r } = await registrar(12, 14, { status: "autorizado", status_sefaz: "102", mensagem_sefaz: "Inutilizacao de numero homologado", protocolo: "141260000000001" }, [ref]);
    expect(r.ok).toBe(true);
    expect(r.resultado).toBe("inutilizada");
    expect(r.recusas_baixadas).toBe(1);
    const conf = await um<{ resultado: string; observacao: string }>(`select resultado, observacao from public.fiscal_recusas_conferidas where ref=$1`, [ref]);
    expect(conf.resultado).toBe("nao_autorizada");
    expect(conf.observacao).toContain("protocolo 141260000000001");
    expect((await um<{ status: string }>(`select status from public.fiscal_fila where cycle_id=$1`, [c])).status).toBe("pendente");
    // não pede a mesma faixa duas vezes
    expect((await motivo(13, 13)).m).toContain("já foi inutilizada");
    const pul = await rpc<{ serie: string; numero: number }[]>(master, "fiscal_numeros_pulados", {});
    expect(pul.erro).toBeNull();
    expect(pul.dados.some((x) => x.serie === SERIE)).toBe(false);
    const a = await rpc<{ itens?: { codigo: string; refs?: string[]; amostra?: string[] }[] }>(master, "auditoria_integridade", {});
    expect(JSON.stringify(a.dados)).not.toContain(`série ${SERIE} nº 13`);
    const hist = await rpc<{ serie: string; resultado: string }[]>(master, "fiscal_inutilizacoes_lista", {});
    expect(hist.dados.some((h) => h.serie === SERIE && h.resultado === "inutilizada")).toBe(true);
    const log = await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='fiscal.inutilizacao' and payload->'refs' ? $1 and payload->>'resultado'='inutilizada'`, [ref]);
    expect(log.n).toBe(1);
  });

  test("faixa que já estava inutilizada (256) também conta como confirmada", async () => {
    await autorizada(`iso-0318-n20-${marca}`, 20);
    const { r } = await registrar(16, 19, { status: "erro_autorizacao", status_sefaz: "256", mensagem_sefaz: "Rejeicao: Uma NF-e da faixa ja esta inutilizada na Base de dados da SEFAZ" }, []);
    expect(r.ok).toBe(true);
    expect(r.resultado).toBe("ja_inutilizada");
  });

  test("sem resposta da Focus: registra e deixa pedir de novo", async () => {
    await autorizada(`iso-0318-n30-${marca}`, 30);
    const { r } = await registrar(25, 25, {}, []);
    expect(r.ok).toBe(false);
    expect(r.resultado).toBe("sem_resposta");
    expect((await motivo(25, 25)).m).toBeNull();
  });
});
