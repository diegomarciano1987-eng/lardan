/**
 * Localização dos endereços já cadastrados (geo-2: rua → CEP → centro da cidade → estado).
 *
 * Regras deste arquivo:
 * - nada roda no navegador; para o provedor só vai rua + cidade + UF (ou só o CEP),
 *   nunca nome, número, complemento ou documento;
 * - endereços iguais são consultados uma única vez (cache por rua/cidade e por CEP);
 * - lotes curtos com orçamento de tempo, trava contra lote duplicado e retomada natural
 *   (a fila é recalculada a cada chamada);
 * - quem não é localizado continua no mapa no centro da cidade, com precisão declarada.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { chaveRua, distanciaM, normalizarRua, resultadoNaCidade, type ResultadoNominatim } from "./geocode-regras";

const HOSTS_PERMITIDOS = new Set(["brasilapi.com.br", "nominatim.openstreetmap.org"]);
const TIMEOUT_MS = 6000;
const PAUSA_NOMINATIM_MS = 1100; // política de uso: no máximo 1 consulta por segundo
const PAUSA_BRASILAPI_MS = 250;
const USER_AGENT = "LardanCloud/1.0 (+https://www.lardan.com.br)";
export const VERSAO_NORMALIZADOR = "geo-2";
export const TAMANHO_LOTE_PADRAO = 20;
const CACHE_DIAS = 365;

export type Precisao = "endereco" | "cep" | "municipio" | "estado";

export interface ResumoLote {
  batch_id: string;
  status: string;
  total: number;
  processados: number;
  localizados: number;
  aproximados: number;
  falhas: number;
  restantes: number;
  mensagem: string | null;
}

interface Coordenada {
  latitude: number;
  longitude: number;
  precisao: Precisao;
  fonte: string;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ultimaNominatim = 0;

async function obterJson(url: string): Promise<unknown | null | "falha"> {
  if (!HOSTS_PERMITIDOS.has(new URL(url).hostname)) return "falha";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json", "user-agent": USER_AGENT } });
    if (r.status === 404) return null;
    if (!r.ok) return "falha";
    return await r.json();
  } catch {
    return "falha";
  } finally {
    clearTimeout(t);
  }
}

async function nominatim(params: Record<string, string>): Promise<ResultadoNominatim[] | "falha"> {
  const falta = ultimaNominatim + PAUSA_NOMINATIM_MS - Date.now();
  if (falta > 0) await espera(falta);
  ultimaNominatim = Date.now();
  const q = new URLSearchParams({ format: "jsonv2", addressdetails: "1", limit: "3", countrycodes: "br", ...params });
  const j = await obterJson(`https://nominatim.openstreetmap.org/search?${q}`);
  if (j === "falha") return "falha";
  return Array.isArray(j) ? (j as ResultadoNominatim[]) : [];
}

async function buscarRua(rua: string, cidade: string, uf: string): Promise<Coordenada | null | "falha"> {
  const r = await nominatim({ street: rua, city: cidade, state: uf });
  if (r === "falha") return "falha";
  for (const x of r) {
    const ok = resultadoNaCidade(x, cidade);
    if (ok) return { latitude: ok.lat, longitude: ok.lng, precisao: "endereco", fonte: "osm-nominatim-rua" };
  }
  return null;
}

async function buscarCentroCidade(cidade: string, uf: string): Promise<Coordenada | null | "falha"> {
  const r = await nominatim({ city: cidade, state: uf });
  if (r === "falha") return "falha";
  const x = r[0];
  if (!x) return null;
  const lat = Number(x.lat);
  const lng = Number(x.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng, precisao: "municipio", fonte: "osm-nominatim-cidade" };
}

async function buscarCep(cep: string): Promise<Coordenada | null | "falha"> {
  const j = (await obterJson(`https://brasilapi.com.br/api/cep/v2/${cep}`)) as
    | { location?: { coordinates?: { latitude?: string; longitude?: string } } }
    | null
    | "falha";
  await espera(PAUSA_BRASILAPI_MS);
  if (j === "falha") return "falha";
  if (!j) return null;
  const lat = Number(j.location?.coordinates?.latitude);
  const lon = Number(j.location?.coordinates?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;
  return { latitude: lat, longitude: lon, precisao: "cep", fonte: "brasilapi-cep-v2" };
}

type Db = typeof supabaseAdmin;

async function lerCache(db: Db, chave: string): Promise<Coordenada | null | undefined> {
  const { data } = await db.from("geocode_cache").select("*").eq("geo_hash", chave).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!data) return undefined;
  if (data.latitude == null || data.longitude == null) return null; // "não existe" também fica guardado
  return { latitude: Number(data.latitude), longitude: Number(data.longitude), precisao: data.precision as Precisao, fonte: data.source };
}

async function gravarCache(db: Db, chave: string, c: Coordenada | null, extra: { postal?: string | null; ibge?: string | null; uf?: string | null; fonte: string }) {
  await db.from("geocode_cache").upsert({
    geo_hash: chave,
    postal_digits: extra.postal ?? null,
    ibge_city_code: extra.ibge ?? null,
    uf: extra.uf ?? null,
    latitude: c?.latitude ?? null,
    longitude: c?.longitude ?? null,
    precision: c?.precisao ?? "estado",
    source: c?.fonte ?? extra.fonte,
    fetched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + (c ? CACHE_DIAS : 60) * 86_400_000).toISOString(),
  });
}

/** Busca com cache; "falha" = provedor fora (tentar de novo depois). */
async function comCache(
  db: Db,
  chave: string,
  buscar: () => Promise<Coordenada | null | "falha">,
  extra: { postal?: string | null; ibge?: string | null; uf?: string | null; fonte: string },
): Promise<Coordenada | null | "falha"> {
  const c = await lerCache(db, chave);
  if (c !== undefined) return c;
  const r = await buscar();
  if (r !== "falha") await gravarCache(db, chave, r, extra);
  return r;
}

