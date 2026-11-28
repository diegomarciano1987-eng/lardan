import { isPublicAnalyticsPath } from "@/lib/analytics";
import { permitsOrdinaryAds } from "@/lib/ad-consent";

export const GOOGLE_CONTAINER_ID = "GTM-WK8WWR2R";
let loaded = false;
let currentPath = "";

export function setGoogleTagRoute(path: string): void {
  currentPath = path;
  // A GTM container may install arbitrary listeners. A fresh private document
  // is the boundary that removes those listeners, not just its script element.
  if (loaded && !isPublicAnalyticsPath(path)) window.location.assign(path);
}

export async function initGoogleTagManager(path: string): Promise<void> {
  currentPath = path;
  if (typeof window === "undefined" || !isPublicAnalyticsPath(path)) return;
  const allowed = await permitsOrdinaryAds();
  if (!allowed || currentPath !== path || !isPublicAnalyticsPath(currentPath)) return;
  if (loaded || document.querySelector(`script[data-gtm-id="${GOOGLE_CONTAINER_ID}"]`)) return;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag?.("set", "developer_id.dZjgwMW", true);
  window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  const script = document.createElement("script");
  script.defer = true;
  script.dataset["gtmId"] = GOOGLE_CONTAINER_ID;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${GOOGLE_CONTAINER_ID}`;
  loaded = true;
  document.head.appendChild(script);
}

export async function refreshGoogleTagPermission(path: string): Promise<void> {
  if (loaded && !(await permitsOrdinaryAds())) {
    // The refusal is already persisted and its signals updated. Reloading
    // removes tags injected by the container; the next page never loads them.
    window.location.reload();
    return;
  }
  await initGoogleTagManager(path);
}