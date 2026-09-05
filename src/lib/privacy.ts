/**
 * Versão do aviso de privacidade vigente. Toda submissão de formulário grava
 * esta versão junto do registro, para provar sob qual texto o consentimento
 * foi dado. Ao publicar um novo aviso, incrementar aqui.
 */
export const PRIVACY_VERSION = "2026-09-05.v1";

export type Utm = Record<string, string>;

/** Captura parâmetros de campanha da URL atual (somente no navegador). */
export function captureUtm(): Utm {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const utm: Utm = {};
  for (const [key, value] of params.entries()) {
    if (key.startsWith("utm_") || key === "gclid" || key === "fbclid") {
      utm[key] = value.slice(0, 200);
    }
  }
  return utm;
}

export function entryUrl(): string | null {
  if (typeof window === "undefined") return null;
  return window.location.href.slice(0, 500);
}
