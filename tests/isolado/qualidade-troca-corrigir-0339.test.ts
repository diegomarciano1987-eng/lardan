/**
 * 0339 (Diego/Tati, 19/11/2026) — "Trocar peça" no cockpit da Qualidade. Banco ISOLADO, dados sintéticos.
 *  - corrige a peça devolvida escolhida por engano, na MESMA troca (mesma consultora), com motivo obrigatório;
 *  - recalcula a diferença (devolvida - enviada) e registra antes/depois no histórico que a consultora vê;
 *  - consultora não corrige; finalizada e SmallData não mudam; nada mexe em estoque ou caixa.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarVariante, rpc, ler, type Conta } from "./base";

const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let cons: Conta, qual: Conta;
let errada: string, certa: string, enviada: string;
const contar = async () => (await adm.unsafe(`select (select count(*) from stock_movements)::int estoque, (select count(*) from financial_account_movements)::int caixa`))[0];

beforeAll(async () => {
  cons = await criarConta({ nome: `qc-cons-${marca}`, papeis: ["consultora"], comParty: true });
  qual = await criarConta({ nome: `qc-qual-${marca}`, papeis: ["qualidade"], comParty: true });
  await adm.unsafe(`insert into party_roles(party_id, role) values ($1,'consultora') on conflict do nothing`, [cons.partyId]).catch(() => null);
  errada = await criarVariante(`qc-errada-${marca}`, 7990);
  certa = await criarVariante(`qc-certa-${marca}`, 9990);
  enviada = await criarVariante(`qc-enviada-${marca}`, 12990);
  await adm.unsafe(`update product_variants set reference_code=$2 where id=$1`, [errada, `LQC${marca}E`.toUpperCase()]);
  await adm.unsafe(`update product_variants set reference_code=$2 where id=$1`, [certa, `LQC${marca}C`.toUpperCase()]);
});

const lancar = async () => {
  const r = await rpc<{ id: string }>(qual, "qualidade_troca_lancar", { _party: cons.partyId, _variant: errada, _referencia: null, _nome: null, _tamanho: null, _valor_cents: null, _tipo: "troca", _motivo: "Escureceu", _observacao: "", _fotos: [], _chave: crypto.randomUUID() });
  expect(r.erro).toBeNull();
  return r.dados.id;
};

describe("Qualidade — trocar a peça devolvida", () => {
  test("troca a peça na mesma troca, recalcula a diferença e deixa histórico visível à consultora", async () => {
    const id = await lancar();
    expect((await rpc(qual, "qualidade_troca_mover", { _id: id, _status: "aguardando_envio", _texto: "Vai outra", _dados: { solucao: "troca", rep_variant_id: enviada } })).erro).toBeNull();
    expect((await adm.unsafe(`select diferenca_cents from qualidade_trocas where id=$1`, [id]))[0].diferenca_cents).toBe(7990 - 12990);
    const antes = await contar();
    const r = await rpc(qual, "qualidade_troca_peca_corrigir", { _id: id, _variant: certa, _referencia: null, _motivo: "Digitei a referência errada" });
    expect(r.erro).toBeNull();
    const l = (await adm.unsafe(`select consultora_party_id, dev_variant_id, dev_referencia, dev_valor_cents, diferenca_cents, rep_variant_id, novidade_consultora from qualidade_trocas where id=$1`, [id]))[0];
    expect(l).toMatchObject({ consultora_party_id: cons.partyId, dev_variant_id: certa, dev_referencia: `LQC${marca}C`.toUpperCase(), dev_valor_cents: 9990, diferenca_cents: 9990 - 12990, rep_variant_id: enviada, novidade_consultora: true });
    const ev = await ler<{ texto: string }>(cons, `select texto from qualidade_trocas_eventos where troca_id=$1`, [id]);
    const txt = ev.linhas.find((e) => e.texto.startsWith("Peça devolvida corrigida"))?.texto ?? "";
    expect(txt).toContain(`LQC${marca}E`.toUpperCase());
    expect(txt).toContain(`LQC${marca}C`.toUpperCase());
    expect(txt).toContain("Digitei a referência errada");
    expect(await contar()).toEqual(antes);
  });

  test("também acha a peça certa pela referência digitada", async () => {
    const id = await lancar();
    expect((await rpc(qual, "qualidade_troca_peca_corrigir", { _id: id, _variant: null, _referencia: `lqc${marca}c`, _motivo: "Bipei errado" })).erro).toBeNull();
    expect((await adm.unsafe(`select dev_variant_id from qualidade_trocas where id=$1`, [id]))[0].dev_variant_id).toBe(certa);
  });

  test("motivo obrigatório, mesma peça recusada, consultora não corrige", async () => {
    const id = await lancar();
    expect((await rpc(qual, "qualidade_troca_peca_corrigir", { _id: id, _variant: certa, _referencia: null, _motivo: "" })).erro).toContain("motivo");
    expect((await rpc(qual, "qualidade_troca_peca_corrigir", { _id: id, _variant: errada, _referencia: null, _motivo: "igual" })).erro).toContain("já é a peça");
    expect((await rpc(cons, "qualidade_troca_peca_corrigir", { _id: id, _variant: certa, _referencia: null, _motivo: "eu mesma" })).ok).toBe(false);
    expect((await adm.unsafe(`select dev_variant_id from qualidade_trocas where id=$1`, [id]))[0].dev_variant_id).toBe(errada);
  });

  test("troca finalizada e troca do histórico SmallData não mudam de peça", async () => {
    const id = await lancar();
    expect((await rpc(qual, "qualidade_troca_mover", { _id: id, _status: "recusada", _texto: "Mau uso", _dados: {} })).erro).toBeNull();
    expect((await rpc(qual, "qualidade_troca_peca_corrigir", { _id: id, _variant: certa, _referencia: null, _motivo: "tarde" })).erro).toContain("finalizada");
    const id2 = await lancar();
    await adm.unsafe(`update qualidade_trocas set origem='legado_smalldata' where id=$1`, [id2]);
    expect((await rpc(qual, "qualidade_troca_peca_corrigir", { _id: id2, _variant: certa, _referencia: null, _motivo: "histórico" })).erro).toContain("SmallData");
  });
});
