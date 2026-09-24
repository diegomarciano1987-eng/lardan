import * as React from "react";
import { Maximize2, Minimize2 } from "lucide-react";

/**
 * Tela cheia para as telas de bipagem. Usa a tela cheia do navegador na página
 * inteira e cobre o menu do painel com uma camada fixa, para que listas e
 * seletores (que abrem fora do bloco) continuem visíveis. Esc sai.
 */
export function TelaCheia({ children }: { children: React.ReactNode }) {
  const [ativa, setAtiva] = React.useState(false);

  React.useEffect(() => {
    const aoMudar = () => {
      if (!document.fullscreenElement) setAtiva(false);
    };
    document.addEventListener("fullscreenchange", aoMudar);
    return () => document.removeEventListener("fullscreenchange", aoMudar);
  }, []);

  React.useEffect(() => {
    if (!ativa) return;
    const sair = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) setAtiva(false);
    };
    window.addEventListener("keydown", sair);
    return () => window.removeEventListener("keydown", sair);
  }, [ativa]);

  async function alternar() {
    if (ativa) {
      setAtiva(false);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      return;
    }
    setAtiva(true);
    await document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  const botao = (
    <button type="button" className="admin-btn" onClick={() => void alternar()} aria-pressed={ativa}>
      {ativa ? (
        <>
          <Minimize2 aria-hidden className="mr-2 inline size-4" /> Sair da tela cheia
        </>
      ) : (
        <>
          <Maximize2 aria-hidden className="mr-2 inline size-4" /> Tela cheia
        </>
      )}
    </button>
  );

  return (
    <div
      data-tela-cheia={ativa ? "sim" : "nao"}
      className={ativa ? "fixed inset-0 z-40 overflow-y-auto bg-background p-6 md:p-10" : ""}
    >
      <div className="mb-4 flex justify-end">{botao}</div>
      {children}
    </div>
  );
}
