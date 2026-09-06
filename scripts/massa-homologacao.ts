/**
 * LARDAN Cloud — massa sintética de homologação.
 *
 *   bun run massa:criar    → cria (ou completa) a massa
 *   bun run massa:limpar   → remove tudo que tem o prefixo de homologação
 *   bun run massa:relatorio→ apenas conta o que existe hoje
 *
 * Regras de segurança desta ferramenta:
 * - todo registro nasce com o prefixo HOMOLOG e uma chave determinística
 *   (HOMOLOG#TIPO-NNN) gravada em campo de observação/slug/código;
 * - idempotente: rodar duas vezes não duplica nada;
 * - nenhum dado pessoal real. CPF/CNPJ são gerados matematicamente válidos
 *   mas fictícios, e ficam documentados como tal na própria observação;
 * - a execução exige LARDAN_MASSA=1. Em ambiente marcado como produção
 *   (LARDAN_ENV=producao) exige também --producao explícito.
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!;
const SERVICE = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
const ANON =
  process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]!;

const PREFIXO = "HOMOLOG";
const MARCA = `${PREFIXO} — dado sintético de homologação (fictício)`;
const chave = (tipo: string, i: number) => `${PREFIXO}#${tipo}-${String(i).padStart(3, "0")}`;
const nota = (tipo: string, i: number) => `${chave(tipo, i)} ${MARCA}`;

const db = createClient(URL, SERVICE, { auth: { persistSession: false } });

/* --------------------------------------------------------- documentos -- */

