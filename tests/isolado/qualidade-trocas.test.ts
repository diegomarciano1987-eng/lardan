/**
 * 0237/0238 — Canal de Qualidade (trocas e garantias), mão dupla consultora <-> Lardan. Banco ISOLADO, dados sintéticos.
 *  1. Consultora abre pelo app (peça do catálogo); repetir a mesma chave não duplica; garantia exige foto; foto de outra conta é recusada.
 *  2. Outra consultora não vê a troca nem a conversa; consultora não altera situação nem escreve direto na tabela.
 *  3. Lardan (qualidade) lança manualmente para a consultora e ela vê no app.
 *  4. Devolutiva: troca por peça mais cara calcula diferença (devolvida - enviada); recusa exige motivo; finalizar exige solução.
 *  5. Nota interna não aparece para a consultora; mensagem da consultora acende novidade para a Lardan e vice-versa.
 *  6. Busca por código da consultora e por referência; nada mexe em estoque ou caixa.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarVariante, rpc, ler, escritaDireta, type Conta } from "./base";

const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let eu: Conta, outra: Conta, qual: Conta;
let barata: string, cara: string;
const abrir = (over: Record<string, unknown> = {}) => ({ _variant: barata, _referencia: null, _tamanho: null, _tipo: "troca", _motivo: "Escureceu", _observacao: "", _fotos: [], _chave: crypto.randomUUID(), ...over });

beforeAll(async () => {
  eu = await criarConta({ nome: `qt-eu-${marca}`, papeis: ["consultora"], comParty: true });
  outra = await criarConta({ nome: `qt-outra-${marca}`, papeis: ["consultora"], comParty: true });
  qual = await criarConta({ nome: `qt-qual-${marca}`, papeis: ["qualidade"], comParty: true });
  await adm.unsafe(`update parties set code=$2 where id=$1`, [eu.partyId, `Q${marca}`]);
  await adm.unsafe(`insert into party_roles(party_id, role) values ($1,'consultora') on conflict do nothing`, [eu.partyId]).catch(() => null);
  barata = await criarVariante(`qt-barata-${marca}`, 7990);
  cara = await criarVariante(`qt-cara-${marca}`, 12990);
  await adm.unsafe(`update product_variants set reference_code=$2 where id=$1`, [barata, `LQT${marca}A`.toUpperCase()]);
  await adm.unsafe(`update product_variants set reference_code=$2 where id=$1`, [cara, `LQT${marca}B`.toUpperCase()]);
});

const contar = async () => (await adm.unsafe(`select (select count(*) from stock_movements)::int estoque, (select count(*) from financial_account_movements)::int caixa`))[0];

describe("Canal de Qualidade", () => {
  let id = "";
  test("consultora abre pelo app, idempotente, com peça do catálogo", async () => {
    const antes = await contar();
    const args = abrir();
    const r = await rpc<{ id: string; protocolo: string; repetida: boolean }>(eu, "qualidade_troca_abrir", args);
    expect(r.erro).toBeNull();
    expect(r.dados.protocolo).toMatch(/^TG-\d{6}$/);
    id = r.dados.id;
    const de_novo = await rpc<{ id: string; repetida: boolean }>(eu, "qualidade_troca_abrir", args);
    expect(de_novo.dados.id).toBe(id);
    expect(de_novo.dados.repetida).toBe(true);
    const linha = (await adm.unsafe(`select origem, status, dev_valor_cents, dev_referencia, novidade_lardan from qualidade_trocas where id=$1`, [id]))[0];
    expect(linha).toMatchObject({ origem: "app_consultora", status: "aberta", dev_valor_cents: 7990, novidade_lardan: true });
    expect(linha.dev_referencia).toBe(`LQT${marca}A`.toUpperCase());
    expect(await contar()).toEqual(antes);
  });

  test("garantia sem foto e foto de outra conta são recusadas", async () => {
    expect((await rpc(eu, "qualidade_troca_abrir", abrir({ _tipo: "garantia" }))).erro).toContain("foto");
    expect((await rpc(eu, "qualidade_troca_abrir", abrir({ _fotos: [`${outra.uid}/x.jpg`] }))).erro).toContain("Fotos inválidas");
  });

  test("outra consultora não vê nada; consultora não muda situação", async () => {
    expect((await ler(outra, `select id from qualidade_trocas where id=$1`, [id])).linhas).toHaveLength(0);
    expect((await ler(outra, `select id from qualidade_trocas_eventos where troca_id=$1`, [id])).linhas).toHaveLength(0);
    expect((await ler(eu, `select id from qualidade_trocas where id=$1`, [id])).linhas).toHaveLength(1);
    expect((await escritaDireta(eu, `update qualidade_trocas set status='resolvida' where id=$1`, [id])).ok).toBe(false);
    expect((await rpc(eu, "qualidade_troca_mover", { _id: id, _status: "resolvida", _texto: "eu mesma", _dados: {} })).ok).toBe(false);
    expect((await rpc(outra, "qualidade_troca_mensagem", { _id: id, _texto: "intrusa", _fotos: [], _interno: false })).ok).toBe(false);
  });

  test("Lardan lança manualmente e a consultora vê", async () => {
    const r = await rpc<{ id: string }>(qual, "qualidade_troca_lancar", { _party: eu.partyId, _variant: null, _referencia: "lref999", _nome: "Anel digitado", _tamanho: "18", _valor_cents: 5000, _tipo: "troca", _motivo: "Peça achada", _observacao: "veio no retorno", _fotos: [], _chave: crypto.randomUUID() });
    expect(r.erro).toBeNull();
    const vis = await ler<{ origem: string; dev_referencia: string }>(eu, `select origem, dev_referencia from qualidade_trocas where id=$1`, [r.dados.id]);
    expect(vis.linhas[0]).toMatchObject({ origem: "admin_manual", dev_referencia: "LREF999" });
    expect((await rpc(eu, "qualidade_troca_lancar", { _party: eu.partyId, _variant: barata, _referencia: null, _nome: null, _tamanho: null, _valor_cents: null, _tipo: "troca", _motivo: "x de novo", _observacao: "", _fotos: [], _chave: crypto.randomUUID() })).ok).toBe(false);
  });

  test("devolutiva: recusa exige motivo, finalizar exige solução, diferença = devolvida - enviada", async () => {
    expect((await rpc(qual, "qualidade_troca_mover", { _id: id, _status: "recusada", _texto: "", _dados: {} })).erro).toContain("motivo da recusa");
    expect((await rpc(qual, "qualidade_troca_mover", { _id: id, _status: "resolvida", _texto: "", _dados: {} })).erro).toContain("solução");
    expect((await rpc(qual, "qualidade_troca_mover", { _id: id, _status: "em_analise", _texto: "Recebemos a peça", _dados: {} })).erro).toBeNull();
    const ok = await rpc(qual, "qualidade_troca_mover", { _id: id, _status: "aguardando_envio", _texto: "Vai outra peça na próxima maleta", _dados: { solucao: "troca", rep_variant_id: cara } });
    expect(ok.erro).toBeNull();
    const l = (await adm.unsafe(`select status, rep_valor_cents, diferenca_cents, novidade_consultora, parecer from qualidade_trocas where id=$1`, [id]))[0];
    expect(l).toMatchObject({ status: "aguardando_envio", rep_valor_cents: 12990, diferenca_cents: -5000, novidade_consultora: true, parecer: "Vai outra peça na próxima maleta" });
    expect((await rpc(qual, "qualidade_troca_mover", { _id: id, _status: "resolvida", _texto: "", _dados: {} })).erro).toBeNull();
    expect((await rpc(qual, "qualidade_troca_mover", { _id: id, _status: "aberta", _texto: "", _dados: {} })).erro).toContain("reabra");
    const fim = (await adm.unsafe(`select finalizado_em is not null f, transmissao_em is not null t from qualidade_trocas where id=$1`, [id]))[0];
    expect(fim).toEqual({ f: true, t: true });
  });

  test("nota interna fica só na Lardan; novidades nos dois sentidos", async () => {
    expect((await rpc(qual, "qualidade_troca_mensagem", { _id: id, _texto: "nota secreta interna", _fotos: [], _interno: true })).erro).toBeNull();
    const vis = await ler<{ texto: string }>(eu, `select texto from qualidade_trocas_eventos where troca_id=$1`, [id]);
    expect(vis.linhas.some((e) => e.texto === "nota secreta interna")).toBe(false);
    expect(vis.linhas.some((e) => e.texto === "Vai outra peça na próxima maleta")).toBe(true);
    expect((await rpc(eu, "qualidade_troca_marcar_lida", { _id: id })).erro).toBeNull();
    expect((await rpc(eu, "qualidade_troca_mensagem", { _id: id, _texto: "Recebi, obrigada!", _fotos: [], _interno: false })).erro).toBeNull();
    const n = (await adm.unsafe(`select novidade_lardan, novidade_consultora from qualidade_trocas where id=$1`, [id]))[0];
    expect(n).toEqual({ novidade_lardan: true, novidade_consultora: false });
  });

  test("busca por código da consultora e por referência; consultora não usa a busca da Lardan", async () => {
    const porCodigo = await rpc<{ total: number }>(qual, "qualidade_troca_buscar", { _termo: `Q${marca}`, _status: "todas", _limite: 50, _offset: 0 });
    expect(porCodigo.erro).toBeNull();
    expect(porCodigo.dados.total).toBe(2);
    const porRef = await rpc<{ total: number }>(qual, "qualidade_troca_buscar", { _termo: "LREF999", _status: "todas", _limite: 50, _offset: 0 });
    expect(porRef.dados.total).toBe(1);
    expect((await rpc(eu, "qualidade_troca_buscar", { _termo: "", _status: "todas", _limite: 50, _offset: 0 })).ok).toBe(false);
    const pecas = await rpc<{ id: string }[]>(eu, "qualidade_buscar_peca", { _termo: `LQT${marca}B`, _limite: 5 });
    expect(pecas.erro).toBeNull();
    expect(pecas.dados[0]?.id).toBe(cara);
  });
});
