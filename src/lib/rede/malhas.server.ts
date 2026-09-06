/**
 * Malhas oficiais do IBGE (GeoJSON simplificado), servidas pelo próprio sistema.
 * O navegador nunca escolhe a URL e a malha é guardada em cache para não
 * repetir download a cada abertura do mapa.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const HOST = "servicodados.ibge.gov.br";
const TIMEOUT_MS = 8000;
const TTL_DIAS = 60;

export type NivelMalha = "brasil" | "estado";

function urlDaMalha(nivel: NivelMalha, codigoUf?: string) {
  const base = "https://servicodados.ibge.gov.br/api/v3/malhas";
  const formato = "formato=application/vnd.geo+json&qualidade=minima";
  return nivel === "brasil"
    ? `${base}/paises/BR?${formato}&intrarregiao=UF`
    : `${base}/estados/${codigoUf}?${formato}&intrarregiao=municipio`;
}

export async function carregarMalha(nivel: NivelMalha, codigoUf?: string) {
  const chave = nivel === "brasil" ? "malha:brasil-uf" : `malha:uf-${codigoUf}`;
  const db = supabaseAdmin;

  const { data: cache } = await db
    .from("integration_cache")
    .select("payload, fetched_at")
    .eq("provider", "ibge-malhas")
    .eq("chave", chave)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (cache?.payload) return { origem: "cache" as const, malha: cache.payload };

  const url = urlDaMalha(nivel, codigoUf);
  if (new URL(url).hostname !== HOST) throw new Error("host não permitido");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`malha indisponível (${r.status})`);
    const malha = await r.json();
    await db.from("integration_cache").upsert({
      provider: "ibge-malhas",
      chave,
      payload: malha,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + TTL_DIAS * 86_400_000).toISOString(),
    });
    return { origem: "provedor" as const, malha };
  } finally {
    clearTimeout(t);
  }
}
