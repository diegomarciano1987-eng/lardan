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
const CHAVE_JORNADA = "lardan.jornada.v1";
const LIMITE = 300;
const MAX_CONTEUDOS = 8;

/**
 * Jornada interna de conteúdo. Não é UTM: usar utm_source=site destruiria a
 * atribuição externa. São apenas caminhos internos do próprio site, sem dado
 * pessoal e sem impressão digital.
 */
export interface JornadaEditorial {
  first_content_path?: string | undefined;
  first_content_at?: string | undefined;
  last_content_path?: string | undefined;
  last_content_at?: string | undefined;
  content_paths?: string[] | undefined;
  cta_origin?: string | undefined;
  cta_destination?: string | undefined;
  cta_at?: string | undefined;
}

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
  jornada?: JornadaEditorial | undefined;
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
    // Identificadores de campanha também ficam no primeiro contato: o clique do
    // anúncio pode acontecer vários artigos antes da candidatura.
    const primeiro: Partial<TrackingCliente> = {
      first_referrer: corta(document.referrer),
      first_landing_page: corta(window.location.href),
      first_at: new Date().toISOString(),
      utm,
    };
    const gclid = corta(params.get("gclid"));
    if (gclid) primeiro.gclid = gclid;
    const fbclid = corta(params.get("fbclid"));
    if (fbclid) primeiro.fbclid = fbclid;
    const msclkid = corta(params.get("msclkid"));
    if (msclkid) primeiro.msclkid = msclkid;
    window.localStorage.setItem(CHAVE_PRIMEIRO, JSON.stringify(primeiro));
  } catch {
    /* navegador sem armazenamento: seguimos apenas com o último contato */
  }
}

function lerJornada(): JornadaEditorial {
  try {
    const bruto = window.localStorage.getItem(CHAVE_JORNADA);
    return bruto ? (JSON.parse(bruto) as JornadaEditorial) : {};
  } catch {
    return {};
  }
}

function gravarJornada(j: JornadaEditorial): void {
  try {
    window.localStorage.setItem(CHAVE_JORNADA, JSON.stringify(j));
  } catch {
    /* navegador sem armazenamento: a jornada simplesmente não é registrada */
  }
}

/**
 * Registra a visita a um guia editorial. A primeira página de conteúdo nunca é
 * sobrescrita; a última é sempre a mais recente.
 */
export function registrarVisitaEditorial(path: string): void {
  if (typeof window === "undefined" || !path.startsWith("/")) return;
  const agora = new Date().toISOString();
  const j = lerJornada();
  const caminhos = (j.content_paths ?? []).filter((p) => p !== path);
  caminhos.push(path);
  gravarJornada({
    ...j,
    first_content_path: j.first_content_path ?? path,
    first_content_at: j.first_content_at ?? agora,
    last_content_path: path,
    last_content_at: agora,
    content_paths: caminhos.slice(-MAX_CONTEUDOS),
  });
}

/** Registra o CTA editorial clicado (somente identificadores internos). */
export function registrarCliqueCta(ctaId: string, destino: string): void {
  if (typeof window === "undefined") return;
  const j = lerJornada();
  gravarJornada({
    ...j,
    cta_origin: ctaId.slice(0, 60),
    cta_destination: destino.slice(0, 200),
    cta_at: new Date().toISOString(),
  });
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
    // ID atual quando existe; senão, o do primeiro contato (nunca sobrescrito).
    gclid: corta(params.get("gclid")) ?? primeiro.gclid,
    fbclid: corta(params.get("fbclid")) ?? primeiro.fbclid,
    msclkid: corta(params.get("msclkid")) ?? primeiro.msclkid,
    utm: Object.keys(utm).length > 0 ? utm : (primeiro.utm ?? {}),
    jornada: lerJornada(),
  };
}
