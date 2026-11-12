/**
 * 0298 (Diego, 12/11/2026) — a consultora fotografa a peça e a foto aparece só na vitrine dela.
 * O catálogo oficial (product_media) não muda; outra consultora e a montagem não leem a foto.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, porEstoque, ler, rpc, type Conta } from "./base";

const base = 710000 + Math.floor(Math.random() * 80000);
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let master: Conta, rep: Conta, ana: Conta, bia: Conta, montagem: Conta;
let vA = "", vFora = "", praca = "", remessa = "", deposito = "";

const caminho = (c: Conta) => `${c.partyId}/peca/${crypto.randomUUID()}.webp`;
const arquivo = (p: string) => adm.unsafe(`insert into storage.objects (bucket_id, name) values ('vitrine-originais', $1)`, [p]);
async function ok<T>(conta: Conta, fn: string, args: Record<string, unknown>) {
  const r = await rpc<T>(conta, fn, args);
  if (r.erro) throw new Error(`${fn}: ${r.erro}`);
  return r.dados;
}
const midias = async () => ((await adm.unsafe(`select count(*)::int n from public.product_media`)) as { n: number }[])[0]!.n;

beforeAll(async () => {
  master = await criarConta({ nome: `f98-master-${base}`, papeis: ["master"], comParty: true });
  rep = await criarConta({ nome: `f98-rep-${base}`, papeis: ["representante"], comParty: true });
  ana = await criarConta({ nome: `f98-ana-${base}`, papeis: ["consultora"], comParty: true });
  bia = await criarConta({ nome: `f98-bia-${base}`, papeis: ["consultora"], comParty: true });
  montagem = await criarConta({ nome: `f98-mont-${base}`, papeis: ["montagem"], comParty: true });
  deposito = await criarDeposito(`f98-${marca}`);
  vA = await criarVariante(`f98-a-${marca}`, 10000);
  vFora = await criarVariante(`f98-x-${marca}`, 10000);
  await porEstoque(vA, deposito, 10);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`F98 ${marca}`])).linhas[0]!.id;
  for (const c of [ana, bia]) {
    await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
      on conflict (party_id) do update set representative_party_id=excluded.representative_party_id, praca_id=excluded.praca_id`, [c.partyId, rep.partyId, praca]);
  }
  const acerto = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  remessa = (await ok<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito, _data_acerto: acerto })).id;
  for (const c of [ana, bia]) {
    const id = (await ok<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: c.partyId })).cycle_id;
    await ok(master, "kit_item_upsert", { _cycle: id, _variant: vA, _qty: 1 });
    await ok(master, "kit_conferir", { _cycle: id, _note: null });
  }
});

describe("foto própria da peça na vitrine da consultora", () => {
  test("a consultora grava a foto de uma peça da maleta dela e o catálogo oficial não muda", async () => {
    const antes = await midias();
    const p = caminho(ana); await arquivo(p);
    const r = await ok<{ path: string; anterior: string | null }>(ana, "vitrine_foto_propria_salvar", { _variant: vA, _path: p });
    expect(r.path).toBe(p);
    expect(r.anterior).toBeNull();
    expect(await midias()).toBe(antes);
    const minhas = await ler<{ path: string }>(ana, `select path from public.vitrine_fotos_proprias where variant_id=$1`, [vA]);
    expect(minhas.linhas.map((x) => x.path)).toEqual([p]);
  });

  test("trocar a foto devolve a anterior para apagar o arquivo velho", async () => {
    const velho = (await ler<{ path: string }>(ana, `select path from public.vitrine_fotos_proprias where variant_id=$1`, [vA])).linhas[0]!.path;
    const novo = caminho(ana); await arquivo(novo);
    const r = await ok<{ anterior: string }>(ana, "vitrine_foto_propria_salvar", { _variant: vA, _path: novo });
    expect(r.anterior).toBe(velho);
  });

  test("outra consultora e a montagem não enxergam a foto", async () => {
    const outra = await ler<{ n: number }>(bia, `select count(*)::int n from public.vitrine_fotos_proprias`);
    expect(outra.linhas[0]!.n).toBe(0);
    const mont = await ler<{ n: number }>(montagem, `select count(*)::int n from public.vitrine_fotos_proprias`);
    expect(mont.erro !== null || mont.linhas[0]!.n === 0).toBe(true);
  });

  test("não aceita arquivo na pasta de outra consultora", async () => {
    const p = caminho(bia); await arquivo(p);
    const r = await rpc(ana, "vitrine_foto_propria_salvar", { _variant: vA, _path: p });
    expect(r.erro).toContain("inválido");
  });

  test("não aceita arquivo que não foi enviado", async () => {
    const r = await rpc(ana, "vitrine_foto_propria_salvar", { _variant: vA, _path: caminho(ana) });
    expect(r.erro).toContain("não terminou de enviar");
  });

  test("não aceita peça que não está na maleta dela", async () => {
    const p = caminho(ana); await arquivo(p);
    const r = await rpc(ana, "vitrine_foto_propria_salvar", { _variant: vFora, _path: p });
    expect(r.erro).toContain("não está em nenhuma maleta");
  });

  test("a lista da vitrine traz a foto só para a dona", async () => {
    const itensAna = ((await adm.unsafe(`select public.showcase_items_for($1, '{}'::jsonb) j`, [ana.partyId])) as { j: { variant_id: string; foto_propria: string | null }[] }[])[0]!.j;
    const itensBia = ((await adm.unsafe(`select public.showcase_items_for($1, '{}'::jsonb) j`, [bia.partyId])) as { j: { variant_id: string; foto_propria: string | null }[] }[])[0]!.j;
    const daAna = itensAna.find((i) => i.variant_id === vA);
    const daBia = itensBia.find((i) => i.variant_id === vA);
    if (daAna) expect(daAna.foto_propria).toMatch(new RegExp(`^${ana.partyId}/peca/`));
    if (daBia) expect(daBia.foto_propria).toBeNull();
  });

  test("o arquivo só sai em público com a vitrine dela no ar", async () => {
    const p = (await ler<{ path: string }>(ana, `select path from public.vitrine_fotos_proprias where variant_id=$1`, [vA])).linhas[0]!.path;
    const fora = ((await adm.unsafe(`select public.showcase_public_file_ok($1) ok`, [p])) as { ok: boolean }[])[0]!.ok;
    expect(fora).toBe(false);
    await adm.unsafe(`insert into public.consultant_showcases (party_id, slug, is_public, design_published) values ($1, $2, true, '{}'::jsonb)
      on conflict (party_id) do update set is_public = true, design_published = '{}'::jsonb`, [ana.partyId, `f98-${marca}`]);
    const noAr = ((await adm.unsafe(`select public.showcase_public_file_ok($1) ok`, [p])) as { ok: boolean }[])[0]!.ok;
    expect(noAr).toBe(true);
  });

  test("excluir a foto volta para a foto oficial e devolve o arquivo para apagar", async () => {
    const r = await ok<{ anterior: string | null }>(ana, "vitrine_foto_propria_remover", { _variant: vA });
    expect(r.anterior).toMatch(/\/peca\//);
    const minhas = await ler<{ n: number }>(ana, `select count(*)::int n from public.vitrine_fotos_proprias`);
    expect(minhas.linhas[0]!.n).toBe(0);
  });
});
