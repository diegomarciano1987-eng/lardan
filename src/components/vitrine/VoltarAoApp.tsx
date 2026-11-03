import * as React from "react";
import { ChevronLeft } from "lucide-react";

export const MARCA_APP_CONSULTORA = "lardan-app-consultora";

/** Marca esta instalação como app da consultora (chamado na área da consultora). */
export function marcarAppConsultora() {
  try { window.localStorage.setItem(MARCA_APP_CONSULTORA, "1"); } catch { /* sem storage */ }
}

export function appInstalado() {
  return window.matchMedia?.("(display-mode: standalone)").matches === true
    || window.matchMedia?.("(display-mode: fullscreen)").matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Botão "Voltar ao app" na vitrine. Aparece só quando a vitrine abriu dentro do app
 * instalado da consultora (sem barra do navegador). Cliente no navegador nunca vê.
 */
export function VoltarAoApp() {
  const [ver, setVer] = React.useState(false);
  React.useEffect(() => {
    let marca = false;
    try { marca = window.localStorage.getItem(MARCA_APP_CONSULTORA) === "1"; } catch { /* sem storage */ }
    setVer(marca && appInstalado());
  }, []);
  if (!ver) return null;
  return (
    <a
      href="/consultora"
      className="fixed left-3 z-50 inline-flex min-h-12 items-center gap-1.5 rounded-full border border-border bg-background/95 px-4 text-base font-semibold text-foreground shadow-lg backdrop-blur"
      style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}
    >
      <ChevronLeft className="size-5" aria-hidden /> Voltar ao app
    </a>
  );
}
