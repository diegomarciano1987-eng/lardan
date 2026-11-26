/**
 * 0395 — Captação: funil novo, site sem representante, canal Site/Representantes, decisão automática depois do teste + crédito.
 * Banco ISOLADO, dados sintéticos. A API da Assertiva não é chamada: a consulta entra pelo banco no formato da documentação.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, rpcServico, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, rep: Conta, consultora: Conta;
let seq = 0;

function cpfValido() {
  const b = String(100000000 + Math.floor(Math.random() * 899999999)).slice(0, 9).split("").map(Number);
  const dv = (d: number[]) => { const s = d.reduce((a, n, i) => a + n * (d.length + 1 - i), 0) % 11; return s < 2 ? 0 : 11 - s; };
  const d1 = dv(b); return [...b, d1, dv([...b, d1])].join("");
}
const nasc = (anos: number) => { const d = new Date(); d.setFullYear(d.getFullYear() - anos); d.setDate(d.getDate() - 20); return d.toISOString().slice(0, 10); };

async function lead(o: { idade?: number | null; repOrigem?: string | null; cidade?: string; email?: string | null } = {}) {
  seq += 1;
  const st = await um<{ id: string }>(`select id from public.candidatura_stages where key='nova'`);
  const r = await um<{ id: string }>(
    `insert into public.leads (full_name, first_name, whatsapp, city, uf, privacy_version, stage_id, protocol, cpf, data_nascimento, email, dream,
                               representante_party_id, representante_origem)
     values ($1,$1,'43999990000',$2,'PR','v1',$3,$4,$5,$6,$7,'Uma moto',$8,$9) returning id`,
    [`Cap ${marca} ${seq}`, o.cidade ?? "Londrina", st.id, `CAP-${marca}-${seq}`, cpfValido(),
     o.idade === null ? null : nasc(o.idade ?? 28), o.email === undefined ? `cap${seq}@ex.com` : o.email,
     o.repOrigem ? rep.partyId : null, o.repOrigem ?? null]);
  return r.id;
}
async function testeConcluido(l: string, semaforo: string, alertas: string[] = []) {
  const t = await um<{ id: string }>(
    `insert into public.candidatura_testes (lead_id, token, origem, expira_em, concluido_em, resultado)
     values ($1, encode(gen_random_bytes(32),'hex'), 'site', now() + interval '15 days', now(), $2::text::jsonb) returning id`,
    [l, JSON.stringify({ semaforo_final: semaforo, ipl: 60, alertas })]);
  await rpcServico("candidatura_teste_concluido", { _teste: t.id });
}
async function credito(l: string, score: number, protestos = 0) {
  await rpcServico("candidatura_credito_registrar", {
    _lead: l, _http: 200, _origem: "automatica", _usuario: null,
    _resposta: { cabecalho: { protocolo: "p" }, resposta: { score: { classe: "B", faixa: { titulo: "x" }, pontos: score }, protestosPublicos: { qtdProtestos: protestos } } },
  });
}
const estado = (l: string) => um<{ etapa: string; status: string; outcome: string }>(
  `select s.key etapa, l.status::text status, l.outcome from public.leads l join public.candidatura_stages s on s.id=l.stage_id where l.id=$1`, [l]);
const decidir = async (l: string) => {
  const r = await rpcServico<{ decisao: string; motivos: string[] }>("captacao_decidir", { _lead: l });
  if (r.erro) throw new Error(r.erro);
  return r;
};

beforeAll(async () => {
  master = await criarConta({ nome: `cap-master-${marca}`, papeis: ["master"], comParty: true });
  rep = await criarConta({ nome: `cap-rep-${marca}`, papeis: ["representante"], comParty: true });
  consultora = await criarConta({ nome: `cap-cons-${marca}`, papeis: ["consultora"], comParty: true });
});

describe("0395: funil e canal", () => {
  test("etapas na ordem nova; Primeiro contato e Perfil saem do funil", async () => {
    const e = (await adm.unsafe(`select key from public.candidatura_stages where is_active order by sort_order`)) as { key: string }[];
    expect(e.map((x) => x.key)).toEqual(["nova", "conversa", "teste", "avaliacao", "aprovada", "documentacao", "onboarding", "reprovada"]);
  });

  test("Site e Representantes separados pelo filtro do quadro", async () => {
    const site = await lead();
    const doRep = await lead({ repOrigem: "manual" });
    const s = await rpc<{ itens: { id: string }[] }>(master, "crm_list", { _f: { q: `Cap ${marca}`, canal: "site" }, _limit: 200, _offset: 0 });
    expect(s.erro).toBeNull();
    const ids = s.dados!.itens.map((i) => i.id);
    expect(ids).toContain(site);
    expect(ids).not.toContain(doRep);
    const r = await rpc<{ itens: { id: string }[] }>(master, "crm_list", { _f: { q: `Cap ${marca}`, canal: "representante" }, _limit: 200, _offset: 0 });
    expect(r.dados!.itens.map((i) => i.id)).toContain(doRep);
  });
});

describe("0395: decisão depois do teste e do crédito", () => {
  test("verde + score dentro da regra + sem alertas + dados completos → aprovada sozinha (Aprovada, ganha)", async () => {
    const l = await lead({ idade: 28 });
    await testeConcluido(l, "verde");
    expect((await estado(l)).etapa).toBe("avaliacao");
    expect((await decidir(l)).dados!.decisao).toBe("aguardando"); // ainda sem crédito
    await credito(l, 720);
    const d = await decidir(l);
    expect(d.dados!.decisao).toBe("aprovada_automatica");
    expect(await estado(l)).toEqual({ etapa: "aprovada", status: "aprovado", outcome: "ganha" });
  });

  test("amarelo, score baixo, sinal crítico, respostas rápidas, restrição escondida ou dado faltando → Análise do Daniel, nunca recusa", async () => {
    const casos: [string, () => Promise<string>][] = [
      ["Semáforo", async () => { const l = await lead(); await testeConcluido(l, "amarelo"); await credito(l, 800); return l; }],
      ["Crédito", async () => { const l = await lead({ idade: 25 }); await testeConcluido(l, "verde"); await credito(l, 600); return l; }],
      ["Sinal crítico", async () => { const l = await lead(); await testeConcluido(l, "verde", ["critico_o3"]); await credito(l, 800); return l; }],
      ["rápidas", async () => { const l = await lead(); await testeConcluido(l, "verde", ["disc_rapido"]); await credito(l, 800); return l; }],
      ["não tem restrição", async () => { const l = await lead(); await testeConcluido(l, "verde", ["cpf_declarado_nao"]); await credito(l, 800, 2); return l; }],
      ["incompletos", async () => { const l = await lead({ email: null }); await testeConcluido(l, "verde"); await credito(l, 800); return l; }],
    ];
    for (const [trecho, montar] of casos) {
      const l = await montar();
      const d = await decidir(l);
      expect(d.dados!.decisao).toBe("revisao");
      expect(d.dados!.motivos.join(" | ")).toContain(trecho);
      const e = await estado(l);
      expect(e).toEqual({ etapa: "avaliacao", status: "em_analise", outcome: "aberta" });
    }
  });

  test("sem data de nascimento o crédito pede revisão (regra por idade não se aplica)", async () => {
    const l = await lead({ idade: null });
    await testeConcluido(l, "verde");
    await credito(l, 900);
    expect((await decidir(l)).dados!.decisao).toBe("revisao");
  });

  test("candidata do representante passa pela mesma decisão; com maleta já entregue, a decisão é ignorada", async () => {
    const l = await lead({ repOrigem: "link" });
    await testeConcluido(l, "verde");
    await credito(l, 750);
    expect((await decidir(l)).dados!.decisao).toBe("aprovada_automatica");
    expect((await um<{ r: string }>(`select representante_party_id::text r from public.leads where id=$1`, [l])).r).toBe(rep.partyId);
  });

  test("candidatura encerrada não é decidida de novo", async () => {
    const l = await lead();
    await adm.unsafe(`update public.leads set outcome='perdida' where id=$1`, [l]);
    expect((await decidir(l)).dados!.decisao).toBe("ignorada");
  });

  test("fila: teste concluído entra; pegar marca tentativa; concluir tira da fila", async () => {
    const l = await lead();
    await testeConcluido(l, "verde");
    const pegar = async () => ((await adm.begin(async (tx) => {
      await tx.unsafe(`set local role service_role`);
      return tx.unsafe(`select public.captacao_fila_pegar(50) id`);
    })) as { id: string }[]).map((x) => x.id);
    expect(await pegar()).toContain(l);
    expect(await pegar()).not.toContain(l); // já pego: espera a próxima janela
    await rpcServico("captacao_fila_concluir", { _lead: l, _erro: null });
    expect((await um<{ n: number }>(`select count(*)::int n from public.captacao_fila where lead_id=$1 and feito_em is null`, [l])).n).toBe(0);
  });

  test("sem CPF válido: vai direto para a revisão, com o motivo", async () => {
    const l = await lead();
    await rpcServico("captacao_revisar", { _lead: l, _motivo: "Candidatura sem CPF válido." });
    const v = await rpc<{ ultima: { decisao: string; motivos: string[] } }>(master, "captacao_decisao_ver", { _lead: l });
    expect(v.dados!.ultima.decisao).toBe("revisao");
    expect(v.dados!.ultima.motivos[0]).toContain("CPF");
  });
});

describe("0395: permissões e site sem representante", () => {
  test("decidir, fila e revisão são só do servidor; a ficha exige candidaturas.view", async () => {
    const l = await lead();
    expect((await rpc(master, "captacao_decidir", { _lead: l })).ok).toBe(false);
    expect((await rpc(master, "captacao_fila_pegar", { _n: 1 })).ok).toBe(false);
    expect((await rpc(consultora, "captacao_decisao_ver", { _lead: l })).ok).toBe(false);
  });

  test("candidatura do site em cidade com representante único NÃO vai para ele", async () => {
    const l = await lead({ cidade: "Ibaiti" });
    const r = await um<{ rep: string | null; o: string | null }>(`select representante_party_id::text rep, representante_origem o from public.leads where id=$1`, [l]);
    expect(r).toEqual({ rep: null, o: null });
  });

  test("Daniel aprovando na Análise leva a candidata para a etapa Aprovada", async () => {
    const l = await lead();
    await testeConcluido(l, "amarelo");
    await credito(l, 800);
    await decidir(l);
    const r = await rpc(master, "crm_mark_won", { _lead: l, _nota: "revisado" });
    expect(r.erro).toBeNull();
    expect(await estado(l)).toEqual({ etapa: "aprovada", status: "aprovado", outcome: "ganha" });
  });
});
