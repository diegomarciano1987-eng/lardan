/**
 * 0393 — fila de atendimento das candidaturas (ordem pelo semáforo do teste) e mapa de expansão.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const CIDADE = `Cidadela ${marca}`;
let master: Conta, consultora: Conta;
const ids: Record<string, string> = {};

async function novoLead(nome: string, horasAtras: number) {
  const st = await um<{ id: string }>(`select id from public.candidatura_stages where key='nova'`);
  const r = await um<{ id: string }>(
    `insert into public.leads (full_name, first_name, whatsapp, city, uf, privacy_version, stage_id, protocol, created_at)
     values ($1,$1,'43999990000',$2,'PR','v1',$3,$4, now() - make_interval(hours => $5)) returning id`,
    [nome, CIDADE, st.id, `F93-${marca}-${nome}`, horasAtras]);
  return r.id;
}
async function teste(lead: string, semaforo: string | null, ipl: number) {
  await adm.unsafe(
    `insert into public.candidatura_testes (lead_id, token, origem, expira_em, concluido_em, resultado)
     values ($1, encode(gen_random_bytes(32),'hex'), 'site', now() + interval '15 days', $2, $3::text::jsonb)`,
    [lead, semaforo ? new Date().toISOString() : null, semaforo ? JSON.stringify({ semaforo_final: semaforo, ipl }) : null]);
}

beforeAll(async () => {
  master = await criarConta({ nome: `f93-master-${marca}`, papeis: ["master"], comParty: true });
  consultora = await criarConta({ nome: `f93-cons-${marca}`, papeis: ["consultora"], comParty: true });
  ids.vermelha = await novoLead(`Vermelha ${marca}`, 50);
  ids.verdeBaixa = await novoLead(`VerdeBaixa ${marca}`, 10);
  ids.verdeAlta = await novoLead(`VerdeAlta ${marca}`, 1);
  ids.amarela = await novoLead(`Amarela ${marca}`, 40);
  ids.semTeste = await novoLead(`SemTeste ${marca}`, 60);
  ids.atendida = await novoLead(`Atendida ${marca}`, 70);
  await teste(ids.vermelha, "vermelho", 90);
  await teste(ids.verdeBaixa, "verde", 40);
  await teste(ids.verdeAlta, "verde", 80);
  await teste(ids.amarela, "amarelo", 95);
  await teste(ids.semTeste, null, 0); // link gerado, ainda não respondido
  await adm.unsafe(`update public.leads set first_response_at = now() where id=$1`, [ids.atendida]);
});

describe("0393: fila de atendimento", () => {
  test("ordem: verde (maior IPL primeiro) → amarelo → sem teste → vermelho; atendida fica fora", async () => {
    const r = await rpc<{ itens: { id: string; teste: { situacao: string; semaforo?: string } }[] }>(master, "crm_fila_atendimento", { _f: { q: marca } });
    expect(r.erro).toBeNull();
    const ordem = r.dados!.itens.map((i) => i.id);
    expect(ordem).toEqual([ids.verdeAlta, ids.verdeBaixa, ids.amarela, ids.semTeste, ids.vermelha]);
    expect(r.dados!.itens[3]!.teste.situacao).toBe("pendente");
  });

  test("sem permissão do módulo não lê a fila nem o mapa", async () => {
    expect((await rpc(consultora, "crm_fila_atendimento", {})).ok).toBe(false);
    expect((await rpc(consultora, "crm_expansao_cidades", {})).ok).toBe(false);
  });

  test("mapa de expansão: a cidade sem representante aparece com a contagem de abertas e de verdes", async () => {
    const r = await rpc<{ cidade: string; candidatas: number; verdes: number; motivo: string }[]>(master, "crm_expansao_cidades", {});
    expect(r.erro).toBeNull();
    const c = r.dados!.find((x) => x.cidade === CIDADE)!;
    expect(c.candidatas).toBe(6);
    expect(c.verdes).toBe(2);
    expect(c.motivo).toBe("cidade_fora_das_pracas");
  });

  test("o resumo do teste é interno (nem conta logada chama direto)", async () => {
    expect((await rpc(master, "crm_teste_resumo", { _lead: ids.verdeAlta })).ok).toBe(false);
  });
});
