/**
 * 0327 (Diego, 16/11/2026) — alívio do banco sem mudar regra nenhuma. Banco ISOLADO, dados sintéticos.
 * Prova que as leituras rápidas devolvem exatamente o mesmo que as antigas.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, ler, type Conta } from "./base";

const base = 700000 + Math.floor(Math.random() * 90000);
let contas: Conta[] = [];

/** Conjunto antigo: cada permissão conferida uma a uma por has_capability. */
async function antigo(uid: string) {
  return adm.begin(async (tx) => {
    await tx.unsafe(`select set_config('lardan.test_uid', $1, true)`, [uid]);
    const [r] = (await tx.unsafe(
      `select coalesce(array_agg(distinct rc.capability order by rc.capability), '{}') caps
         from public.role_capabilities rc where public.has_capability($1::uuid, rc.capability)`, [uid])) as { caps: string[] }[];
    return r!.caps;
  });
}
async function novo(c: Conta) {
  const r = await ler<{ capability: string }>(c, `select capability from public.my_capabilities() order by 1`);
  if (r.erro) throw new Error(r.erro);
  return r.linhas.map((x) => x.capability);
}

beforeAll(async () => {
  const papeis = [["master"], ["financeiro"], ["cobranca", "financeiro"], ["diretoria", "marketing", "consultora"], ["representante"], ["consultora"], ["montagem"], ["qualidade"], []] as const;
  contas = await Promise.all(papeis.map((p, i) => criarConta({ nome: `a327-${i}-${base}`, papeis: [...p], comParty: true })));
  // conta inativa continua sem nada
  contas.push(await criarConta({ nome: `a327-inativa-${base}`, papeis: ["master"], ativo: false, comParty: true }));
  // acesso financeiro completo sem ser Master
  const fin = await criarConta({ nome: `a327-finacc-${base}`, papeis: ["cobranca"], comParty: true });
  await adm.unsafe(`insert into public.user_financial_access (user_id, enabled, reason) values ($1, true, 'teste 0327')`, [fin.uid]);
  contas.push(fin);
  // colaboradora por código com módulos (ativa) e outra desativada
  for (const [i, ativo] of [[1, true], [2, false]] as const) {
    const c = await criarConta({ nome: `a327-colab${i}-${base}`, papeis: [], comParty: true });
    await adm.unsafe(`insert into public.colab_acessos (user_id, party_id, codigo, ativo) values ($1, $2, $3, $4)`, [c.uid, c.partyId, String(base * 10 + i).slice(-8), ativo]);
    await adm.unsafe(`insert into public.user_capabilities (user_id, capability) values ($1,'kit.view'),($1,'catalog.view'),($1,'stock.view')`, [c.uid]);
    contas.push(c);
  }
});

describe("0327: permissões do menu (my_capabilities)", () => {
  test("mesmo conjunto que a conferência uma a uma, para todo tipo de conta", async () => {
    for (const c of contas) expect(await novo(c)).toEqual(await antigo(c.uid!));
  });
  test("colaboradora ativa recebe os módulos permitidos, nunca estoque; desativada não recebe nada", async () => {
    const ativa = await novo(contas.at(-2)!);
    expect(ativa).toContain("kit.view");
    expect(ativa.some((x) => x.startsWith("stock."))).toBe(false);
    expect(await novo(contas.at(-1)!)).toEqual([]);
  });
  test("conta inativa não recebe nada", async () => {
    expect(await novo(contas[9]!)).toEqual([]);
  });
});

describe("0327: saldo das parcelas", () => {
  test("a rotina de uma parcela e a leitura em lote usam a mesma fórmula", async () => {
    const [r] = (await adm.unsafe(
      `select count(*)::int n, count(*) filter (where public.fin_installment_saldo(s.installment_id) is distinct from s.saldo_cents)::int dif
         from public.fin_installment_saldos s`)) as { n: number; dif: number }[];
    expect(r!.dif).toBe(0);
  });
  test("a leitura em lote não fica aberta para visitante nem conta logada", async () => {
    expect((await ler(contas[0]!, `select 1 from public.fin_installment_saldos limit 1`)).erro ?? "").toMatch(/permission denied/);
    expect((await ler(null, `select 1 from public.fin_installment_saldos limit 1`)).erro ?? "").toMatch(/permission denied/);
  });
});

describe("0327: regras de acesso", () => {
  test("nenhuma regra confere papel/permissão linha a linha", async () => {
    const r = (await adm.unsafe(
      `select tablename, policyname from pg_policies where schemaname='public'
          and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ '(?<!SELECT )\\m(has_role|has_capability|has_any_role|cob_pode|can_manage_leads|can_manage_content|is_staff|can_manage_kits|can_view_costs|can_view_kits|pdv_gestao|access_pode_ver_convites)\\(auth\\.uid\\(\\)(, ''[^'']*''::[a-z_]+|, ARRAY\\[[^]]*\\])?\\)'`)) as unknown[];
    expect(r).toEqual([]);
  });
});
