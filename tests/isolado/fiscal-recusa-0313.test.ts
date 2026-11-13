/**
 * 0313 — nota recusada pela SEFAZ depois do envio volta sozinha para a fila.
 * Antes: a fila ficava 'feito' quando a Focus respondia "processando"; a recusa posterior deixava a maleta sem nota.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function novoCiclo(n: number) {
  const kit = await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [`ISO 0313 ${marca} ${n}`]);
  return (await um<{ id: string }>(`insert into public.kit_cycles (kit_id, cycle_no, status) values ($1,1,'montagem') returning id`, [kit.id])).id;
}
async function nota(ref: string, ciclo: string, status: string, operacao = "remessa", ambiente = "producao") {
  await adm.unsafe(`insert into public.fiscal_focus_envios (ref, ambiente, operacao, status, payload, cycle_id) values ($1,$2,$3,$4,'{}',$5)`,
    [ref, ambiente, operacao, status, ciclo]);
}
const fila = async (ciclo: string, etapa = "remessa") =>
  um<{ status: string; erro: string | null }>(`select status, erro from public.fiscal_fila where cycle_id=$1 and etapa=$2`, [ciclo, etapa]);

describe("0313: recusa da SEFAZ reabre a fila", () => {
  let c1 = "", c2 = "", c3 = "", c4 = "";
  beforeAll(async () => { c1 = await novoCiclo(1); c2 = await novoCiclo(2); c3 = await novoCiclo(3); c4 = await novoCiclo(4); });

  test("processando → erro_autorizacao: fila 'feito' volta para 'pendente' com o motivo", async () => {
    await nota(`iso-0313-a-${marca}`, c1, "processando_autorizacao");
    await adm.unsafe(`insert into public.fiscal_fila (cycle_id, etapa, status) values ($1,'remessa','feito')`, [c1]);
    await adm.unsafe(`update public.fiscal_focus_envios set status='erro_autorizacao', mensagem_sefaz='NF-e com mesmo numero e Serie ja transmitida' where ref=$1`, [`iso-0313-a-${marca}`]);
    const f = await fila(c1);
    expect(f.status).toBe("pendente");
    expect(f.erro).toContain("SEFAZ recusou");
  });

  test("nota autorizada não mexe na fila (continua 'feito')", async () => {
    await nota(`iso-0313-b-${marca}`, c2, "processando_autorizacao");
    await adm.unsafe(`insert into public.fiscal_fila (cycle_id, etapa, status) values ($1,'remessa','feito')`, [c2]);
    await adm.unsafe(`update public.fiscal_focus_envios set status='autorizado' where ref=$1`, [`iso-0313-b-${marca}`]);
    expect((await fila(c2)).status).toBe("feito");
  });

  test("denegada e homologação não reabrem", async () => {
    await nota(`iso-0313-c-${marca}`, c3, "processando_autorizacao");
    await nota(`iso-0313-c2-${marca}`, c3, "processando_autorizacao", "remessa", "homologacao");
    await adm.unsafe(`insert into public.fiscal_fila (cycle_id, etapa, status) values ($1,'remessa','feito')`, [c3]);
    await adm.unsafe(`update public.fiscal_focus_envios set status='denegado' where ref=$1`, [`iso-0313-c-${marca}`]);
    await adm.unsafe(`update public.fiscal_focus_envios set status='erro_autorizacao' where ref=$1`, [`iso-0313-c2-${marca}`]);
    expect((await fila(c3)).status).toBe("feito");
  });

  test("nota do acerto recusada reabre a etapa acerto; esgotadas 5 tentativas vira 'erro'", async () => {
    await nota(`iso-0313-d-${marca}`, c4, "processando_autorizacao", "venda");
    await adm.unsafe(`insert into public.fiscal_fila (cycle_id, etapa, status, tentativas) values ($1,'acerto','feito',5)`, [c4]);
    await adm.unsafe(`update public.fiscal_focus_envios set status='erro_autorizacao' where ref=$1`, [`iso-0313-d-${marca}`]);
    expect((await fila(c4, "acerto")).status).toBe("erro");
  });
});
