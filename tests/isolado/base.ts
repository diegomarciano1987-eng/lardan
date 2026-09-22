/**
 * Bancada do ambiente ISOLADO.
 *
 * Conecta no Postgres local criado por `tests/isolado/subir.sh`, cria contas e
 * pessoas exclusivamente sintéticas e chama as rotinas do banco no papel de
 * cada perfil — exatamente como a interface faz, mas sem interface.
 *
 * Nenhum dado, segredo ou credencial da base compartilhada é usado aqui.
 * A troca de perfil acontece por `lardan.test_uid`, que é o que a função
 * auth.uid() lê neste ambiente (ver 00-prelude.sql).
 */
import { SQL } from "bun";

export const URL_ISO =
  process.env["LARDAN_ISO_URL"] ?? "postgresql://postgres@127.0.0.1:55432/lardan_iso?sslmode=disable";

/** Conexão administrativa: só monta e inspeciona o cenário. */
export const adm = new SQL(URL_ISO, { max: 5 });

export type Papel =
  | "master"
  | "diretoria"
  | "financeiro"
  | "estoque"
  | "qualidade"
  | "representante"
  | "consultora";

export interface Conta {
  nome: string;
  uid: string | null;
  partyId: string | null;
}

/** Visitante: sem sessão nenhuma. */
export const VISITANTE: Conta = { nome: "visitante", uid: null, partyId: null };

let assinaturas: Map<string, { nome: string; tipo: string }[]> | null = null;

async function carregarAssinaturas() {
  if (assinaturas) return assinaturas;
  const linhas = (await adm.unsafe(
    `select p.proname as nome, pg_get_function_identity_arguments(p.oid) as args
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'`,
  )) as { nome: string; args: string }[];
  assinaturas = new Map();
  for (const l of linhas) {
    const args = l.args
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean)
      .map((a) => {
        const partes = a.split(/\s+/);
        return { nome: partes[0]!, tipo: partes.slice(1).join(" ") };
      });
    assinaturas.set(l.nome, args);
  }
  return assinaturas;
}

export interface Resposta<T = unknown> {
  ok: boolean;
  dados: T;
  erro: string | null;
}

/**
 * Chama uma rotina do banco como um perfil. Equivale ao que o navegador faz:
 * papel `authenticated` (as políticas valem) e usuário da sessão.
 */
