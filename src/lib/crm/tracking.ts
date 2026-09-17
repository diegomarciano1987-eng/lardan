/**
 * LARDAN — captura de origem do formulário público.
 *
 * Limite honesto: só é registrado o que o navegador realmente informa. Quando
 * não há UTM nem referência, a origem fica "não identificada"; o sistema NÃO
 * deduz canal (navegadores, aplicativos e assistentes podem omitir o referrer).
 * Nada aqui é impressão digital de dispositivo: apenas parâmetros de campanha,
 * página de entrada, referência e idioma. IP e user-agent são lidos no servidor.
 */

const CHAVE_PRIMEIRO = "lardan.first_touch.v1";
const LIMITE = 300;

export interface TrackingCliente {
  landing_page?: string | undefined;
  referrer?: string | undefined;
  first_referrer?: string | undefined;
  first_landing_page?: string | undefined;
  first_at?: string | undefined;
  language?: string | undefined;
  gclid?: string | undefined;
  fbclid?: string | undefined;
  msclkid?: string | undefined;
  utm: Record<string, string>;
}

const corta = (v: string | null | undefined) =>
  v && v.trim() !== "" ? v.trim().slice(0, LIMITE) : undefined;

function lerPrimeiroContato(): Partial<TrackingCliente> {
  try {
    const bruto = window.localStorage.getItem(CHAVE_PRIMEIRO);
    return bruto ? (JSON.parse(bruto) as Partial<TrackingCliente>) : {};
  } catch {
    return {};
  }
}

/**
 * Grava o primeiro contato apenas uma vez por navegador. O primeiro nunca é
 * sobrescrito; o último contato é sempre o da visita atual.
 */
export function registrarPrimeiroContato(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(CHAVE_PRIMEIRO)) return;
    const params = new URLSearchParams(window.location.search);
    const utm: Record<string, string> = {};
    for (const [k, v] of params.entries()) {
      if (k.startsWith("utm_")) utm[k] = v.slice(0, LIMITE);
    }
    window.localStorage.setItem(
      CHAVE_PRIMEIRO,
      JSON.stringify({
        first_referrer: corta(document.referrer),
        first_landing_page: corta(window.location.href),
        first_at: new Date().toISOString(),
        utm,
      }),
    );
  } catch {
    /* navegador sem armazenamento: seguimos apenas com o último contato */
  }
}

/** Monta os dados de origem desta visita, somados ao primeiro contato conhecido. */
export function capturarTracking(): TrackingCliente {
  if (typeof window === "undefined") return { utm: {} };
  const params = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const [k, v] of params.entries()) {
    if (k.startsWith("utm_")) utm[k] = v.slice(0, LIMITE);
  }
  const primeiro = lerPrimeiroContato();
  return {
    landing_page: corta(window.location.href),
    referrer: corta(document.referrer),
    first_referrer: primeiro.first_referrer ?? corta(document.referrer),
    first_landing_page: primeiro.first_landing_page ?? corta(window.location.href),
    first_at: primeiro.first_at,
    language: corta(navigator.language),
    gclid: corta(params.get("gclid")),
    fbclid: corta(params.get("fbclid")),
    msclkid: corta(params.get("msclkid")),
    utm: Object.keys(utm).length > 0 ? utm : (primeiro.utm ?? {}),
  };
}