function cpfSintetico(seed: number) {
  const base = String(10000000000 + ((seed * 1234567) % 89999999))
    .padStart(9, "0")
    .slice(0, 9);
  const dv = (fim: number, d: string) => {
    let soma = 0;
    for (let i = 0; i < fim; i++) soma += Number(d[i]) * (fim + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(9, base);
  const d2 = dv(10, base + d1);
  return `${base}${d1}${d2}`;
}

function cnpjSintetico(seed: number) {
  const base = String(10000000 + ((seed * 7654321) % 89999999)).slice(0, 8) + "0001";
  const calc = (n: number, d: string) => {
    const pesos =
      n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < n; i++) soma += (d.charCodeAt(i) - 48) * (pesos[i] as number);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(12, base);
  const d2 = calc(13, base + d1);
  return `${base}${d1}${d2}`;
}

/* ------------------------------------------------------------ geografia */

const MUNICIPIOS = [
  { uf: "SP", cidade: "São Paulo", ibge: "3550308", ddd: "11", cep: "01001000" },
  { uf: "SP", cidade: "Campinas", ibge: "3509502", ddd: "19", cep: "13010000" },
  { uf: "SP", cidade: "Santos", ibge: "3548500", ddd: "13", cep: "11010000" },
  { uf: "MG", cidade: "Belo Horizonte", ibge: "3106200", ddd: "31", cep: "30110000" },
  { uf: "MG", cidade: "Uberlândia", ibge: "3170206", ddd: "34", cep: "38400000" },
  { uf: "MG", cidade: "Juiz de Fora", ibge: "3136702", ddd: "32", cep: "36010000" },
  { uf: "RJ", cidade: "Rio de Janeiro", ibge: "3304557", ddd: "21", cep: "20010000" },
  { uf: "RJ", cidade: "Duque de Caxias", ibge: "3301702", ddd: "21", cep: "25010000" },
  { uf: "RJ", cidade: "Niterói", ibge: "3303302", ddd: "21", cep: "24020000" },
  { uf: "BA", cidade: "Salvador", ibge: "2927408", ddd: "71", cep: "40010000" },
  { uf: "BA", cidade: "Feira de Santana", ibge: "2910800", ddd: "75", cep: "44001000" },
  { uf: "RS", cidade: "Porto Alegre", ibge: "4314902", ddd: "51", cep: "90010000" },
  { uf: "RS", cidade: "Caxias do Sul", ibge: "4305108", ddd: "54", cep: "95010000" },
  { uf: "PE", cidade: "Recife", ibge: "2611606", ddd: "81", cep: "50010000" },
  { uf: "PE", cidade: "Olinda", ibge: "2607901", ddd: "81", cep: "53010000" },
] as const;

const CARTEIRAS = [
  "Carteira Sul",
  "Carteira Sudeste",
  "Carteira Nordeste",
  "Carteira Capital",
  "Carteira Interior",
];
const CATEGORIAS = ["Anéis", "Pulseiras", "Colares", "Brincos"];
const COLECOES = ["Aurora", "Marfim", "Rosé", "Essência", "Herança", "Lumina"];
const MATERIAIS = ["Prata 925", "Aço inoxidável", "Latão", "Prata 950"];
const BANHOS = ["Ródio branco", "Ouro 18k", "Ouro rosé", "Sem banho"];

const dinheiro = (i: number) => 4900 + ((i * 733) % 42000);

/* ---------------------------------------------------------- utilidades */

async function upsertPor<T extends Record<string, unknown>>(
  tabela: string,
  filtro: Record<string, string>,
  valores: T,
  pk = "id",
): Promise<string> {
  let q = db.from(tabela).select(pk);
  for (const [k, v] of Object.entries(filtro)) q = q.eq(k, v);
  const { data: achado } = await q.maybeSingle();
  const idDe = (o: unknown) => (o as Record<string, string>)[pk] as string;
  if (achado) {
    await db
      .from(tabela)
      .update(valores as never)
      .eq(pk, idDe(achado));
    return idDe(achado);
  }
  const { data, error } = await db
    .from(tabela)
    .insert(valores as never)
    .select(pk)
    .single();
  if (error) throw new Error(`${tabela}: ${error.message}`);
  return idDe(data);
}

/* -------------------------------------------------------------- criação */

async function criar() {
  const relatorio: Record<string, number> = {};
  const conta = (k: string, n = 1) => (relatorio[k] = (relatorio[k] ?? 0) + n);

  /* --- Pessoas: 40 no total (25 consultoras, 4 representantes, 11 outras) */
  const pessoas: { id: string; i: number }[] = [];
  for (let i = 1; i <= 40; i++) {
    const m = MUNICIPIOS[i % MUNICIPIOS.length]!;
    const id = await upsertPor(
      "parties",
      { notes: nota("PESSOA", i) },
      {
        kind: "pessoa",
        display_name: `${PREFIXO} Pessoa ${String(i).padStart(3, "0")}`,
        legal_name: `${PREFIXO} Pessoa Sintética ${String(i).padStart(3, "0")}`,
        doc: cpfSintetico(i),
        notes: nota("PESSOA", i),
        status: i % 9 === 0 ? "bloqueado" : i % 7 === 0 ? "inativo" : "ativo",
        is_active: i % 7 !== 0,
      },
    );
    pessoas.push({ id, i });
    conta("pessoas");

    /* contato */
    await upsertPor(
      "contact_points",
      { party_id: id, kind: "whatsapp" },
      {
        party_id: id,
        kind: "whatsapp",
        value: `+55${m.ddd}9${String(80000000 + i)}`,
        is_primary: true,
      },
    );

    /* endereços: completos, incompletos e ausentes */
    if (i % 10 !== 0) {
      const incompleto = i % 5 === 0;
      await upsertPor(
        "party_addresses",
        { party_id: id, label: chave("END", i) },
        {
          party_id: id,
          label: chave("END", i),
          postal_code: incompleto ? null : m.cep,
          street: incompleto ? null : `Rua Sintética ${i}`,
          street_number: incompleto ? null : String(100 + i),
          district: incompleto ? null : "Centro",
          city: m.cidade,
          uf: m.uf,
          ibge_city_code: incompleto ? null : m.ibge,
          ddd: m.ddd,
          is_primary: true,
        },
      );
      conta(incompleto ? "enderecos_incompletos" : "enderecos_completos");
    } else {
      conta("pessoas_sem_endereco");
    }
  }

  /* --- Representantes (4) */
  const representantes = pessoas.slice(0, 4);
  for (const p of representantes) {
    await upsertPor(
      "party_roles",
      { party_id: p.id, role: "representante" },
      { party_id: p.id, role: "representante", status: "ativo" },
    );
    conta("representantes");
  }

  /* --- Consultoras (25) distribuídas em 5 carteiras */
  const consultoras = pessoas.slice(4, 29);
  for (let k = 0; k < consultoras.length; k++) {
    const p = consultoras[k]!;
    const rep = representantes[k % representantes.length]!;
    await upsertPor(
      "party_roles",
      { party_id: p.id, role: "consultora" },
      {
        party_id: p.id,
        role: "consultora",
        status: k % 9 === 0 ? "bloqueado" : k % 7 === 0 ? "inativo" : "ativo",
      },
    );
    await upsertPor(
      "consultant_profiles",
      { party_id: p.id },
      {
        party_id: p.id,
        origin: `${PREFIXO} massa`,
        wallet: CARTEIRAS[k % CARTEIRAS.length]!,
        region: MUNICIPIOS[k % MUNICIPIOS.length]!.uf,
        representative_party_id: rep.id,
        level: k % 3 === 0 ? "Ouro" : "Prata",
      },
      "party_id",
    );
    conta("consultoras");
  }

  /* --- Fornecedores (8) e entidades (4) */
  for (let i = 1; i <= 8; i++) {
    await upsertPor(
      "suppliers",
      { name: `${PREFIXO} Fornecedor ${i}` },
      {
        name: `${PREFIXO} Fornecedor ${i}`,
        trade_name: `${PREFIXO} Forn ${i}`,
        tax_id: cnpjSintetico(100 + i),
        city: MUNICIPIOS[i % MUNICIPIOS.length]!.cidade,
        uf: MUNICIPIOS[i % MUNICIPIOS.length]!.uf,
        notes: nota("FORN", i),
        is_active: true,
      },
    );
    conta("fornecedores");
  }
  for (let i = 1; i <= 4; i++) {
    await upsertPor(
      "business_entities",
      { legal_name: `${PREFIXO} Entidade ${i} LTDA` },
      {
        legal_name: `${PREFIXO} Entidade ${i} LTDA`,
        trade_name: `${PREFIXO} Entidade ${i}`,
        tax_id: cnpjSintetico(200 + i),
        city: MUNICIPIOS[i]!.cidade,
        uf: MUNICIPIOS[i]!.uf,
        notes: nota("ENT", i),
        is_active: true,
      },
    );
    conta("entidades");
  }

  /* --- Catálogo */
  const categorias: string[] = [];
  for (let i = 0; i < CATEGORIAS.length; i++) {
    const nome = CATEGORIAS[i]!;
    const slug = `homolog-${nome
      .toLowerCase()
      .normalize("NFD")
      .replace(/[^a-z]/g, "")}`;
    categorias.push(
      await upsertPor(
        "categories",
        { slug },
        {
          slug,
          name: `${PREFIXO} ${nome}`,
          description: MARCA,
          position: i,
          status: "publicado",
          published_at: new Date().toISOString(),
        },
      ),
    );
    conta("categorias");
  }
  const colecoes: string[] = [];
  for (let i = 0; i < COLECOES.length; i++) {
    const slug = `homolog-colecao-${COLECOES[i]!.toLowerCase()
      .normalize("NFD")
      .replace(/[^a-z]/g, "")}`;
    colecoes.push(
      await upsertPor(
        "collections",
        { slug },
        {
          slug,
          name: `${PREFIXO} ${COLECOES[i]}`,
          description: MARCA,
          position: i,
          status: "publicado",
          published_at: new Date().toISOString(),
        },
      ),
    );
    conta("colecoes");
  }

  const variantes: string[] = [];
  const paraPublicar: string[] = [];
  for (let i = 1; i <= 150; i++) {
    const incompleto = i % 11 === 0;
    const publicado = i % 4 !== 0;
    const slug = `homolog-peca-${String(i).padStart(3, "0")}`;
    // A publicação nunca é escrita à mão: passa pela operação canônica, que
    // exige permissão e checklist completo.
    const produtoId = await upsertPor(
      "products",
      { slug },
      {
        slug,
        name: `${PREFIXO} Peça ${String(i).padStart(3, "0")}`,
        category_id: categorias[(i % 7) % categorias.length]!,
        collection_id: colecoes[i % colecoes.length]!,
        short_description: incompleto ? null : `Peça sintética ${i} para homologação.`,
        description: incompleto
          ? null
          : `Peça sintética ${i} criada para homologação do LARDAN Cloud.`,
        material: incompleto ? null : MATERIAIS[i % MATERIAIS.length]!,
        plating: incompleto ? null : BANHOS[i % BANHOS.length]!,
        measurements: incompleto ? null : `${14 + (i % 6)} cm`,
        price_cents: incompleto ? null : dinheiro(i),
        price_is_public: i % 3 !== 0,
        position: i,
        is_featured: i % 17 === 0,
        is_new_arrival: i % 13 === 0,
      },
    );
    if (publicado && !incompleto) paraPublicar.push(produtoId);
    conta("produtos");

    const qtdVariantes = (i % 3) + 1;
    for (let v = 1; v <= qtdVariantes; v++) {
      const sku = `HOMOLOG-${String(i).padStart(3, "0")}-${v}`;
      const valores = {
        product_id: produtoId,
        sku,
        label: v === 1 ? "Único" : `Tamanho ${v}`,
        size: v === 1 ? null : String(14 + v),
        price_cents: incompleto ? null : dinheiro(i) + v * 500,
        position: v,
        is_active: true,
        is_default: v === 1,
      };
      let id: string;
      if (v === 1) {
        // O banco já cria a variação padrão junto com a peça: reaproveitamos.
        const { data: padrao } = await db
          .from("product_variants")
          .select("id")
          .eq("product_id", produtoId)
          .eq("is_default", true)
          .maybeSingle();
        if (padrao) {
          await db
            .from("product_variants")
            .update(valores as never)
            .eq("id", padrao.id);
          id = padrao.id;
        } else {
          id = await upsertPor("product_variants", { sku }, valores);
        }
        variantes.push(id);
      } else {
        id = await upsertPor("product_variants", { sku }, valores);
      }
      conta("variantes");
    }
  }

  /* --- Imagem sintética: sem ela o checklist de publicação barra a peça */
  const mediaId = await upsertPor(
    "media_assets",
    { alt: `${PREFIXO} imagem sintética` },
    {
      url: "/favicon.png",
      alt: `${PREFIXO} imagem sintética`,
      content_type: "image/png",
      is_archived: false,
    },
  );
  for (const pid of paraPublicar) {
    const { data: jaTem } = await db
      .from("product_media")
      .select("id")
      .eq("product_id", pid)
      .maybeSingle();
    if (!jaTem)
      await db
        .from("product_media")
        .insert({ product_id: pid, media_id: mediaId, position: 0 } as never);
  }

  /* --- Locais de estoque */
  const locais: string[] = [];
  const tipos = ["deposito", "loja", "maleta", "transito"] as const;
  for (let i = 0; i < 4; i++) {
    locais.push(
      await upsertPor(
        "locations",
        { code: `${PREFIXO}-LOC-${i + 1}` },
        {
          code: `${PREFIXO}-LOC-${i + 1}`,
          name: `${PREFIXO} ${tipos[i]!} ${i + 1}`,
          kind: tipos[i]!,
          notes: nota("LOCAL", i + 1),
          is_active: true,
        },
      ),
    );
    conta("locais");
  }

  /* --- Sessão real: publicação e movimentações exigem usuário autenticado */
  const token = await tokenOperador();

  let publicados = 0;
  for (let i = 0; i < paraPublicar.length; i += 25) {
    const lote = paraPublicar.slice(i, i + 25);
    const ok = await rpcComToken(token, "publish_products", {
      _ids: lote,
      _note: `${PREFIXO} massa`,
    });
    if (ok) publicados += lote.length;
  }
  relatorio["produtos_publicados_solicitados"] = publicados;

  let movs = 0;
  for (let i = 0; i < 60; i++) {
    const variante = variantes[i]!;
    const origem = locais[i % 4]!;
    const destino = locais[(i + 1) % 4]!;
    const passos: Record<string, unknown>[] = [
      {
        _kind: "entrada",
        _variant_id: variante,
        _quantity: 10 + (i % 7),
        _to_location_id: origem,
        _reason_code: "compra",
        _unit_cost_cents: 1500 + i,
      },
      {
        _kind: "saida",
        _variant_id: variante,
        _quantity: 2,
        _from_location_id: origem,
        _reason_code: "venda",
      },
      {
        _kind: "transferencia",
        _variant_id: variante,
        _quantity: 1,
        _from_location_id: origem,
        _to_location_id: destino,
        _reason_code: "transferencia",
      },
    ];
    if (i % 5 === 0)
      passos.push({
        _kind: "ajuste",
        _variant_id: variante,
        _quantity: 1,
        _to_location_id: origem,
        _reason_code: "ajuste_positivo",
      });
    if (i % 7 === 0)
      passos.push({
        _kind: "inventario",
        _variant_id: variante,
        _quantity: 0,
        _to_location_id: destino,
        _reason_code: "contagem",
      });

    for (const [n, p] of passos.entries()) {
      const ok = await rpcComToken(token, "register_stock_movement", {
        ...p,
        _reference: `${PREFIXO}-MOV-${i}-${n}`,
        _idempotency_key: `${PREFIXO}-MOV-${i}-${n}`,
      });
      if (ok) movs++;
    }
  }
  relatorio["movimentacoes"] = movs;

  return relatorio;
}

/* ---------------------------------------------- operador sintético ----- */

const EMAIL_OPERADOR = "homolog.massa@lardan.test";
const SENHA_OPERADOR = "Homolog#2026!Lardan";

async function tokenOperador() {
  const cab = {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    "Content-Type": "application/json",
  };
  const lista = await fetch(`${URL}/auth/v1/admin/users?per_page=200`, { headers: cab }).then((r) =>
    r.json(),
  );
  let user = (lista.users as { id: string; email: string }[] | undefined)?.find(
    (u) => u.email === EMAIL_OPERADOR,
  );
  if (!user) {
    user = await fetch(`${URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: cab,
      body: JSON.stringify({
        email: EMAIL_OPERADOR,
        password: SENHA_OPERADOR,
        email_confirm: true,
      }),
    }).then((r) => r.json());
  }
  await db.from("profiles").upsert({
    id: user!.id,
    full_name: `${PREFIXO} Operador da massa`,
    email: EMAIL_OPERADOR,
    is_active: true,
  } as never);
  await db
    .from("user_roles")
    .upsert({ user_id: user!.id, role: "master" } as never, { onConflict: "user_id,role" });
  const sessao = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL_OPERADOR, password: SENHA_OPERADOR }),
  }).then((r) => r.json());
  if (!sessao.access_token)
    throw new Error("Não foi possível abrir sessão do operador de homologação.");
  return sessao.access_token as string;
}

async function removerOperador() {
  const cab = {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    "Content-Type": "application/json",
  };
  const lista = await fetch(`${URL}/auth/v1/admin/users?per_page=200`, { headers: cab }).then((r) =>
    r.json(),
  );
  const user = (lista.users as { id: string; email: string }[] | undefined)?.find(
    (u) => u.email === EMAIL_OPERADOR,
  );
  if (user)
    await fetch(`${URL}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers: cab });
}

async function rpcComToken(token: string, nome: string, args: Record<string, unknown>) {
  const r = await fetch(`${URL}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) {
    const t = await r.text();
    if (!t.includes("Origem e destino") && !t.includes("Saldo"))
      console.warn(`  aviso ${nome}: ${t.slice(0, 120)}`);
    return false;
  }
  return true;
}

/* ------------------------------------------------------------ relatório */

async function contar() {
  const n = async (tabela: string, coluna: string, padrao: string) => {
    const { count } = await db
      .from(tabela)
      .select("*", { count: "exact", head: true })
      .like(coluna, padrao);
    return count ?? 0;
  };
  return {
    pessoas: await n("parties", "notes", `${PREFIXO}%`),
    consultoras: await n("consultant_profiles", "origin", `${PREFIXO}%`),
    fornecedores: await n("suppliers", "name", `${PREFIXO}%`),
    entidades: await n("business_entities", "legal_name", `${PREFIXO}%`),
    categorias: await n("categories", "slug", "homolog-%"),
    colecoes: await n("collections", "slug", "homolog-%"),
    produtos: await n("products", "slug", "homolog-%"),
    produtos_publicados: await (async () => {
      const { count } = await db
        .from("products")
        .select("*", { count: "exact", head: true })
        .like("slug", "homolog-%")
        .eq("status", "publicado");
      return count ?? 0;
    })(),
    variantes: await n("product_variants", "sku", `${PREFIXO}%`),
    locais: await n("locations", "code", `${PREFIXO}%`),
    movimentacoes: await n("stock_movements", "reference", `${PREFIXO}%`),
  };
}

/* ------------------------------------------------------------- guarda -- */

function permitido(acao: string) {
  if (process.env["LARDAN_MASSA"] !== "1") {
    console.error("Recusado: defina LARDAN_MASSA=1 para usar a massa de homologação.");
    return false;
  }
  const producao = process.env["LARDAN_ENV"] === "producao";
  if (producao && !process.argv.includes("--producao")) {
    console.error(`Recusado: ${acao} em produção exige --producao explícito.`);
    return false;
  }
  return true;
}

/* --------------------------------------------------------------- main -- */

const acao = process.argv[2] ?? "relatorio";

if (acao === "criar") {
  if (!permitido("criar massa")) process.exit(1);
  console.log("Criando massa sintética de homologação…");
  const r = await criar();
  console.table(r);
  console.table(await contar());
} else if (acao === "limpar") {
  if (!permitido("limpar massa")) process.exit(1);
  // Movimentações são imutáveis por gatilho: só a rotina interna as remove.
  const movs = await db.rpc("homolog_purge_movimentos" as never, { _prefix: PREFIXO } as never);
  if (movs.error) throw new Error(movs.error.message);
  const { data, error } = await db.rpc("homolog_purge" as never, { _prefix: PREFIXO } as never);
  if (error) throw new Error(error.message);
  console.log(`movimentações removidas: ${String(movs.data)}`);
  await removerOperador();
  console.log("Massa removida:");
  console.table(data);
  console.table(await contar());
} else {
  console.table(await contar());
}
