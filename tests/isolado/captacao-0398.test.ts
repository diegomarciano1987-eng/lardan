/**
 * 0398 — Captação: teste + aprovação obrigatórios no app do representante antes da maleta,
 * página de documentos da aprovada e tela Aprovadas (Correios ou representante).
 * Banco ISOLADO, dados sintéticos. Nenhum arquivo é enviado ao Storage: o banco recebe só os caminhos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, rpcServico, type Conta, enviarDocumentosCandidata, isentarDaCaptacao } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, rep: Conta, repOutro: Conta, consultora: Conta;
let deposito = "", variante = "", praca = "", remessa = "";
let seq = 0;

function cpfValido() {
  const b = String(100000000 + Math.floor(Math.random() * 899999999)).slice(0, 9).split("").map(Number);
  const dv = (d: number[]) => { const s = d.reduce((a, n, i) => a + n * (d.length + 1 - i), 0) % 11; return s < 2 ? 0 : 11 - s; };
  const d1 = dv(b); return [...b, d1, dv([...b, d1])].join("");
}
const zap = () => `4398${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

async function maletaComRep() {
  const ab = await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta_representante", { _remessa: remessa });
  const c = ab.dados!.cycle_id;
  await rpc(master, "kit_item_upsert", { _cycle: c, _variant: variante, _qty: 1 });
  await rpc(master, "kit_conferir", { _cycle: c, _note: null });
  await rpc(master, "kit_expedir", { _cycle: c, _payload: { rota: "representante" } });
  const t = (await um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 order by seq desc limit 1`, [c])).id;
  await rpc(rep, "kit_transfer_confirm", { _transfer: t, _payload: {} });
  return c;
}
async function cadastroNaRua() {
  seq += 1;
  const cpf = cpfValido();
  const r = await rpc<{ lead_id: string; party_id: string }>(rep, "rep_abertura_rua_cadastrar", {
    _rep: rep.partyId,
    _dados: { nome: `Rua ${marca} ${seq} Silva`, cpf, nascimento: "1990-05-10", estado_civil: "Solteira", whatsapp: zap(), email: `rua${seq}${marca}@ex.com`,
              cep: "86000000", rua: "Rua A", numero: "10", bairro: "Centro", cidade: "Londrina", uf: "PR" },
    _perfil: { metas: 3, comunicacao: 3, organizacao: 2, pontualidade: 3 },
  });
  if (r.erro) throw new Error(r.erro);
  return r.dados!;
}
async function testeConcluido(l: string, semaforo: string) {
  const t = await um<{ id: string }>(
    `insert into public.candidatura_testes (lead_id, token, origem, expira_em, concluido_em, resultado)
     values ($1, encode(gen_random_bytes(32),'hex'), 'representante', now() + interval '15 days', now(), $2::text::jsonb) returning id`,
    [l, JSON.stringify({ semaforo_final: semaforo, ipl: 60, alertas: [] })]);
  // o link aberto (gerado antes) é o que ela concluiu
  await adm.unsafe(`update public.candidatura_testes set cancelado_em = now() where lead_id=$1 and concluido_em is null`, [l]);
  await rpcServico("candidatura_teste_concluido", { _teste: t.id });
}
async function credito(l: string, score: number) {
  await rpcServico("candidatura_credito_registrar", {
    _lead: l, _http: 200, _origem: "automatica", _usuario: null,
    _resposta: { cabecalho: { protocolo: "p" }, resposta: { score: { classe: "B", faixa: { titulo: "x" }, pontos: score }, protestosPublicos: { qtdProtestos: 0 } } },
  });
}
const situacao = async (l: string, quem: Conta = rep) => {
  const r = await rpc<Record<string, unknown>>(quem, "rep_candidata_situacao", { _rep: rep.partyId, _lead: l });
  return r;
};
async function leadSite(o: { aprovada?: boolean; repOrigem?: string | null } = {}) {
  seq += 1;
  const st = await um<{ id: string }>(`select id from public.candidatura_stages where key='aprovada'`);
  const r = await um<{ id: string }>(
    `insert into public.leads (full_name, first_name, whatsapp, city, uf, privacy_version, stage_id, protocol, cpf, email, dream, representante_party_id, representante_origem)
     values ($1,'Site',$2,'Maringá','PR','v1',$3,$4,$5,'s@ex.com','Casa', $6, $7) returning id`,
    [`Site ${marca} ${seq}`, zap(), st.id, `CAP-${marca}-S${seq}`, cpfValido(), o.repOrigem ? rep.partyId : null, o.repOrigem ?? null]);
  if (o.aprovada !== false) {
    await isentarDaCaptacao(r.id); // cenário da tela Aprovadas: já aprovada
    await adm.unsafe(`update public.leads set outcome='ganha', won_at=now(), status='aprovado' where id=$1`, [r.id]);
  }
  return r.id;
}
const token = async (l: string) => (await um<{ t: string | null }>(`select token t from public.candidatura_documentos_link where lead_id=$1`, [l]))?.t ?? null;

beforeAll(async () => {
  master = await criarConta({ nome: `c96-master-${marca}`, papeis: ["master"], comParty: true });
  rep = await criarConta({ nome: `c96-rep-${marca}`, papeis: ["representante"], comParty: true });
  repOutro = await criarConta({ nome: `c96-rep2-${marca}`, papeis: ["representante"], comParty: true });
  consultora = await criarConta({ nome: `c96-cons-${marca}`, papeis: ["consultora"], comParty: true });
  await adm.unsafe(`insert into public.party_roles (party_id, role, status, started_at) values ($1,'representante','ativo',current_date) on conflict do nothing`, [rep.partyId]);
  deposito = await criarDeposito(`c96-${marca}`);
  variante = await criarVariante(`c96-${marca}`, 10000);
  await porEstoque(variante, deposito, 50);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`C96 ${marca}`])).linhas[0]!.id;
  remessa = (await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito,
    _data_acerto: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10) })).dados!.id;
});

describe("0398: app do representante — teste e aprovação antes da maleta", () => {
  test("cadastro na rua fica em análise, grava a data de nascimento e não aparece como aprovada", async () => {
    const { lead_id } = await cadastroNaRua();
    const l = await um<{ status: string; nasc: string; col: string | null }>(
      `select l.status::text status, l.data_nascimento::text nasc, public.rep_crm_coluna_sistema(l) col from public.leads l where id=$1`, [lead_id]);
    expect(l).toEqual({ status: "em_analise", nasc: "1990-05-10", col: null });
  });

  test("fluxo completo: sem teste → teste em andamento → aguardando → análise → documentos → representante aprova → maleta", async () => {
    const { lead_id } = await cadastroNaRua();
    const maleta = await maletaComRep();
    const negado = await rpc(rep, "rep_maleta_repassar", { _rep: rep.partyId, _cycle: maleta, _lead: lead_id });
    expect(negado.erro).toContain("ainda não foi aprovada pela Lardan");

    expect((await situacao(lead_id)).dados).toMatchObject({ situacao: "sem_teste", liberada: false });
    const g = await rpc<{ token: string }>(rep, "candidatura_teste_gerar", { _lead: lead_id });
    expect(g.erro).toBeNull();
    const s1 = (await situacao(lead_id)).dados!;
    expect(s1).toMatchObject({ situacao: "teste_em_andamento", teste_token: g.dados!.token });

    await testeConcluido(lead_id, "amarelo");
    expect((await situacao(lead_id)).dados).toMatchObject({ situacao: "aguardando_decisao", teste_token: null });
    await credito(lead_id, 800);
    const d = await rpcServico<{ decisao: string }>("captacao_decidir", { _lead: lead_id });
    expect(d.dados!.decisao).toBe("revisao");
    const s2 = (await situacao(lead_id)).dados!;
    expect(s2.situacao).toBe("analise");
    // 0412: o representante vê o resumo (teste e crédito) para poder decidir; sem documentos ainda não aprova
    expect(s2.resumo).toMatchObject({ semaforo: "amarelo", credito: "dentro", score: 800 });
    expect(s2).toMatchObject({ pode_aprovar: false, falta: ["os documentos (4 fotos)"] });
    // 0427: na Análise ninguém recebe pedido de documentos sozinho; o representante pede se for seguir (crédito dentro da regra)
    expect(s2.documentos_token).toBeNull();
    expect(s2.pode_pedir_documentos).toBe(true);
    expect((await rpc(repOutro, "rep_candidata_pedir_documentos", { _rep: repOutro.partyId, _lead: lead_id })).erro).toContain("não é sua");
    expect((await rpc(rep, "rep_candidata_pedir_documentos", { _rep: rep.partyId, _lead: lead_id })).erro).toBeNull();
    expect(String((await situacao(lead_id)).dados!.documentos_token)).toMatch(/^[a-f0-9]{64}$/);
    expect((await rpc(rep, "rep_candidata_aprovar", { _rep: rep.partyId, _lead: lead_id, _nota: null })).erro).toContain("os documentos");
    expect((await rpc(master, "crm_mark_won", { _lead: lead_id, _nota: "ok" })).erro).toContain("os documentos");

    expect((await enviarDocumentosCandidata(lead_id)).aprovada).toBe(false);
    expect((await situacao(lead_id)).dados).toMatchObject({ situacao: "analise", pode_aprovar: true, documentos_enviados: true });
    expect((await rpc(repOutro, "rep_candidata_aprovar", { _rep: repOutro.partyId, _lead: lead_id, _nota: null })).erro).toContain("não é sua");
    expect((await rpc(rep, "rep_candidata_aprovar", { _rep: rep.partyId, _lead: lead_id, _nota: "conheço a família" })).erro).toBeNull();
    const s3 = (await situacao(lead_id)).dados!;
    expect(s3).toMatchObject({ situacao: "aprovada", liberada: true });
    const aud = await um<{ n: number }>(`select count(*)::int n from public.audit_logs where action='captacao.aprovada_representante' and entity_id=$1`, [lead_id]);
    expect(aud.n).toBe(1);
    const col = await um<{ c: string }>(`select public.rep_crm_coluna_sistema(l) c from public.leads l where id=$1`, [lead_id]);
    expect(col.c).toBe("aprovada");

    const ok = await rpc(rep, "rep_maleta_repassar", { _rep: rep.partyId, _cycle: maleta, _lead: lead_id });
    expect(ok.erro).toBeNull();
  });

  test("aprovação automática também libera; reprovada nunca recebe", async () => {
    const a = await cadastroNaRua();
    await testeConcluido(a.lead_id, "verde");
    await credito(a.lead_id, 750);
    expect((await rpcServico<{ decisao: string }>("captacao_decidir", { _lead: a.lead_id })).dados!.decisao).toBe("aprovada_automatica");
    // 0412: pré-aprovada; a maleta só libera quando os documentos chegam (e aí aprova sozinha)
    expect((await situacao(a.lead_id)).dados).toMatchObject({ situacao: "documentos", liberada: false });
    const mPre = await maletaComRep();
    expect((await rpc(rep, "rep_maleta_repassar", { _rep: rep.partyId, _cycle: mPre, _lead: a.lead_id })).erro).toContain("ainda não foi aprovada");
    expect((await enviarDocumentosCandidata(a.lead_id)).aprovada).toBe(true);
    expect((await situacao(a.lead_id)).dados).toMatchObject({ situacao: "aprovada", liberada: true });

    const b = await cadastroNaRua();
    await adm.unsafe(`update public.leads set outcome='perdida', status='recusado' where id=$1`, [b.lead_id]);
    expect((await situacao(b.lead_id)).dados).toMatchObject({ situacao: "reprovada", liberada: false });
    const m = await maletaComRep();
    expect((await rpc(rep, "rep_maleta_repassar", { _rep: rep.partyId, _cycle: m, _lead: b.lead_id })).erro).toContain("ainda não foi aprovada");
  });

  test("quem já estava aprovada antes da 0398 (isenta) continua recebendo a maleta", async () => {
    const { lead_id } = await cadastroNaRua();
    await adm.unsafe(`insert into public.captacao_gate_isentas (lead_id, motivo) values ($1,'teste')`, [lead_id]);
    expect((await situacao(lead_id)).dados).toMatchObject({ situacao: "aprovada", liberada: true, isenta: true });
    const m = await maletaComRep();
    expect((await rpc(rep, "rep_maleta_repassar", { _rep: rep.partyId, _cycle: m, _lead: lead_id })).erro).toBeNull();
  });

  test("crédito fora da regra: o representante não aprova, só a Lardan", async () => {
    const { lead_id } = await cadastroNaRua();
    await testeConcluido(lead_id, "verde");
    await credito(lead_id, 300);
    expect((await rpcServico<{ decisao: string }>("captacao_decidir", { _lead: lead_id })).dados!.decisao).toBe("revisao");
    await enviarDocumentosCandidata(lead_id);
    expect((await situacao(lead_id)).dados).toMatchObject({ situacao: "analise", pode_aprovar: false, pode_pedir_documentos: false });
    expect((await rpc(rep, "rep_candidata_pedir_documentos", { _rep: rep.partyId, _lead: lead_id })).erro).toContain("decide se pede");
    expect((await rpc(rep, "rep_candidata_aprovar", { _rep: rep.partyId, _lead: lead_id, _nota: null })).erro).toContain("só a Lardan");
    expect((await rpc(master, "crm_mark_won", { _lead: lead_id, _nota: "Daniel conferiu" })).erro).toBeNull();
  });

  test("sem teste não tem como aprovar, nem pelo quadro (etapa Aprovada/Maleta)", async () => {
    const { lead_id } = await cadastroNaRua();
    expect((await rpc(master, "crm_mark_won", { _lead: lead_id, _nota: "na confiança" })).erro).toContain("o teste DISC");
    const ap = await um<{ id: string }>(`select id from public.candidatura_stages where key='aprovada'`);
    await expect(adm.unsafe(`update public.leads set stage_id=$2 where id=$1`, [lead_id, ap.id])).rejects.toThrow("Ainda não dá para aprovar");
  });

  test("situação só para o dono da carteira", async () => {
    const { lead_id } = await cadastroNaRua();
    expect((await rpc(repOutro, "rep_candidata_situacao", { _rep: rep.partyId, _lead: lead_id })).ok).toBe(false);
    expect((await rpc(repOutro, "rep_candidata_situacao", { _rep: repOutro.partyId, _lead: lead_id })).erro).toContain("não é sua");
  });

  test("representante não pega candidata do site pelo WhatsApp", async () => {
    const l = await leadSite({ aprovada: false });
    const w = (await um<{ w: string }>(`select whatsapp w from public.leads where id=$1`, [l])).w;
    const r = await rpc(rep, "rep_crm_lead_criar", { _rep: rep.partyId, _nome: "Fulana Teste", _whatsapp: w, _cidade: "Maringá", _uf: "PR", _nota: null });
    expect(r.erro).toContain("candidatou pelo site");
    expect((await um<{ r: string | null }>(`select representante_party_id::text r from public.leads where id=$1`, [l])).r).toBeNull();
  });
});

describe("0398: documentos da aprovada", () => {
  test("link só depois da Assertiva (0427): teste sozinho não pede; a equipe pede depois da consulta; página, envio, conferência e reenvio", async () => {
    const l = await leadSite({ aprovada: false });
    expect(await token(l)).toBeNull();
    await testeConcluido(l, "amarelo");
    expect(await token(l)).toBeNull(); // concluir o teste não pede documentos
    expect((await rpc(master, "candidatura_documentos_link_gerar", { _lead: l })).erro).toContain("depois da consulta");
    await credito(l, 800);
    expect((await rpc(master, "candidatura_documentos_link_gerar", { _lead: l })).erro).toBeNull();
    const t = (await token(l))!;
    expect(t).toMatch(/^[a-f0-9]{64}$/);

    const ab = await rpcServico<{ primeiro_nome: string; itens: unknown[] }>("candidatura_documentos_abrir", { _token: t });
    expect(ab.dados).toMatchObject({ primeiro_nome: "Site", itens: [] });
    expect(JSON.stringify(ab.dados)).not.toContain("CAP-");

    expect((await rpcServico("candidatura_documento_caminho", { _token: t, _tipo: "selfie", _ext: "pdf" })).erro).toContain("formato_invalido");
    expect((await rpcServico("candidatura_documento_caminho", { _token: t, _tipo: "outro", _ext: "jpg" })).erro).toContain("tipo_invalido");
    expect((await rpcServico("candidatura_documento_registrar", { _token: t, _tipo: "selfie", _path: `outro/selfie/${"a".repeat(32)}.jpg`, _mime: "image/jpeg", _bytes: 100 })).erro).toContain("arquivo_invalido");

    const ids: Record<string, string> = {};
    for (const tipo of ["documento", "comprovante", "selfie"]) {
      const c = await rpcServico<string>("candidatura_documento_caminho", { _token: t, _tipo: tipo, _ext: tipo === "comprovante" ? "pdf" : "jpg" });
      expect(c.dados!).toMatch(new RegExp(`^${l}/${tipo}/[a-f0-9]{32}\\.(jpg|pdf)$`));
      ids[tipo] = (await rpcServico<{ id: string }>("candidatura_documento_registrar", { _token: t, _tipo: tipo, _path: c.dados, _mime: "image/jpeg", _bytes: 2000 })).dados!.id;
    }
    expect((await rpcServico("candidatura_documentos_finalizar", { _token: t })).erro).toContain("faltam_documentos");
    const cf = await rpcServico<string>("candidatura_documento_caminho", { _token: t, _tipo: "fachada", _ext: "jpg" });
    await rpcServico("candidatura_documento_registrar", { _token: t, _tipo: "fachada", _path: cf.dados, _mime: "image/jpeg", _bytes: 3000 });
    expect((await rpcServico("candidatura_documentos_finalizar", { _token: t })).erro).toBeNull();
    // sem decisão automática ninguém aprova sozinho: os documentos chegam e ela continua aberta para a análise
    expect((await um<{ o: string }>(`select outcome o from public.leads where id=$1`, [l])).o).toBe("aberta");

    // equipe confere: selfie ok, comprovante pedido de novo (motivo obrigatório) reabre a página
    expect((await rpc(master, "candidatura_documento_conferir", { _doc: ids.selfie, _ok: true, _motivo: null })).erro).toBeNull();
    expect((await rpc(master, "candidatura_documento_conferir", { _doc: ids.comprovante, _ok: false, _motivo: "" })).erro).toContain("refazer");
    expect((await rpc(master, "candidatura_documento_conferir", { _doc: ids.comprovante, _ok: false, _motivo: "Comprovante cortado" })).erro).toBeNull();
    const ab2 = await rpcServico<{ finalizado_em: string | null; itens: { tipo: string; situacao: string; motivo: string | null }[] }>("candidatura_documentos_abrir", { _token: t });
    expect(ab2.dados!.finalizado_em).toBeNull();
    expect(ab2.dados!.itens.find((i) => i.tipo === "comprovante")).toMatchObject({ situacao: "refazer", motivo: "Comprovante cortado" });
    expect((await rpcServico("candidatura_documentos_finalizar", { _token: t })).erro).toContain("faltam_documentos");
    // item conferido não é trocado; o pedido de novo é
    expect((await rpcServico("candidatura_documento_caminho", { _token: t, _tipo: "selfie", _ext: "jpg" })).erro).toContain("ja_conferido");
    const c2 = await rpcServico<string>("candidatura_documento_caminho", { _token: t, _tipo: "comprovante", _ext: "jpg" });
    await rpcServico("candidatura_documento_registrar", { _token: t, _tipo: "comprovante", _path: c2.dados, _mime: "image/jpeg", _bytes: 900 });
    expect((await rpcServico("candidatura_documentos_finalizar", { _token: t })).erro).toBeNull();
    const n = await um<{ n: number }>(`select count(*)::int n from public.candidatura_documentos where lead_id=$1 and tipo='comprovante'`, [l]);
    expect(n.n).toBe(2); // o anterior fica guardado como substituído

    const ver = await rpc<{ itens: { tipo: string; situacao: string }[] }>(master, "candidatura_documentos_ver", { _lead: l });
    expect(ver.dados!.itens.map((i) => `${i.tipo}:${i.situacao}`).sort()).toEqual(["comprovante:enviado", "documento:enviado", "fachada:enviado", "selfie:conferido"]);
    expect((await rpc(consultora, "candidatura_documentos_ver", { _lead: l })).ok).toBe(false);
    expect((await rpc(consultora, "candidatura_documento_conferir", { _doc: ids.documento, _ok: true })).ok).toBe(false);
  });

  test("link vale só para aprovada, dentro do prazo; funções públicas só pelo servidor", async () => {
    const l = await leadSite();
    const t = (await token(l))!;
    expect((await rpc(master, "candidatura_documentos_abrir", { _token: t })).ok).toBe(false);
    expect((await rpc(consultora, "candidatura_documento_caminho", { _token: t, _tipo: "selfie", _ext: "jpg" })).ok).toBe(false);
    await adm.unsafe(`update public.candidatura_documentos_link set expira_em = now() - interval '1 minute' where lead_id=$1`, [l]);
    expect((await rpcServico("candidatura_documentos_abrir", { _token: t })).erro).toContain("link_vencido");
    // equipe renova
    const novo = await rpc<string>(master, "candidatura_documentos_link_gerar", { _lead: l });
    expect(novo.dados).not.toBe(t);
    expect((await rpcServico("candidatura_documentos_abrir", { _token: novo.dados })).erro).toBeNull();
    await adm.unsafe(`update public.leads set outcome='perdida' where id=$1`, [l]);
    expect((await rpcServico("candidatura_documentos_abrir", { _token: novo.dados })).erro).toContain("link_invalido");
    expect((await rpcServico("candidatura_documentos_abrir", { _token: "x" })).erro).toContain("link_invalido");
  });
});

describe("0398: Aprovadas — Correios ou representante", () => {
  test("lista aprovadas do site sem maleta, com a situação dos documentos", async () => {
    const l = await leadSite();
    const doRep = await leadSite({ repOrigem: "manual" });
    const s = await rpc<{ id: string; docs: { token: string | null; enviados: number } }[]>(master, "captacao_aprovadas", { _canal: "site" });
    expect(s.erro).toBeNull();
    const item = s.dados!.find((x) => x.id === l)!;
    expect(item.docs.enviados).toBe(0);
    expect(item.docs.token).toMatch(/^[a-f0-9]{64}$/);
    expect(s.dados!.some((x) => x.id === doRep)).toBe(false);
    const r = await rpc<{ id: string }[]>(master, "captacao_aprovadas", { _canal: "representante" });
    expect(r.dados!.some((x) => x.id === doRep)).toBe(true);
    expect((await rpc(consultora, "captacao_aprovadas", { _canal: "site" })).ok).toBe(false);
  });

  test("Daniel encaminha para um representante (continua canal site) e pode trocar para Correios", async () => {
    const l = await leadSite();
    const reps = await rpc<{ id: string }[]>(master, "captacao_representantes", {});
    expect(reps.dados!.some((x) => x.id === rep.partyId)).toBe(true);
    const e = await rpc<{ modo: string }>(master, "captacao_envio_definir", { _lead: l, _modo: "representante", _rep: rep.partyId, _nota: "perto dele" });
    expect(e.erro).toBeNull();
    let v = await um<{ r: string; o: string; c: string }>(`select representante_party_id::text r, representante_origem o, public.captacao_canal(l) c from public.leads l where id=$1`, [l]);
    expect(v).toEqual({ r: rep.partyId!, o: "encaminhada", c: "site" });
    // aprovada pela Lardan: o representante já pode entregar a maleta
    expect((await situacao(l)).dados).toMatchObject({ situacao: "aprovada", liberada: true });

    expect((await rpc(master, "captacao_envio_definir", { _lead: l, _modo: "correios", _rep: null, _nota: null })).erro).toBeNull();
    v = await um(`select representante_party_id::text r, representante_origem o, public.captacao_canal(l) c from public.leads l where id=$1`, [l]);
    expect(v).toEqual({ r: null as unknown as string, o: null as unknown as string, c: "site" });
    const lista = await rpc<{ id: string; envio: { modo: string } | null }[]>(master, "captacao_aprovadas", { _canal: "site" });
    expect(lista.dados!.find((x) => x.id === l)!.envio!.modo).toBe("correios");
  });

  test("recusas: candidata do representante, não aprovada, sem representante, sem permissão", async () => {
    const doRep = await leadSite({ repOrigem: "link" });
    expect((await rpc(master, "captacao_envio_definir", { _lead: doRep, _modo: "correios" })).erro).toContain("volta para ele");
    const naoAprovada = await leadSite({ aprovada: false });
    expect((await rpc(master, "captacao_envio_definir", { _lead: naoAprovada, _modo: "correios" })).erro).toContain("Só candidata aprovada");
    const l = await leadSite();
    expect((await rpc(master, "captacao_envio_definir", { _lead: l, _modo: "representante", _rep: null })).erro).toContain("Escolha o representante");
    expect((await rpc(master, "captacao_envio_definir", { _lead: l, _modo: "representante", _rep: consultora.partyId })).erro).toContain("não é representante");
    expect((await rpc(consultora, "captacao_envio_definir", { _lead: l, _modo: "correios" })).ok).toBe(false);
  });
});