export async function rpc<T = unknown>(
  conta: Conta | null,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<Resposta<T>> {
  const mapa = await carregarAssinaturas();
  const assinatura = mapa.get(fn);
  if (!assinatura) throw new Error(`rotina inexistente: ${fn}`);

  const valores: unknown[] = [];
  const chamada = assinatura
    .filter((a) => a.nome in args)
    .map((a) => {
      const v = args[a.nome];
      const json = v !== null && typeof v === "object";
      valores.push(json ? JSON.stringify(v) : v);
      // texto → jsonb evita que o driver reenvie o JSON como texto puro
      return `${a.nome} => $${valores.length}::text::${a.tipo}`;
    })
    .join(", ");

  const conexao = await adm.reserve();
  try {
    await conexao.unsafe(`set role authenticated`);
    await conexao.unsafe(`select set_config('lardan.test_uid', $1, false)`, [conta?.uid ?? ""]);
    const r = (await conexao.unsafe(`select public.${fn}(${chamada}) as r`, valores)) as { r: T }[];
    return { ok: true, dados: r[0]!.r, erro: null };
  } catch (e) {
    return { ok: false, dados: null as T, erro: (e as Error).message };
  } finally {
    try {
      await conexao.unsafe(`reset role`);
      await conexao.unsafe(`select set_config('lardan.test_uid', '', false)`);
    } catch {
      /* conexão já derrubada */
    }
    conexao.release();
  }
}

/** Leitura de tabela no papel de um perfil (as políticas de acesso valem). */
export async function ler<T = unknown>(conta: Conta | null, consulta: string, params: unknown[] = []) {
  const conexao = await adm.reserve();
  try {
    await conexao.unsafe(`set role authenticated`);
    await conexao.unsafe(`select set_config('lardan.test_uid', $1, false)`, [conta?.uid ?? ""]);
    const r = (await conexao.unsafe(consulta, params)) as T[];
    return { ok: true, linhas: r, erro: null as string | null };
  } catch (e) {
    return { ok: false, linhas: [] as T[], erro: (e as Error).message };
  } finally {
    try {
      await conexao.unsafe(`reset role`);
    } catch {
      /* conexão já derrubada */
    }
    conexao.release();
  }
}

/** Escrita direta na tabela, fora das rotinas oficiais — deve ser recusada. */
export const escritaDireta = (conta: Conta | null, consulta: string, params: unknown[] = []) =>
  ler(conta, consulta, params);

let sequencia = 0;
const proximo = () => `ISO-${Date.now().toString(36)}-${++sequencia}`;

export async function criarConta(opts: {
  nome: string;
  papeis: Papel[];
  ativo?: boolean;
  comParty?: boolean;
}): Promise<Conta> {
  const email = `iso.${opts.nome}.${proximo()}@lardan.test`;
  const [u] = (await adm.unsafe(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"sintetico":true}'::jsonb) returning id`,
    [email],
  )) as { id: string }[];
  const uid = u!.id;

  let partyId: string | null = null;
  if (opts.comParty) {
    const [p] = (await adm.unsafe(
      `insert into public.parties (kind, display_name, legal_name, status)
       values ('pessoa', $1, $1, 'ativo') returning id`,
      [`ISO ${opts.nome}`],
    )) as { id: string }[];
    partyId = p!.id;
  }

  await adm.unsafe(
    `insert into public.profiles (id, full_name, email, is_active, party_id)
     values ($1, $2, $3, $4, $5)
     on conflict (id) do update set is_active = excluded.is_active, party_id = excluded.party_id`,
    [uid, `ISO ${opts.nome}`, email, opts.ativo ?? true, partyId],
  );
  for (const papel of opts.papeis) {
    await adm.unsafe(`insert into public.user_roles (user_id, role) values ($1, $2::app_role)`, [uid, papel]);
  }
  return { nome: opts.nome, uid, partyId };
}

export async function criarDeposito(rotulo: string) {
  const [l] = (await adm.unsafe(
    `insert into public.locations (code, name, kind, is_active)
     values ($1, $2, 'deposito', true) returning id`,
    [`ISO-${rotulo}-${proximo()}`, `ISO Depósito ${rotulo}`],
  )) as { id: string }[];
  return l!.id;
}

export async function criarVariante(rotulo: string, precoCents = 9900) {
  const marca = proximo();
  const [p] = (await adm.unsafe(
    `insert into public.products (name, slug) values ($1, $2) returning id`,
    [`ISO Peça ${rotulo}`, `iso-${rotulo}-${marca}`.toLowerCase()],
  )) as { id: string }[];
  const [v] = (await adm.unsafe(
    `insert into public.product_variants (product_id, sku, label, price_cents, is_active)
     values ($1, $2, 'U', $3, true) returning id`,
    [p!.id, `ISO-${rotulo}-${marca}`, precoCents],
  )) as { id: string }[];
  return v!.id;
}

export async function porEstoque(variante: string, local: string, quantidade: number) {
  await adm.unsafe(
    `insert into public.stock_balances (variant_id, location_id, quantity, reserved)
     values ($1, $2, $3, 0)
     on conflict (variant_id, location_id) do update set quantity = excluded.quantity`,
    [variante, local, quantidade],
  );
}

export async function saldo(variante: string, local: string) {
  const r = (await adm.unsafe(
    `select coalesce(quantity, 0) as q from public.stock_balances where variant_id = $1 and location_id = $2`,
    [variante, local],
  )) as { q: number }[];
  return r[0]?.q ?? 0;
}

export async function localBloqueado() {
  const r = (await adm.unsafe(`select public.kit_blocked_location() as id`)) as { id: string }[];
  return r[0]!.id;
}
