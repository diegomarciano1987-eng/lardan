/**
 * 0402 — Lara (WhatsApp): conversas, fila, entrada, prazos, resultado e tela da equipe.
 * Banco ISOLADO, dados sintéticos. A Meta não é chamada: o teste faz o papel do servidor.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, isentarDaCaptacao, rpc, rpcServico, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, equipe: Conta, consultora: Conta, rep: Conta;
let seq = 0;
const tel = () => `4398${String(1000000 + Math.floor(Math.random() * 8999999))}`;

async function ligar(v: boolean) { await adm.unsafe(`insert into public.captacao_config (chave, valor) values ('lara_ativa', $1::text::jsonb) on conflict (chave) do update set valor = excluded.valor`, [JSON.stringify(v)]); }
async function lead(o: { zap?: string; rep?: boolean } = {}) {
  seq += 1;
  const st = await um<{ id: string }>(`select id from public.candidatura_stages where key='nova'`);
  const r = await um<{ id: string; zap: string }>(
    `insert into public.leads (full_name, first_name, whatsapp, city, uf, privacy_version, stage_id, protocol, dream, representante_party_id, representante_origem)
     values ($1,'MARIA',$2,'Londrina','PR','v1',$3,$4,'Comprar minha casa',$5,$6) returning id, whatsapp zap`,
    [`Maria ${marca} ${seq}`, o.zap ?? tel(), st.id, `CAP-${marca}-L${seq}`, o.rep ? rep.partyId : null, o.rep ? "manual" : null]);
  return r;
}
const fila = (l: string) => adm.unsafe(`select tipo, conteudo, registro, chave, enviado_em, cancelado_em from public.lara_fila where lead_id=$1 order by criado_em`, [l]) as Promise<{ tipo: string; conteudo: Record<string, unknown>; registro: string; chave: string | null; enviado_em: string | null; cancelado_em: string | null }[]>;
const conversa = (l: string) => um<{ estado: string; humano: boolean; opt_out: boolean; wa_id: string; nao_lidas: number; proxima_acao_em: string | null }>(`select * from public.lara_conversas where lead_id=$1`, [l]);
const etapa = async (l: string) => (await um<{ k: string }>(`select s.key k from public.leads l join public.candidatura_stages s on s.id=l.stage_id where l.id=$1`, [l])).k;
async function pegar(n = 100) {
  return ((await adm.begin(async (tx) => { await tx.unsafe(`set local role service_role`); return tx.unsafe(`select public.lara_fila_pegar(${n}) j`); })) as { j: { id: string; lead_id: string } }[]).map((x) => x.j);
}

beforeAll(async () => {
  master = await criarConta({ nome: `lara-master-${marca}`, papeis: ["master"], comParty: true });
  equipe = await criarConta({ nome: `lara-eq-${marca}`, papeis: ["master"], comParty: true });
  consultora = await criarConta({ nome: `lara-cons-${marca}`, papeis: ["consultora"], comParty: true });
  rep = await criarConta({ nome: `lara-rep-${marca}`, papeis: ["representante"], comParty: true });
});
afterAll(async () => { await ligar(false); });

describe("0402: início", () => {
  test("desligada: não abre conversa nem manda nada", async () => {
    await ligar(false);
    const l = await lead();
    const r = await rpcServico<{ iniciada: boolean; motivo: string }>("lara_iniciar", { _lead: l.id });
    expect(r.dados).toMatchObject({ iniciada: false, motivo: "lara_desligada" });
    expect(await fila(l.id)).toHaveLength(0);
  });

  test("ligada: mensagem 1 por modelo, com primeiro nome e sonho; etapa Conversa; idempotente", async () => {
    await ligar(true);
    const l = await lead();
    expect((await rpcServico<{ iniciada: boolean }>("lara_iniciar", { _lead: l.id })).dados!.iniciada).toBe(true);
    expect((await rpcServico<{ iniciada: boolean }>("lara_iniciar", { _lead: l.id })).dados!.iniciada).toBe(false);
    const f = await fila(l.id);
    expect(f).toHaveLength(1);
    expect(f[0]!.conteudo).toEqual({ template: "lara_candidatura_recebida", params: ["Maria", "Comprar minha casa"] });
    expect((await conversa(l.id)).wa_id).toBe(`55${l.zap}`);
    expect(await etapa(l.id)).toBe("conversa");
  });

  test("candidata de representante não recebe a Lara; pelo protocolo também funciona", async () => {
    const r = await lead({ rep: true });
    expect((await rpcServico<{ motivo: string }>("lara_iniciar", { _lead: r.id })).dados!.motivo).toBe("fora_do_site_ou_encerrada");
    const l = await lead();
    const p = await um<{ p: string }>(`select protocol p from public.leads where id=$1`, [l.id]);
    expect((await rpcServico<{ iniciada: boolean }>("lara_iniciar_protocolo", { _protocolo: p.p })).dados!.iniciada).toBe(true);
  });
});

describe("0402: fila e entrada", () => {
  test("pegar marca tentativa; concluir grava a mensagem enviada; falha definitiva vira 'falhou'", async () => {
    await ligar(true);
    const l = await lead();
    await rpcServico("lara_iniciar", { _lead: l.id });
    const itens = (await pegar()).filter((x) => x.lead_id === l.id);
    expect(itens).toHaveLength(1);
    expect((await pegar()).some((x) => x.lead_id === l.id)).toBe(false); // espera a próxima janela
    await rpcServico("lara_fila_concluir", { _id: itens[0]!.id, _wamid: `wamid.${marca}.${seq}`, _erro: null, _definitivo: false });
    const m = await um<{ n: number }>(`select count(*)::int n from public.lara_mensagens where lead_id=$1 and direcao='saida' and status='enviada'`, [l.id]);
    expect(m.n).toBe(1);

    const l2 = await lead();
    await rpcServico("lara_iniciar", { _lead: l2.id });
    const it2 = (await pegar()).find((x) => x.lead_id === l2.id)!;
    await rpcServico("lara_fila_concluir", { _id: it2.id, _wamid: null, _erro: "131026 sem WhatsApp", _definitivo: true });
    expect((await fila(l2.id))[0]!.cancelado_em).not.toBeNull();
    expect((await um<{ s: string }>(`select status s from public.lara_mensagens where lead_id=$1`, [l2.id])).s).toBe("falhou");
  });

  test("resposta acha a candidata mesmo sem o 9; duplicada é ignorada; status de entrega atualiza", async () => {
    await ligar(true);
    const l = await lead();
    await rpcServico("lara_iniciar", { _lead: l.id });
    const sem9 = `55${l.zap.slice(0, 2)}${l.zap.slice(3)}`;
    const wamid = `wamid.in.${marca}.${seq}`;
    const r = await rpcServico<{ lead_id: string; estado: string; nome: string; teste_concluido: boolean }>("lara_entrada", { _wa_id: sem9, _wamid: wamid, _tipo: "texto", _texto: "Sim! Vi no Instagram", _em: new Date().toISOString() });
    expect(r.dados).toMatchObject({ lead_id: l.id, estado: "msg1", nome: "Maria", teste_concluido: false });
    expect((await rpcServico<{ duplicada: boolean }>("lara_entrada", { _wa_id: sem9, _wamid: wamid, _tipo: "texto", _texto: "x" })).dados!.duplicada).toBe(true);
    const c = await conversa(l.id);
    expect(c).toMatchObject({ wa_id: sem9, nao_lidas: 1 });

    const out = `wamid.out.${marca}.${seq}`;
    await adm.unsafe(`insert into public.lara_mensagens (lead_id, wa_id, direcao, tipo, texto, autor, wa_message_id, status) values ($1,$2,'saida','texto','oi','lara',$3,'enviada')`, [l.id, sem9, out]);
    await rpcServico("lara_status", { _wamid: out, _status: "read" });
    await rpcServico("lara_status", { _wamid: out, _status: "delivered" });
    expect((await um<{ s: string }>(`select status s from public.lara_mensagens where wa_message_id=$1`, [out])).s).toBe("lida");
  });

  test("número sem candidatura: fica gravado sem candidata", async () => {
    const wa = `55${tel()}`;
    const r = await rpcServico<{ lead_id: string | null }>("lara_entrada", { _wa_id: wa, _wamid: `wamid.x.${marca}`, _tipo: "texto", _texto: "oi" });
    expect(r.dados!.lead_id).toBeNull();
  });
});

describe("0402: roteiro gravado pelo servidor", () => {
  test("transição: como conheceu vai para a ficha; teste move para a etapa Teste; pessoa e sair ficam registrados", async () => {
    await ligar(true);
    const l = await lead();
    await rpcServico("lara_iniciar", { _lead: l.id });
    await rpcServico("lara_transicao", { _lead: l.id, _estado: "msg2", _como_conheceu: "instagram" });
    expect((await um<{ c: string }>(`select como_conheceu c from public.leads where id=$1`, [l.id])).c).toBe("instagram");
    const quando = new Date(Date.now() + 48 * 3600_000).toISOString();
    await rpcServico("lara_transicao", { _lead: l.id, _estado: "teste", _proxima_em: quando });
    expect(await etapa(l.id)).toBe("teste");
    const tk = await rpcServico<string>("lara_teste_token", { _lead: l.id });
    expect(tk.dados).toMatch(/^[a-f0-9]{64}$/);
    expect((await rpcServico<string>("lara_teste_token", { _lead: l.id })).dados).toBe(tk.dados); // mesmo link aberto
    await rpcServico("lara_transicao", { _lead: l.id, _humano_motivo: "Dúvida sobre o teste" });
    expect((await conversa(l.id)).humano).toBe(true);
    await rpcServico("lara_transicao", { _lead: l.id, _opt_out: true });
    expect((await conversa(l.id)).opt_out).toBe(true);
    // quem saiu não recebe nada que estiver na fila
    await rpcServico("lara_enfileirar", { _lead: l.id, _wa: `55${l.zap}`, _tipo: "texto", _conteudo: { texto: "x" }, _registro: "x" });
    expect((await pegar()).some((x) => x.lead_id === l.id)).toBe(false);
    expect((await fila(l.id)).every((f) => f.enviado_em || f.cancelado_em)).toBe(true);
  });

  test("prazos: lembrete (modelo com link) no dia 2, expiração 3 dias depois, sem nova mensagem; teste feito para tudo", async () => {
    await ligar(true);
    const l = await lead();
    await rpcServico("lara_iniciar", { _lead: l.id });
    await rpcServico("lara_transicao", { _lead: l.id, _estado: "teste", _proxima_em: new Date(Date.now() - 60_000).toISOString() });
    const p1 = await rpcServico<{ lembretes: number }>("lara_prazos", {});
    expect(p1.dados!.lembretes).toBeGreaterThanOrEqual(1);
    const lem = (await fila(l.id)).find((f) => f.chave === `lembrete:${l.id}`)!;
    expect(lem.conteudo).toMatchObject({ template: "lara_lembrete_teste", params: ["Maria"] });
    expect(String(lem.conteudo["url"])).toMatch(/^[a-f0-9]{64}$/);
    expect((await conversa(l.id)).estado).toBe("lembrete");
    await adm.unsafe(`update public.lara_conversas set proxima_acao_em = now() - interval '1 minute' where lead_id=$1`, [l.id]);
    await rpcServico("lara_prazos", {});
    expect((await conversa(l.id)).estado).toBe("expirada");
    expect((await fila(l.id)).length).toBe(2); // msg1 + lembrete; expirar não manda nada

    const l2 = await lead();
    await rpcServico("lara_iniciar", { _lead: l2.id });
    await rpcServico("lara_transicao", { _lead: l2.id, _estado: "teste", _proxima_em: new Date(Date.now() + 3600_000).toISOString() });
    const t = await um<{ id: string }>(`insert into public.candidatura_testes (lead_id, token, origem, expira_em) values ($1, encode(gen_random_bytes(32),'hex'), 'site', now()+interval '10 days') returning id`, [l2.id]);
    await adm.unsafe(`update public.candidatura_testes set concluido_em = now(), resultado='{"semaforo_final":"verde"}' where id=$1`, [t.id]);
    expect(await conversa(l2.id)).toMatchObject({ estado: "teste_feito", proxima_acao_em: null });
  });

  test("resultado: aprovada recebe o modelo com o link dos documentos; recusada recebe o modelo e pode pedir revisão", async () => {
    await ligar(true);
    const a = await lead();
    await rpcServico("lara_iniciar", { _lead: a.id });
    // 0412: o modelo com o link dos documentos sai na pré-aprovação (teste + crédito ok); a aprovação final vem depois dos documentos
    await rpcServico("candidatura_documentos_link_garantir", { _lead: a.id });
    await rpcServico("lara_pre_aprovada", { _lead: a.id });
    expect((await fila(a.id)).filter((f) => f.chave === `aprovada:${a.id}`)).toHaveLength(1);
    await isentarDaCaptacao(a.id);
    await adm.unsafe(`update public.leads set outcome='ganha', won_at=now(), status='aprovado' where id=$1`, [a.id]);
    expect((await fila(a.id)).filter((f) => f.chave === `aprovada:${a.id}`)).toHaveLength(1); // não manda de novo
    const ap = (await fila(a.id)).find((f) => f.chave === `aprovada:${a.id}`)!;
    const doc = await um<{ t: string }>(`select token t from public.candidatura_documentos_link where lead_id=$1`, [a.id]);
    expect(ap.conteudo).toMatchObject({ template: "lara_aprovada_documentos", params: ["Maria"], url: doc.t });
    expect((await conversa(a.id)).estado).toBe("aprovada");

    const r = await lead();
    await rpcServico("lara_iniciar", { _lead: r.id });
    await adm.unsafe(`update public.leads set outcome='perdida', status='recusado' where id=$1`, [r.id]);
    expect((await fila(r.id)).some((f) => (f.conteudo["template"] as string) === "lara_resultado_candidatura")).toBe(true);
    await rpcServico("lara_revisao_pedir", { _lead: r.id, _texto: "Pedir revisão" });
    await rpcServico("lara_revisao_pedir", { _lead: r.id, _texto: "de novo" });
    expect((await um<{ n: number }>(`select count(*)::int n from public.captacao_revisao_pedidos where lead_id=$1 and resolvido_em is null`, [r.id])).n).toBe(1);
    expect(await conversa(r.id)).toMatchObject({ estado: "revisao_pedida", humano: true });

    // quem não falou com a Lara não recebe aviso de resultado
    const sem = await lead();
    await isentarDaCaptacao(sem.id);
    await adm.unsafe(`update public.leads set outcome='ganha' where id=$1`, [sem.id]);
    expect(await fila(sem.id)).toHaveLength(0);
  });
});

describe("0402: tela Conversas e permissões", () => {
  test("busca de conversa aceita nome sem acento e palavras fora de ordem", async () => {
    await ligar(true);
    const l = await lead();
    await adm.unsafe(`update public.leads set full_name=$1 where id=$2`, [`Fátima ${marca}`, l.id]);
    await rpcServico("lara_iniciar", { _lead: l.id });
    const lst = await rpc<{ itens: { lead_id: string }[] }>(master, "lara_conversas_lista", { _filtro: "todas", _busca: `${marca} fatima`, _limite: 300 });
    expect(lst.erro).toBeNull();
    expect(lst.dados!.itens.some((i) => i.lead_id === l.id)).toBe(true);
  });

  test("lista, ver (zera não lidas), assumir, responder só na janela de 24 h, resolver revisão", async () => {
    await ligar(true);
    const l = await lead();
    await rpcServico("lara_iniciar", { _lead: l.id });
    const lst = await rpc<{ itens: { lead_id: string }[] }>(master, "lara_conversas_lista", { _filtro: "todas", _busca: `Maria ${marca}`, _limite: 300 });
    expect(lst.erro).toBeNull();
    expect(lst.dados!.itens.some((i) => i.lead_id === l.id)).toBe(true);

    expect((await rpc(master, "lara_responder", { _lead: l.id, _texto: "Oi!" })).erro).toContain("24 horas");
    await rpcServico("lara_entrada", { _wa_id: `55${l.zap}`, _wamid: `wamid.r.${marca}.${seq}`, _tipo: "texto", _texto: "quanto ganho?" });
    const v = await rpc<{ mensagens: unknown[]; janela_aberta: boolean }>(master, "lara_conversa_ver", { _lead: l.id });
    expect(v.dados!.janela_aberta).toBe(true);
    expect((await conversa(l.id)).nao_lidas).toBe(0);
    expect((await rpc(equipe, "lara_responder", { _lead: l.id, _texto: "Oi, Maria! Aqui é o Daniel." })).erro).toBeNull();
    expect((await conversa(l.id)).humano).toBe(true);
    const ult = (await fila(l.id)).pop()!;
    expect(ult).toMatchObject({ tipo: "texto", registro: "Oi, Maria! Aqui é o Daniel." });
    expect((await rpc(master, "lara_assumir", { _lead: l.id, _assumir: false })).erro).toBeNull();
    expect((await conversa(l.id)).humano).toBe(false);
  });

  test("consultora não vê nem responde; ligar/desligar só Master; desligar cancela o que a Lara ia mandar", async () => {
    await ligar(true);
    const l = await lead();
    await rpcServico("lara_iniciar", { _lead: l.id });
    expect((await rpc(consultora, "lara_conversas_lista", { _filtro: "todas" })).ok).toBe(false);
    expect((await rpc(consultora, "lara_conversa_ver", { _lead: l.id })).ok).toBe(false);
    expect((await rpc(consultora, "lara_responder", { _lead: l.id, _texto: "x" })).ok).toBe(false);
    expect((await rpc(consultora, "lara_ligar", { _ativa: true })).ok).toBe(false);
    expect((await rpc(master, "lara_fila_pegar", { _n: 1 })).ok).toBe(false);
    expect((await rpc(master, "lara_entrada", { _wa_id: "5543999999999", _wamid: "x", _tipo: "texto", _texto: "x" })).ok).toBe(false);
    expect((await rpc(master, "lara_ligar", { _ativa: false })).erro).toBeNull();
    expect((await fila(l.id))[0]!.cancelado_em).not.toBeNull();
    expect((await rpc(master, "lara_ligar", { _ativa: true })).erro).toBeNull();
  });
});
