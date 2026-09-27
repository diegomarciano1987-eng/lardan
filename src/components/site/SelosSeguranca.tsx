import { ShieldCheck, Lock, BadgeCheck, FileCheck, Server } from "lucide-react";

/**
 * Selos de segurança exibidos no rodapé do site, junto à marca da SmallData.
 *
 * Só entram aqui afirmações verdadeiras sobre a infraestrutura:
 * - tráfego criptografado de ponta a ponta (HTTPS/TLS);
 * - dados criptografados em repouso na infraestrutura;
 * - plataforma com certificações SOC 2 Tipo II e ISO 27001;
 * - conformidade com a LGPD.
 */

const SELOS = [
  {
    icone: Lock,
    titulo: "Dados 100% criptografados",
    descricao: "Conexão segura SSL/TLS",
  },
  {
    icone: ShieldCheck,
    titulo: "Compra segura",
    descricao: "Pagamentos protegidos",
  },
  {
    icone: Server,
    titulo: "Infraestrutura certificada",
    descricao: "SOC 2 Tipo II · ISO 27001",
  },
  {
    icone: FileCheck,
    titulo: "Privacidade LGPD",
    descricao: "Seus dados, suas regras",
  },
  {
    icone: BadgeCheck,
    titulo: "Ambiente verificado",
    descricao: "Monitoramento contínuo",
  },
];

export function SelosSeguranca() {
  return (
    <section
      aria-labelledby="selos-seguranca-titulo"
      className="mt-12 border-y border-trust-border bg-trust-background text-trust-foreground"
    >
      <div className="mx-auto max-w-6xl px-6 py-10 md:py-12">
        <div className="mb-9 flex items-center justify-center gap-5 md:mb-11">
          <span className="h-px w-10 bg-trust-accent/50 md:w-16" aria-hidden />
          <h2
            id="selos-seguranca-titulo"
            className="font-trust-title text-center text-xs font-medium uppercase tracking-[0.3em] text-trust-accent md:text-sm"
          >
            Segurança em primeiro lugar
          </h2>
          <span className="h-px w-10 bg-trust-accent/50 md:w-16" aria-hidden />
        </div>

        <ul className="grid grid-cols-1 border border-trust-border sm:grid-cols-2 lg:grid-cols-5">
          {SELOS.map((selo, index) => (
            <li
              key={selo.titulo}
              className="group relative min-h-40 border-b border-trust-border p-6 transition-colors duration-500 last:border-b-0 hover:bg-trust-surface sm:[&:nth-child(odd)]:border-r sm:[&:nth-child(4)]:border-b-0 lg:min-h-48 lg:border-b-0 lg:border-r lg:last:border-r-0"
            >
              <div className="flex h-12 w-12 items-center justify-center border border-trust-border bg-trust-surface transition-all duration-500 group-hover:border-trust-accent group-hover:bg-trust-accent/10">
                <selo.icone
                  className="size-6 text-trust-accent transition-transform duration-500 group-hover:scale-110"
                  strokeWidth={1.5}
                  aria-hidden
                />
              </div>
              <p className="mt-6 font-trust-title text-[0.95rem] font-semibold leading-snug text-trust-foreground">
                {selo.titulo}
              </p>
              <p className="mt-2 font-trust-body text-xs leading-relaxed text-trust-muted">
                {selo.descricao}
              </p>
              <span className="absolute right-4 top-4 font-trust-body text-[0.625rem] tracking-[0.14em] text-trust-muted/50">
                0{index + 1}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
