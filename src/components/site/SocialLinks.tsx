import { Instagram } from "lucide-react";
import { SOCIALS } from "@/lib/brand";

/**
 * Redes sociais oficiais da marca.
 *
 * Ícone minimalista, no traço fino (strokeWidth 1.4) já usado em todo o site.
 * As redes vêm de SOCIALS (src/lib/brand.ts): só entra canal realmente
 * confirmado pela Lardan.
 */

const ICONES = { instagram: Instagram } as const;

export function SocialLinks({
  className = "",
  tamanho = "md",
  suave = false,
}: {
  className?: string;
  tamanho?: "sm" | "md";
  suave?: boolean;
}) {
  const botao = `inline-flex shrink-0 items-center justify-center rounded-full border transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring ${
    tamanho === "sm" ? "h-9 w-9" : "h-10 w-10"
  } ${
    suave
      ? "border-border text-muted-foreground hover:border-foreground/25 hover:text-foreground"
      : "border-foreground/10 bg-background/55 text-foreground/70 backdrop-blur-xl hover:border-foreground/25 hover:text-foreground"
  }`;

  return (
    <nav aria-label="Redes sociais" className={`flex items-center gap-2 ${className}`}>
      {SOCIALS.map((rede) => {
        const Icone = ICONES[rede.icone];
        return (
          <a
            key={rede.href}
            href={rede.href}
            target="_blank"
            rel="noopener noreferrer me"
            aria-label={rede.rotulo}
            className={botao}
          >
            <Icone className="h-[1.05rem] w-[1.05rem]" strokeWidth={1.4} />
          </a>
        );
      })}
    </nav>
  );
}
