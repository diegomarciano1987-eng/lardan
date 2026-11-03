import { useEffect, useState } from "react";

export type TemaConsultora = "dark" | "light";
const CHAVE = "lardan-consultora-tema";
const EVENTO = "lardan:consultora-tema";

/** Abre sempre no claro (padrão Diego 03/11/2026); escuro só quando escolhido explicitamente. */
export function resolverTemaConsultora(salvo: string | null | undefined): TemaConsultora {
  return salvo === "dark" ? "dark" : "light";
}

export function definirTemaConsultora(t: TemaConsultora) {
  try { localStorage.setItem(CHAVE, t); } catch { /* vale só nesta sessão */ }
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: t }));
}

/** Lido após hidratação para não divergir do HTML do servidor. */
export function useTemaConsultora(): TemaConsultora {
  const [tema, setTema] = useState<TemaConsultora>("light");
  useEffect(() => {
    try { setTema(resolverTemaConsultora(localStorage.getItem(CHAVE))); } catch { /* padrão claro */ }
    const ouvir = (e: Event) => setTema(resolverTemaConsultora((e as CustomEvent).detail));
    window.addEventListener(EVENTO, ouvir);
    return () => window.removeEventListener(EVENTO, ouvir);
  }, []);
  return tema;
}
