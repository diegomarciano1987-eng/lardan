import { useEffect, useState } from "react";

export type OperationalTheme = "dark" | "light";

const STORAGE_KEY = "lardan-op-theme";
const EVENT = "lardan-op-theme-change";

/** Tema padrão do sistema privado: sempre escuro ao abrir sem escolha salva. */
export function resolveOperationalTheme(stored: string | null | undefined): OperationalTheme {
  return stored === "light" ? "light" : "dark";
}

export function getOperationalTheme(): OperationalTheme {
  if (typeof window === "undefined") return "dark";
  try {
    return resolveOperationalTheme(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "dark";
  }
}

export function setOperationalTheme(theme: OperationalTheme) {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* armazenamento indisponível: tema vale só nesta sessão */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: theme }));
}

/** Escolha de tema do sistema privado (admin, representante, PDV); nunca toca o site público. */
export function useOperationalTheme(): [OperationalTheme, (t: OperationalTheme) => void] {
  const [theme, setTheme] = useState<OperationalTheme>(getOperationalTheme);
  useEffect(() => {
    const onChange = (e: Event) => setTheme(resolveOperationalTheme((e as CustomEvent).detail));
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return [theme, setOperationalTheme];
}
