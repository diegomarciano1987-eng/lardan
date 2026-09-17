import { Link } from "@tanstack/react-router";
import diamanteAsset from "@/assets/lardan-diamante.png.asset.json";

/**
 * Rodapé institucional.
 *
 * Só entram aqui rotas que existem de fato no projeto e informações
 * confirmadas. TODO — pendente de dados reais do cliente:
 *   redes sociais oficiais, WhatsApp, e-mail, horário de atendimento,
 *   razão social, CNPJ e cidade/UF. Nada disso pode ser inventado.
 */

const COLUNAS: { titulo: string; links: { label: string; to: string }[] }[] = [
  {
    titulo: "Descubra",
    links: [
      { label: "Todas as semijoias", to: "/semijoias" },
      { label: "Coleções", to: "/colecoes" },
      { label: "Brincos", to: "/semijoias/brincos" },
      { label: "Colares", to: "/semijoias/colares" },
      { label: "Pulseiras", to: "/semijoias/pulseiras" },
      { label: "Anéis", to: "/semijoias/aneis" },
    ],
  },
  {
    titulo: "Lardan",
    links: [
      { label: "Sobre a Lardan", to: "/a-lardan" },
      { label: "Qualidade e garantia", to: "/a-lardan" },
      { label: "Seja Consultora Lardan", to: "/seja-lardan" },
      { label: "Contato", to: "/contato" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card">
      {/* Faixa editorial de convite */}
      <div className="border-b border-border">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <h2 className="text-2xl leading-tight text-foreground md:text-4xl">
            Talvez sua história com a Lardan esteja apenas começando.
          </h2>
          <Link to="/seja-lardan" className="btn-premium mt-10">
            Quero ser uma consultora
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <img
              src={diamanteAsset.url}
              alt="Símbolo Lardan — diamante"
              className="h-8 w-auto"
              loading="lazy"
              width={64}
              height={40}
            />
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Semijoias, relacionamento e tecnologia conectando pessoas a novas histórias.
            </p>
          </div>

          {COLUNAS.map((coluna) => (
            <nav key={coluna.titulo} aria-label={coluna.titulo}>
              <h2 className="brand-eyebrow mb-4">{coluna.titulo}</h2>
              <ul className="space-y-2.5">
                {coluna.links.map((link) => (
                  <li key={`${coluna.titulo}-${link.label}`}>
                    <Link
                      to={link.to}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <p className="mt-12 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          Canais oficiais de atendimento, redes sociais e dados empresariais (razão social, CNPJ e
          cidade) serão publicados aqui assim que confirmados pela marca.
        </p>

        <div className="mt-10 flex flex-col items-start justify-between gap-4 border-t border-border pt-6 text-xs text-muted-foreground md:flex-row md:items-center">
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
