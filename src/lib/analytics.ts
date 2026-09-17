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
  const script = document.createElement("script");
  script.async = true;
  script.dataset["gaId"] = id;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = (...args: unknown[]) => {
    window.dataLayer!.push(args);
  };
  window.gtag("js", new Date());
  // A primeira page_view é enviada pelo próprio config; as trocas de rota
  // internas são enviadas por trackPageView().
  window.gtag("config", id);
}

/** Inicializa o GA uma única vez. Seguro chamar em todo carregamento. */
export async function initAnalytics(): Promise<void> {
  if (typeof window === "undefined") return;
  const id = await loadMeasurementId();
  if (id) injectGtag(id);
}

/** Registra a visualização de uma rota interna (SPA). */
export function trackPageView(path: string): void {
  if (typeof window === "undefined" || !window.gtag || !measurementId) return;
  window.gtag("event", "page_view", { page_path: path });
}
