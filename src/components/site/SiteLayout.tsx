import { useEffect, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { VoltarLink } from "./VoltarLink";
import { useAppleWebKit } from "@/hooks/use-scroll-progress";
import { registrarPrimeiroContato, registrarVisitaEditorial } from "@/lib/crm/tracking";
import { CAMINHOS_EDITORIAIS } from "@/lib/editorial/rotas";
import { EcossistemaLardanProvider } from "./EcossistemaLardan";

/** Rotas públicas sem intenção comercial: não registram origem. */
const SEM_TRACKING = ["/acesso", "/equipe", "/minha-conta"];

export function SiteLayout({ children, brandedHeader = false }: { children: ReactNode; brandedHeader?: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const comVoltar = pathname !== "/";
  // Marca <html class="is-apple"> em Safari/iOS para os ajustes de desempenho.
  useAppleWebKit();

  // Primeiro contato registrado já na camada pública do site (não só no
  // formulário), preservando o first touch real de quem chega por um guia.
  useEffect(() => {
    if (SEM_TRACKING.some((p) => pathname.startsWith(p))) return;
    registrarPrimeiroContato();
    if ((CAMINHOS_EDITORIAIS as readonly string[]).includes(pathname)) {
      registrarVisitaEditorial(pathname);
    }
  }, [pathname]);

  return (
    <EcossistemaLardanProvider>
      <div className="site-scope min-h-screen bg-background">
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground"
        >
          Ir para o conteúdo
        </a>
        <SiteHeader branded={brandedHeader} />
        <VoltarLink />
        <main id="conteudo" className={`min-w-0 ${comVoltar ? "pt-4 md:pt-0" : ""}`}>
          {children}
        </main>
        <SiteFooter />
      </div>
    </EcossistemaLardanProvider>
  );
}
