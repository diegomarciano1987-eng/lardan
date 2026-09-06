import { Link } from "@tanstack/react-router";
import { NAV_ITEMS } from "@/lib/brand";
import diamanteAsset from "@/assets/lardan-diamante.png.asset.json";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="flex flex-col items-start justify-between gap-10 md:flex-row md:items-center">
          <div>
            <img
              src={diamanteAsset.url}
              alt="Símbolo Lardan — diamante"
              className="h-8 w-auto"
              loading="lazy"
              width={64}
              height={40}
            />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Lardan — semijoias para acompanhar os seus momentos. Informações empresariais oficiais
              em confirmação com a marca.
            </p>
          </div>
          <nav aria-label="Rodapé" className="grid grid-cols-2 gap-x-12 gap-y-2">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-border pt-6 text-xs text-muted-foreground md:flex-row md:items-center">
          <span>© {new Date().getFullYear()} Lardan. Todos os direitos reservados.</span>
          <Link
            to="/acesso"
            className="tracking-[0.18em] uppercase transition-colors hover:text-foreground"
          >
            Acessar Lardan
          </Link>
        </div>
      </div>
    </footer>
  );
}
