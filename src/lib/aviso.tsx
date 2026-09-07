import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { ShoppingBag } from "lucide-react";

/**
 * Aviso da sacola: cartão grande, com a foto real da peça e caminho direto
 * para a sacola. Segue o mesmo idioma visual do site.
 */
export function avisarSacola({
  nome,
  variante,
  mediaId,
}: {
  nome: string;
  variante?: string | null;
  mediaId?: string | null;
}) {
  toast.custom(
    (id) => (
      <div className="flex w-full items-center gap-4">
          <div className="size-[4.25rem] shrink-0 overflow-hidden rounded-[12px] border border-[color-mix(in_oklab,var(--color-champagne)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-champagne)_12%,transparent)]">
            {mediaId ? (
              <img
                src={`/api/public/midia/${mediaId}`}
                alt={nome}
                loading="lazy"
                className="size-full object-cover"
              />
            ) : (
              <div className="grid size-full place-items-center text-[color-mix(in_oklab,var(--color-champagne-soft)_80%,transparent)]">
                <ShoppingBag className="size-5" strokeWidth={1.2} aria-hidden />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="font-sans text-[0.6rem] tracking-[0.28em] uppercase text-[color-mix(in_oklab,var(--color-champagne-soft)_85%,transparent)]">
              Adicionado à sacola
            </p>
            <p className="lardan-toast__title mt-1 truncate">{nome}</p>
            {variante ? (
              <p className="mt-0.5 font-sans text-[0.68rem] tracking-[0.18em] uppercase text-[color-mix(in_oklab,var(--color-warm-ivory)_55%,transparent)]">
                {variante}
              </p>
            ) : null}
          </div>

          <Link
            to="/carrinho"
            onClick={() => toast.dismiss(id)}
            className="lardan-toast__action shrink-0 font-sans no-underline"
          >
            Ver sacola
          </Link>
      </div>
    ),
    {
      duration: 5200,
      className: "lardan-toast--sacola",
      style: { width: "min(30rem, calc(100vw - 2rem))" },
    },
  );
}
