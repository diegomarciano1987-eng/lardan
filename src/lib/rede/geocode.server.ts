/**
 * Localização dos endereços já cadastrados.
 *
 * Regras deste arquivo:
 * - nada roda no navegador e nenhum dado pessoal vai para o provedor: só o CEP;
 * - endereços iguais são consultados uma única vez (impressão digital + cache);
 * - processamento em lotes pequenos, com checkpoint, pausa, retomada e idempotência;
 * - quando não houver coordenada, a consultora continua contando no município e
 *   no estado, com precisão declarada como aproximada.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const HOSTS_PERMITIDOS = new Set(["brasilapi.com.br"]);
const TIMEOUT_MS = 4500;
const PAUSA_ENTRE_CONSULTAS_MS = 250;
export const VERSAO_NORMALIZADOR = "geo-1";
export const TAMANHO_LOTE_PADRAO = 40;

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

async function buscarCep(cep: string): Promise<Coordenada | null | "falha"> {
  const url = `https://brasilapi.com.br/api/cep/v2/${cep}`;
  if (!HOSTS_PERMITIDOS.has(new URL(url).hostname)) return "falha";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": "LardanCloud/1.0" },
    });
    if (r.status === 404) return null;
    if (!r.ok) return "falha";
    const j = (await r.json()) as {
      location?: { coordinates?: { latitude?: string; longitude?: string } };
    };
    const lat = Number(j.location?.coordinates?.latitude);
    const lon = Number(j.location?.coordinates?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;
    return { latitude: lat, longitude: lon, precisao: "cep", fonte: "brasilapi-cep-v2" };
  } catch {
    return "falha";
  } finally {
    clearTimeout(t);
  }
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Um lote seguro e retomável. Chamar de novo continua de onde parou. */
export async function processarLote(
  userId: string | null,
  limite = TAMANHO_LOTE_PADRAO,
): Promise<ResumoLote> {
  const db = supabaseAdmin;

  // Idempotência: um lote em andamento recente não é duplicado por clique repetido.
  const { data: emAndamento } = await db
    .from("geocode_batches")
    .select("*")
    .eq("status", "processando")
    .gte("started_at", new Date(Date.now() - 3 * 60_000).toISOString())
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

  const pendentes = await db
    .from("party_addresses")
    .select("id, postal_code, city, uf, ibge_city_code, geo_hash, geo_status")
    .in("geo_status", ["nao_solicitado", "desatualizado", "falha_temporaria"])
    .order("updated_at", { ascending: true })
    .limit(limite);

  if (pendentes.error) throw pendentes.error;
  const linhas = pendentes.data ?? [];

  const { data: lote, error: erroLote } = await db
    .from("geocode_batches")
    .insert({
      status: "processando",
      escopo: { limite },
      total: linhas.length,
      started_at: new Date().toISOString(),
      created_by: userId,
    })
    .select()
    .single();
  if (erroLote) throw erroLote;

  const centroides = await db.from("uf_centroides").select("uf, latitude, longitude");
  const porUf = new Map(
    (centroides.data ?? []).map((c) => [c.uf, { lat: Number(c.latitude), lon: Number(c.longitude) }]),
  );

  const resolvidos = new Map<string, Coordenada | null>();
  let processados = 0;
  let localizados = 0;
  let aproximados = 0;
  let falhas = 0;
  let checkpoint: string | null = null;

  for (const linha of linhas) {
    const digitos = (linha.postal_code ?? "").replace(/\D/g, "");
    const chave = linha.geo_hash ?? linha.id;
    let coord: Coordenada | null | undefined = resolvidos.get(chave);

    if (coord === undefined) {
      // 1. cache de localizações já obtidas
      const { data: cache } = await db
        .from("geocode_cache")
        .select("*")
        .eq("geo_hash", chave)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (cache && cache.latitude != null && cache.longitude != null) {
        coord = {
          latitude: Number(cache.latitude),
          longitude: Number(cache.longitude),
          precisao: cache.precision as Precisao,
          fonte: cache.source,
        };
      } else if (digitos.length === 8) {
        const r = await buscarCep(digitos);
        await espera(PAUSA_ENTRE_CONSULTAS_MS);
        if (r === "falha") {
          coord = undefined;
          await db
            .from("party_addresses")
            .update({
              geo_status: "falha_temporaria",
              geo_attempted_at: new Date().toISOString(),
              geo_error: "provedor indisponível ou tempo esgotado",
              geo_normalizer_version: VERSAO_NORMALIZADOR,
            })
            .eq("id", linha.id);
          falhas += 1;
          processados += 1;
          checkpoint = linha.id;
          continue;
        }
        coord = r;
        if (coord) {
          await db.from("geocode_cache").upsert({
            geo_hash: chave,
            postal_digits: digitos,
            ibge_city_code: linha.ibge_city_code,
            uf: linha.uf,
            latitude: coord.latitude,
            longitude: coord.longitude,
            precision: coord.precisao,
            source: coord.fonte,
            fetched_at: new Date().toISOString(),
          });
        }
      } else {
        coord = null;
      }
      resolvidos.set(chave, coord ?? null);
    }

    let status: string;
    let precisao: Precisao | null = null;
    let fonte: string | null = null;
    let lat: number | null = null;
    let lon: number | null = null;

    if (coord) {
      lat = coord.latitude;
      lon = coord.longitude;
      precisao = coord.precisao;
      fonte = coord.fonte;
      status = "localizado_cep";
      localizados += 1;
    } else if (linha.uf && porUf.has(linha.uf)) {
      const c = porUf.get(linha.uf)!;
      lat = c.lat;
      lon = c.lon;
      precisao = "estado";
      fonte = "centroide-uf-ibge";
      status = "aproximado_estado";
      aproximados += 1;
    } else {
      status = digitos.length === 8 ? "cep_nao_localizado" : "endereco_incompleto";
      falhas += 1;
    }

    await db
      .from("party_addresses")
      .update({
        latitude: lat,
        longitude: lon,
        geo_precision: precisao,
        geo_source: fonte,
        geo_status: status,
        geo_attempted_at: new Date().toISOString(),
        geo_located_at: lat != null ? new Date().toISOString() : null,
        geo_error: null,
        geo_normalizer_version: VERSAO_NORMALIZADOR,
      })
      .eq("id", linha.id);

    processados += 1;
    checkpoint = linha.id;

    if (processados % 10 === 0) {
      await db
        .from("geocode_batches")
        .update({ processados, localizados, aproximados, falhas, checkpoint, updated_at: new Date().toISOString() })
        .eq("id", lote.id);
    }
  }

  const { data: restantesQtd } = await db
    .from("party_addresses")
    .select("id", { count: "exact", head: true })
    .in("geo_status", ["nao_solicitado", "desatualizado", "falha_temporaria"]);
  void restantesQtd;

  const restantes = await db
    .from("party_addresses")
    .select("*", { count: "exact", head: true })
    .in("geo_status", ["nao_solicitado", "desatualizado", "falha_temporaria"]);

  await db
    .from("geocode_batches")
    .update({
      status: "concluido",
      processados,
      localizados,
      aproximados,
      falhas,
      checkpoint,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", lote.id);

  return {
    batch_id: lote.id,
    status: "concluido",
    total: linhas.length,
    processados,
    localizados,
    aproximados,
    falhas,
    restantes: restantes.count ?? 0,
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
  const { data: ultimo } = await db
    .from("geocode_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { contagem, ultimo_lote: ultimo ?? null };
}
