import { Link } from "@tanstack/react-router";
import diamanteAsset from "@/assets/lardan-diamante.png.asset.json";
import smalldataAsset from "@/assets/smalldata-logo.png.asset.json";
import { SocialLinks } from "./SocialLinks";
import { EMPRESA, ENDERECO_LINHAS, MAPA_URL } from "@/lib/institucional";

/**
 * Rodapé institucional.
 *
 * Só entram aqui rotas que existem de fato no projeto e informações
 * confirmadas. A rede oficial (Instagram) vem de SOCIALS em src/lib/brand.ts.
 * TODO — pendente de dados reais do cliente: WhatsApp, e-mail e horário de
 * atendimento. Nada disso pode ser inventado.
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
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
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
            <SocialLinks suave className="mt-6" />
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

        <div className="mt-12 border-t border-border pt-10">
          <h2 className="brand-eyebrow mb-4">Endereço</h2>
          <address className="text-sm not-italic leading-relaxed text-muted-foreground">
            <span className="block text-foreground">Lardan</span>
            {ENDERECO_LINHAS.map((linha) => (
              <span key={linha} className="block">
                {linha}
              </span>
            ))}
          </address>
          <a
            href={MAPA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-block text-xs tracking-[0.18em] uppercase text-muted-foreground underline-offset-8 transition-colors hover:text-foreground hover:underline"
          >
            Ver localização
          </a>
        </div>

        <p className="mt-10 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          {EMPRESA.razaoSocial} · CNPJ {EMPRESA.cnpj}
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

        <div className="mt-8 flex items-center justify-center gap-2 border-t border-border/60 pt-5 text-[11px] tracking-[0.08em] text-muted-foreground/70">
          <span>desenvolvimento:</span>
          <a
            href="https://smalldata.cloud/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center opacity-70 transition-opacity hover:opacity-100"
            aria-label="Small Data — smalldata.cloud"
          >
            <img
              src={smalldataAsset.url}
              alt="Small Data"
              className="h-3.5 w-auto"
              loading="lazy"
              width={369}
              height={64}
            />
          </a>
        </div>
      </div>
    </footer>
  );
}
