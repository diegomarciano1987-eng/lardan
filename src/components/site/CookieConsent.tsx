import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { needsAnswer, onConsentChange, readChoice, saveChoices, type Choice } from "@/lib/consent";

export const COOKIE_SETTINGS_EVENT = "lardan-cookie-settings";
export const CONSENT_NOTICE_VERSION = "2026-11-28.v1";

export function CookieSettingsButton() {
  return <Button variant="link" size="sm" className="h-auto p-0 text-xs text-muted-foreground" onClick={() => window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT))}>Configurações de cookies</Button>;
}

export function CookieConsent() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [advertising, setAdvertising] = useState(false);
  const [gpc, setGpc] = useState(false);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    const sync = () => {
      setAnalytics(readChoice("analytics") === "granted");
      setAdvertising(readChoice("advertising") === "granted");
      setGpc((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true);
    };
    sync();
    void needsAnswer(["analytics", "advertising"]).then(answer => { if (active) setOpen(answer); });
    const show = () => { sync(); setSettings(true); setOpen(true); };
    window.addEventListener(COOKIE_SETTINGS_EVENT, show);
    const unsubscribe = onConsentChange(() => {
      sync();
      if (readChoice("analytics") !== null && readChoice("advertising") !== null) setOpen(false);
    });
    return () => { active = false; unsubscribe(); window.removeEventListener(COOKIE_SETTINGS_EVENT, show); };
  }, []);

  useEffect(() => { if (open) panel.current?.focus({ preventScroll: true }); }, [open]);

  function save(a: Choice, ad: Choice) {
    // Separate from permission storage: preserve the notice and each decision
    // as evidence, including previous grants when the visitor withdraws.
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem("lardan_consent_evidence") ?? "[]");
      const history = Array.isArray(parsed) ? parsed : [];
      history.push({ at: new Date().toISOString(), notice: CONSENT_NOTICE_VERSION, analytics: a, advertising: ad, recipients: ["Lovable", "Google"], purposes: ["audience", "advertising_measurement", "advertising_personalization"], gpc });
      localStorage.setItem("lardan_consent_evidence", JSON.stringify(history));
    } catch { /* Permission storage has its own in-memory fallback. */ }
    saveChoices({ analytics: a, advertising: ad });
    setOpen(false);
    setSettings(false);
  }

  if (!open) return null;
  return (
    <section ref={panel} tabIndex={-1} aria-label="Preferências de privacidade" className="fixed bottom-4 left-4 right-4 z-[100] mx-auto max-h-[85dvh] max-w-xl overflow-y-auto rounded-md border border-border bg-card p-6 text-card-foreground shadow-lg focus:outline-none sm:left-auto sm:mx-0">
      <h2 className="text-lg font-semibold">Sua privacidade</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Contamos visitas sem identificar você. Com sua permissão, medimos também cliques. Usamos cookies para analisar a navegação e, separadamente, medir e personalizar anúncios.</p>
      <Link to="/privacidade" className="mt-3 inline-block text-sm underline underline-offset-4">Aviso de privacidade</Link>
      {settings && <div className="mt-5 space-y-4 border-t border-border pt-4">
        <div><h3 className="text-sm font-medium">Necessários · sempre ativos</h3><p className="mt-1 text-xs text-muted-foreground">Mantêm o site e suas funções essenciais disponíveis.</p></div>
        {gpc && <p className="text-sm text-muted-foreground">O sinal de privacidade do seu navegador se aplica: medição opcional e publicidade estão desativadas.</p>}
        <div className="flex items-center justify-between gap-4"><label htmlFor="consent-analytics" className="text-sm">Análise de visitas, fornecida por Lovable e Google</label><Switch id="consent-analytics" checked={analytics} disabled={gpc} onCheckedChange={setAnalytics} /></div>
        <div className="flex items-center justify-between gap-4"><label htmlFor="consent-advertising" className="text-sm">Publicidade, fornecida pelo Google</label><Switch id="consent-advertising" checked={advertising} disabled={gpc} onCheckedChange={setAdvertising} /></div>
        <Button className="w-full" onClick={() => save(analytics && !gpc ? "granted" : "denied", advertising && !gpc ? "granted" : "denied")}>Salvar preferências</Button>
      </div>}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={() => save("granted", "granted")} disabled={gpc}>Aceitar tudo</Button>
        <Button variant="outline" onClick={() => save("denied", "denied")}>Recusar tudo</Button>
      </div>
      <Button variant="link" className="mt-2 w-full" onClick={() => setSettings(true)}>Configurações de cookies</Button>
    </section>
  );
}