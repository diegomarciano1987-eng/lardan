import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { VoltarLink } from "./VoltarLink";

export function SiteLayout({ children, brandedHeader = false }: { children: ReactNode; brandedHeader?: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const comVoltar = pathname !== "/";

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Ir para o conteúdo
      </a>
      <SiteHeader branded={brandedHeader} />
      <VoltarLink />
      <main id="conteudo" className={`min-w-0 ${comVoltar ? "pt-10 md:pt-0" : ""}`}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
