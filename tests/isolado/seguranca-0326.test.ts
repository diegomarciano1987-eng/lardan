/**
 * 0326 — auditoria de segurança: limites contra envio em massa e portas que não podem ficar abertas.
 * Também é a GUARDA permanente: se alguma migração futura abrir tabela sem RLS, view sem proteção ou rotina
 * "dona do banco" (SECURITY DEFINER) para visitante fora da lista conhecida, este teste falha.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let semPapel: Conta;

/** Executa SQL no papel anon (visitante sem login), com cabeçalhos HTTP simulados. */
async function comoVisitante<T>(sql: string, params: unknown[] = [], ip?: string) {
  const cx = await adm.reserve();
  try {
    await cx.unsafe(`set role anon`);
    await cx.unsafe(`select set_config('lardan.test_uid', '', false), set_config('request.headers', $1, false)`, [ip ? JSON.stringify({ "cf-connecting-ip": ip }) : ""]);
    return { ok: true, linhas: (await cx.unsafe(sql, params)) as T[], erro: null as string | null };
  } catch (e) {
    return { ok: false, linhas: [] as T[], erro: (e as Error).message };
  } finally {
    try { await cx.unsafe(`reset role`); await cx.unsafe(`select set_config('request.headers', '', false)`); } catch { /* */ }
    cx.release();
  }
}

/** Rotinas SECURITY DEFINER que o visitante PODE chamar (catálogo, vitrine, link do pedido, contato). */
const ANON_PERMITIDAS = [
  "indicacao_publica", "pdv_unidade_acesso", "pedido_publico", "public_catalog_browse", "public_catalog_list",
  "public_categories", "public_category", "public_product", "public_taxonomy_redirect", "showcase_public",
  "submit_contact_request", "vitrine_pagamento_situacao",
].sort();

beforeAll(async () => {
  // conta criada pelo site (/minha-conta): logada, sem nenhum papel
  semPapel = await criarConta({ nome: `iso-0326-sem-${marca}`, papeis: [], comParty: false });
});

describe("0326: guarda geral", () => {
  test("toda tabela do esquema público tem RLS ligada", async () => {
    const r = (await adm.unsafe(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity`)) as { relname: string }[];
    expect(r.map((x) => x.relname)).toEqual([]);
  });

  test("nenhuma view (que ignora RLS) está liberada para visitante ou conta logada", async () => {
    const r = (await adm.unsafe(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('v','m')
        and not coalesce('security_invoker=true' = any(c.reloptions), false)
        and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT'))`)) as { relname: string }[];
    expect(r.map((x) => x.relname)).toEqual([]);
  });

  test("visitante só chama as rotinas 'donas do banco' conhecidas", async () => {
    const r = (await adm.unsafe(`select distinct p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prokind='f' and p.prosecdef and p.prorettype <> 'trigger'::regtype
        and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1`)) as { proname: string }[];
    expect(r.map((x) => x.proname)).toEqual(ANON_PERMITIDAS);
  });
});

describe("0326: portas fechadas", () => {
  test("candidatura não pode ser chamada direto pela API pública (só pelo servidor)", async () => {
    const v = await comoVisitante(`select public.submit_candidatura('{}'::jsonb, '{}'::jsonb)`);
    expect(v.ok).toBe(false);
    expect(v.erro).toContain("permission denied");
    const l = await rpc(semPapel, "submit_candidatura", { _payload: {}, _tracking: {} });
    expect(l.ok).toBe(false);
  });

  test("submit_lead antigo e INSERT direto em contact_requests fechados", async () => {
    const v = await comoVisitante(`insert into public.contact_requests (full_name, contact_channel, contact_value, subject, message, status)
                                   values ('Robo','email','robo@x.com','oi','mensagem','novo')`);
    expect(v.ok).toBe(false);
    const f = (await adm.unsafe(`select bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) a from pg_proc p where p.proname='submit_lead'`)) as { a: boolean | null }[];
    expect(f[0]!.a ?? false).toBe(false);
  });

  test("conta sem papel não consome o contador de códigos de produto nem lê vínculos de consultora", async () => {
    expect((await rpc(semPapel, "product_next_internal_code", { _category_id: "00000000-0000-0000-0000-000000000000" })).ok).toBe(false);
    expect((await comoVisitante(`select public.consultora_historico_partes('00000000-0000-0000-0000-000000000000')`)).ok).toBe(false);
  });

  test("as rotinas fechadas continuam funcionando dentro das rotinas oficiais (dono do banco)", async () => {
    const r = (await adm.unsafe(`select public.stock_available(gen_random_uuid(), gen_random_uuid()) q`)) as { q: number }[];
    expect(r[0]!.q).toBe(0);
  });
});

