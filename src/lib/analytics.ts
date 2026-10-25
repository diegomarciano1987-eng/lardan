// Google Analytics 4 (gtag.js) — inicialização única no navegador.
// O ID de medição vem do servidor (segredo do projeto) via /api/public/ga-config.

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let measurementId: string | null = null;
let initPromise: Promise<string | null> | null = null;
let currentPath = "";

/** ERP, login and account pages never use the public site's measurement ID. */
export function isPublicAnalyticsPath(path: string): boolean {
  const pathname = path.split(/[?#]/)[0] ?? "";
  if (!pathname.startsWith("/")) return false;
  return !/^\/(admin|consultora|representante|financeiro|pdv|acesso|equipe|convite|redefinir-senha|lovable|api|minha-conta)(?:\/|-|$)/i.test(pathname);
}

/** Also disables gtag's automatic events before entering the ERP. */
export function setAnalyticsRoute(path: string): void {
  currentPath = path;
  if (typeof window === "undefined" || !measurementId) return;
  Object.assign(window, { [`ga-disable-${measurementId}`]: !isPublicAnalyticsPath(path) });
}

async function loadMeasurementId(): Promise<string | null> {
  if (measurementId) return measurementId;
  if (!initPromise) {
    initPromise = fetch("/api/public/ga-config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { id?: string | null } | null) => {
        const id = (data?.id ?? "").trim();
        measurementId = id || null;
        return measurementId;
      })
      .catch(() => null);
  }
  return initPromise;
}

function injectGtag(id: string) {
  if (document.querySelector(`script[data-ga-id="${id}"]`)) return;

  // A fila precisa existir ANTES do script e o gtag precisa empilhar o objeto
  // `arguments` — o gtag.js ignora arrays comuns, e era por isso que nenhuma
  // visita chegava ao Google Analytics.
  window.dataLayer = window.dataLayer ?? [];
  function gtag() {
    if (!isPublicAnalyticsPath(currentPath)) return;
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer?.push(arguments);
  }
  window.gtag = gtag as unknown as (...args: unknown[]) => void;
  window.gtag("js", new Date());
  // All initial and SPA views go through the same public-only guard.
  window.gtag("config", id, { send_page_view: false });

  const script = document.createElement("script");
  script.async = true;
  script.dataset["gaId"] = id;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}

/** Inicializa o GA uma única vez. Seguro chamar em todo carregamento. */
export async function initAnalytics(): Promise<void> {
  if (typeof window === "undefined" || !isPublicAnalyticsPath(currentPath)) return;
  const id = await loadMeasurementId();
  setAnalyticsRoute(currentPath);
  // The visitor may have entered the ERP while the config request was pending.
  if (id && isPublicAnalyticsPath(currentPath)) injectGtag(id);
}

/** Registra a visualização de uma rota interna (SPA). */
export async function trackPageView(path: string): Promise<void> {
  setAnalyticsRoute(path);
  if (!isPublicAnalyticsPath(path)) return;
  await initAnalytics();
  if (currentPath !== path || typeof window === "undefined" || !window.gtag || !measurementId) return;
  window.gtag("event", "page_view", {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
    // Do not leak the previous ERP URL into a public page's referrer.
    page_referrer: document.referrer && isPublicAnalyticsPath(new URL(document.referrer).pathname)
      ? document.referrer : "",
    send_to: measurementId,
  });
}