/** Um lote curto e retomável. `orcamentoMs` limita o tempo total (agendamento tem poucos segundos). */
export async function processarLote(
  userId: string | null,
  limite = TAMANHO_LOTE_PADRAO,
  opcoes: { ibge?: string | null; orcamentoMs?: number } = {},
): Promise<ResumoLote> {
  const db = supabaseAdmin;
  const inicio = Date.now();
  const orcamento = opcoes.orcamentoMs ?? 25_000;

  // Trava: um lote recente em andamento não é duplicado por clique repetido ou agendamento.
  const { data: emAndamento } = await db
    .from("geocode_batches")
    .select("*")
    .eq("status", "processando")
    .gte("started_at", new Date(Date.now() - 60_000).toISOString())
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (emAndamento) {
    return {
      batch_id: emAndamento.id,
      status: emAndamento.status,
      total: emAndamento.total,
      processados: emAndamento.processados,
      localizados: emAndamento.localizados,
      aproximados: emAndamento.aproximados,
      falhas: emAndamento.falhas,
      restantes: Math.max(0, emAndamento.total - emAndamento.processados),
      mensagem: "Já existe um lote em andamento.",
    };
  }

  const fila = await db.rpc("geo_fila_proxima", opcoes.ibge ? { _limite: limite, _ibge: opcoes.ibge } : { _limite: limite });
  if (fila.error) throw fila.error;
  const linhas = fila.data ?? [];

  const { data: lote, error: erroLote } = await db
    .from("geocode_batches")
    .insert({
      status: "processando",
      escopo: { limite, ibge: opcoes.ibge ?? null, versao: VERSAO_NORMALIZADOR },
      total: linhas.length,
      started_at: new Date().toISOString(),
      created_by: userId,
    })
    .select()
    .single();
  if (erroLote) throw erroLote;

  const centroides = await db.from("uf_centroides").select("uf, latitude, longitude");
  const porUf = new Map((centroides.data ?? []).map((c) => [c.uf, { lat: Number(c.latitude), lon: Number(c.longitude) }]));

  let processados = 0;
  let localizados = 0;
  let aproximados = 0;
  let falhas = 0;
  let checkpoint: string | null = null;

  for (const linha of linhas) {
    if (Date.now() - inicio > orcamento) break;
    const cidade = (linha.city ?? "").trim();
    const uf = (linha.uf ?? "").trim().toUpperCase();
    const digitos = (linha.postal_code ?? "").replace(/\D/g, "");
    const rua = normalizarRua(linha.street);
    let provedorFora = false;

    // 1. rua + cidade
    let coord: Coordenada | null = null;
    if (rua && cidade && uf) {
      const r = await comCache(db, chaveRua(rua, cidade, uf), () => buscarRua(rua, cidade, uf), { ibge: linha.ibge_city_code, uf, fonte: "osm-nominatim-rua" });
      if (r === "falha") provedorFora = true;
      else coord = r;
    }

    // centro da cidade (para reconhecer CEP genérico e como último recurso)
    let centro: Coordenada | null = null;
    if (cidade && uf && (!coord || digitos.length === 8)) {
      const chaveMun = `mun:${linha.ibge_city_code ?? `${cidade}|${uf}`}`;
      const r = await comCache(db, chaveMun, () => buscarCentroCidade(cidade, uf), { ibge: linha.ibge_city_code, uf, fonte: "osm-nominatim-cidade" });
      if (r === "falha") provedorFora = true;
      else centro = r;
    }

    // 2. CEP (só vale se não for o centro da cidade disfarçado)
    if (!coord && digitos.length === 8) {
      const r = await comCache(db, `cep:${digitos}`, () => buscarCep(digitos), { postal: digitos, ibge: linha.ibge_city_code, uf, fonte: "brasilapi-cep-v2" });
      if (r === "falha") provedorFora = true;
      else if (r) {
        const generico = centro && distanciaM({ lat: r.latitude, lng: r.longitude }, { lat: centro.latitude, lng: centro.longitude }) < 600;
        coord = generico ? { ...r, precisao: "municipio" } : r;
      }
    }

    // Já tinha posição e o provedor caiu: mantém o que tinha, tenta depois.
    if (!coord && provedorFora) {
      if (linha.latitude == null) {
        await db
          .from("party_addresses")
          .update({ geo_status: "falha_temporaria", geo_attempted_at: new Date().toISOString(), geo_error: "provedor indisponível ou tempo esgotado" })
          .eq("id", linha.id);
      }
      falhas += 1;
      processados += 1;
      checkpoint = linha.id;
      continue;
    }

    // Refinamento: não piorar quem já tinha CEP preciso.
    const tinhaPreciso = linha.latitude != null && (linha.geo_precision === "endereco" || linha.geo_precision === "cep");
    if (!coord && centro) coord = centro;
    if (coord && tinhaPreciso && coord.precisao !== "endereco" && coord.precisao !== "cep") coord = null;

    let status: string;
    const patch: Record<string, unknown> = { geo_attempted_at: new Date().toISOString(), geo_error: null, geo_normalizer_version: VERSAO_NORMALIZADOR };
    if (coord) {
      Object.assign(patch, { latitude: coord.latitude, longitude: coord.longitude, geo_precision: coord.precisao, geo_source: coord.fonte, geo_located_at: new Date().toISOString() });
      status = coord.precisao === "endereco" ? "localizado_endereco" : coord.precisao === "cep" ? "localizado_cep" : "aproximado_municipio";
      if (coord.precisao === "endereco" || coord.precisao === "cep") localizados += 1;
      else aproximados += 1;
    } else if (tinhaPreciso) {
      status = linha.geo_status ?? "localizado_cep"; // mantém posição anterior
      localizados += 1;
    } else if (uf && porUf.has(uf)) {
      const c = porUf.get(uf)!;
      Object.assign(patch, { latitude: c.lat, longitude: c.lon, geo_precision: "estado", geo_source: "centroide-uf-ibge", geo_located_at: new Date().toISOString() });
      status = "aproximado_estado";
      aproximados += 1;
    } else {
      status = digitos.length === 8 ? "cep_nao_localizado" : "endereco_incompleto";
      falhas += 1;
    }
    patch["geo_status"] = status;
    await db.from("party_addresses").update(patch as never).eq("id", linha.id);

    processados += 1;
    checkpoint = linha.id;
    if (processados % 5 === 0) {
      await db.from("geocode_batches").update({ processados, localizados, aproximados, falhas, checkpoint, updated_at: new Date().toISOString() }).eq("id", lote.id);
    }
  }

  const rest = await db.rpc("geo_fila_restantes", opcoes.ibge ? { _ibge: opcoes.ibge } : {});
  if (rest.error) console.error("[geo] restantes", rest.error.message);
  const restantes = rest.error ? -1 : rest.data;

  await db
    .from("geocode_batches")
    .update({ status: "concluido", processados, localizados, aproximados, falhas, checkpoint, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", lote.id);

  return {
    batch_id: lote.id,
    status: "concluido",
    total: linhas.length,
    processados,
    localizados,
    aproximados,
    falhas,
    restantes: Number(restantes ?? 0),
    mensagem: linhas.length === 0 ? "Nada pendente de localização." : null,
  };
}

/** Situação geral da localização, sem expor endereço. */
export async function situacaoLocalizacao() {
  const db = supabaseAdmin;
  const { data, error } = await db.from("party_addresses").select("geo_status");
  if (error) throw error;
  const contagem: Record<string, number> = {};
  for (const l of data ?? []) contagem[l.geo_status] = (contagem[l.geo_status] ?? 0) + 1;
  const { data: ultimo } = await db.from("geocode_batches").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: restantes } = await db.rpc("geo_fila_restantes", {});
  return { contagem, ultimo_lote: ultimo ?? null, restantes: Number(restantes ?? 0) };
}
