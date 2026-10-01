import * as React from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import diamante from "@/assets/lardan-diamante.png.asset.json";

type PromptEvt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let guardado: PromptEvt | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); guardado = e as PromptEvt; });
}

const instalado = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true);

const ehIOS = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

/** Botão "Instalar no celular" — aparece só para a consultora logada e some quando já está instalado. */
export function InstalarApp() {
  const [pronto, setPronto] = React.useState(false);
  const [podeAndroid, setPodeAndroid] = React.useState(false);
  const [guia, setGuia] = React.useState(false);

  React.useEffect(() => {
    if (instalado()) return;
    setPronto(true);
    setPodeAndroid(!!guardado);
    const h = () => setPodeAndroid(true);
    const fim = () => setPronto(false);
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", fim);
    return () => { window.removeEventListener("beforeinstallprompt", h); window.removeEventListener("appinstalled", fim); };
  }, []);

  if (!pronto) return null;

  const instalar = async () => {
    if (guardado) {
      await guardado.prompt();
      const r = await guardado.userChoice;
      guardado = null;
      setPodeAndroid(false);
      if (r.outcome === "accepted") setPronto(false);
      return;
    }
    setGuia(true);
  };

  return (
    <>
      <button type="button" onClick={() => void instalar()}
        className="flex w-full items-center gap-4 rounded-2xl border border-primary/30 bg-card p-5 text-left active:bg-muted">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-foreground">
          <img src={diamante.url} alt="" className="w-8" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[1.1rem] font-semibold">Instalar no celular</span>
          <span className="block text-[0.98rem] text-muted-foreground">Ícone na tela inicial e abre em tela cheia</span>
        </span>
        <Download className="size-6 text-primary" aria-hidden />
      </button>

      {guia && (
        <div role="dialog" aria-modal="true" aria-label="Como instalar" className="fixed inset-0 z-[80] flex items-end bg-foreground/50" onClick={() => setGuia(false)}>
          <div className="w-full rounded-t-3xl bg-background p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Instalar a LARDAN</h2>
              <button type="button" onClick={() => setGuia(false)} className="grid size-12 place-items-center rounded-full active:bg-muted" aria-label="Fechar"><X className="size-6" /></button>
            </div>
            {ehIOS() || !podeAndroid ? (
              <ol className="space-y-4 text-[1.05rem]">
                <li className="flex gap-3"><Share className="size-6 shrink-0 text-primary" />{ehIOS() ? "No Safari, toque no botão Compartilhar, embaixo da tela." : "Abra o menu do navegador (⋮ no canto)."}</li>
                <li className="flex gap-3"><SquarePlus className="size-6 shrink-0 text-primary" />Escolha “Adicionar à Tela de Início” ou “Instalar app”.</li>
                <li className="flex gap-3"><img src={diamante.url} alt="" className="w-6 shrink-0" />Toque no diamante LARDAN na tela inicial para abrir.</li>
              </ol>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}

/** Abertura com o diamante quando a consultora abre pelo ícone instalado. */
export function AberturaApp() {
  const [ver, setVer] = React.useState(false);
  const [saindo, setSaindo] = React.useState(false);
  React.useEffect(() => {
    if (!instalado() || sessionStorage.getItem("lardan-abertura")) return;
    sessionStorage.setItem("lardan-abertura", "1");
    setVer(true);
    const a = setTimeout(() => setSaindo(true), 1500);
    const b = setTimeout(() => setVer(false), 2100);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  if (!ver) return null;
  return (
    <div aria-hidden className={`abertura-app fixed inset-0 z-[100] grid place-items-center ${saindo ? "abertura-sai" : ""}`}>
      <div className="relative grid place-items-center">
        <span className="abertura-halo absolute size-64 rounded-full" />
        <img src={diamante.url} alt="" className="abertura-diamante relative w-36" />
        <span className="abertura-nome mt-8 text-sm tracking-[0.5em]">LARDAN</span>
      </div>
    </div>
  );
}
