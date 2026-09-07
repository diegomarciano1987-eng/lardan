import { useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

/** Seta de voltar presente em todas as páginas, menos a inicial. */
export function VoltarLink() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === "/") return null;

  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) router.history.back();
        else router.navigate({ to: "/" });
      }}
      aria-label="Voltar para a página anterior"
      className="group fixed left-4 top-[5.25rem] z-40 inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-background/70 px-4 py-2 text-[0.625rem] tracking-[0.22em] uppercase text-foreground/70 shadow-[0_18px_44px_-32px_color-mix(in_oklab,var(--foreground)_45%,transparent)] backdrop-blur-xl transition-all duration-300 hover:border-foreground/25 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring md:left-8 md:top-[7rem]"
    >
      <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-0.5" />
      Voltar
    </button>
  );
}
