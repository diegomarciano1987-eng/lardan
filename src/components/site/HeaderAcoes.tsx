import { Link } from "@tanstack/react-router";
import { ShoppingBag, UserRound } from "lucide-react";
import { totalItens, useCarrinho } from "@/lib/carrinho";

const base =
  "relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-foreground/10 bg-background/55 text-foreground/70 backdrop-blur-xl transition-all duration-300 hover:border-foreground/25 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

/** Perfil e sacola — presentes em todas as páginas, no celular e no computador. */
export function HeaderAcoes({ className = "" }: { className?: string }) {
  const itens = useCarrinho();
  const qtd = totalItens(itens);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Link to="/acesso" aria-label="Minha conta" className={base}>
        <UserRound className="h-[1.05rem] w-[1.05rem]" strokeWidth={1.4} />
      </Link>
      <Link to="/carrinho" aria-label={`Sacola${qtd ? ` com ${qtd} peça(s)` : " vazia"}`} className={base}>
        <ShoppingBag className="h-[1.05rem] w-[1.05rem]" strokeWidth={1.4} />
        {qtd > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-[1.15rem] min-w-[1.15rem] place-items-center rounded-full bg-[var(--gradient-rose,theme(colors.primary.DEFAULT))] px-1 text-[0.625rem] font-medium text-primary-foreground shadow-[0_6px_16px_-8px_rgba(0,0,0,0.6)]">
            {qtd}
          </span>
        ) : null}
      </Link>
    </div>
  );
}