describe("0326: limites contra envio em massa", () => {
  test("seguranca_limite: conta por janela e só o servidor usa", async () => {
    const chave = `teste:${marca}`;
    const um = async () => ((await adm.unsafe(`select public.seguranca_limite($1, 3, 3600) ok`, [chave])) as { ok: boolean }[])[0]!.ok;
    expect([await um(), await um(), await um(), await um()]).toEqual([true, true, true, false]);
    expect((await comoVisitante(`select public.seguranca_limite('x', 1, 60)`)).ok).toBe(false);
    expect((await rpc(semPapel, "seguranca_limite", { _chave: "x", _max: 1, _janela_seg: 60 })).ok).toBe(false);
  });

  test("formulário de contato: 5 por IP em 10 min; mensagem gigante recusada", async () => {
    const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7`;
    const enviar = () => comoVisitante<{ p: string }>(
      `select public.submit_contact_request('Robô Teste','email','robo-${marca}@exemplo.com','Assunto','Mensagem de teste', 'site/contato', null, '{}'::jsonb, 'v1', false) p`, [], ip);
    for (let i = 0; i < 5; i++) expect((await enviar()).ok).toBe(true);
    const sexto = await enviar();
    expect(sexto.ok).toBe(false);
    expect(sexto.erro).toContain("limite_envios");
    const gigante = await comoVisitante(
      `select public.submit_contact_request('Robô Teste','email','robo2@exemplo.com','Assunto', repeat('x', 6000), 'site/contato', null, '{}'::jsonb, 'v1', false)`, [], `10.250.250.${Math.floor(Math.random() * 250)}`);
    expect(gigante.erro).toContain("mensagem_invalida");
    await adm.unsafe(`delete from public.contact_requests where contact_value like 'robo%@exemplo.com'`);
  });

  test("candidatura: no máximo 3 por CPF por dia (mesmo trocando de IP)", async () => {
    // CPF válido sintético
    const base = String(100000000 + Math.floor(Math.random() * 899999999)).slice(0, 9).split("").map(Number);
    const dv = (d: number[]) => { const s = d.reduce((a, n, i) => a + n * (d.length + 1 - i), 0) % 11; return s < 2 ? 0 : 11 - s; };
    const cpf = [...base, dv(base), dv([...base, dv(base)])].join("");
    const payload = { first_name: "Teste", last_name: `Seguranca ${marca}`, cpf, whatsapp: "41999990000", city: "Curitiba", uf: "PR", privacy_version: "v1" };
    const enviar = (n: number) => adm.begin(async (tx) => {
      await tx.unsafe(`set local role service_role`);
      return tx.unsafe(`select public.submit_candidatura($1::text::jsonb, $2::text::jsonb) r`, [JSON.stringify(payload), JSON.stringify({ ip: `10.77.${n}.1` })]);
    }).then(() => "ok", (e: Error) => e.message);
    expect(await enviar(1)).toBe("ok");
    expect(await enviar(2)).toBe("ok");
    expect(await enviar(3)).toBe("ok");
    expect(await enviar(4)).toContain("limite_envios");
  });
});
