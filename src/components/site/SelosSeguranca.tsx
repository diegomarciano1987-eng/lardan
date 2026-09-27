import { ShieldCheck, LockKeyhole, BadgeCheck, FileCheck2, ServerCog } from "lucide-react";

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
    icone: LockKeyhole,
    titulo: "Dados 100% criptografados",
    descricao: "Conexão segura SSL/TLS",
  },
  {
    icone: ShieldCheck,
    titulo: "Compra segura",
    descricao: "Pagamentos protegidos",
  },
  {
    icone: ServerCog,
    titulo: "Infraestrutura certificada",
    descricao: "SOC 2 Tipo II · ISO 27001",
  },
  {
    icone: FileCheck2,
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
      <div className="mx-auto max-w-6xl px-6 py-8 md:py-9">
        <div className="mb-7 flex items-center justify-center gap-4">
          <span className="h-px w-8 bg-trust-accent/45 md:w-12" aria-hidden />
          <h2
            id="selos-seguranca-titulo"
            className="font-trust-title text-center text-[0.7rem] font-medium uppercase tracking-[0.26em] text-trust-accent"
          >
            Segurança em primeiro lugar
          </h2>
          <span className="h-px w-8 bg-trust-accent/45 md:w-12" aria-hidden />
        </div>

        <ul className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 md:grid-cols-5 md:gap-4">
          {SELOS.map((selo) => (
            <li
              key={selo.titulo}
              className="group flex min-w-0 flex-col items-center text-center last:col-span-2 sm:last:col-span-1"
            >
              <div className="relative flex size-[4.5rem] items-center justify-center rounded-full border border-trust-accent/65 bg-trust-surface shadow-[inset_0_1px_0_var(--color-trust-foreground),inset_0_-8px_14px_var(--color-trust-background),0_8px_18px_-8px_var(--color-trust-accent)] transition-transform duration-500 group-hover:-translate-y-1 md:size-20">
                <span className="absolute inset-[5px] rounded-full border border-trust-accent/35 shadow-[inset_0_0_0_2px_var(--color-trust-background)]" aria-hidden />
                <span className="absolute inset-[10px] rounded-full bg-trust-background shadow-[inset_0_2px_5px_var(--color-trust-surface)]" aria-hidden />
                <selo.icone className="relative size-7 text-trust-accent md:size-8" strokeWidth={1.35} aria-hidden />
                <BadgeCheck className="absolute -bottom-1 -right-1 size-5 fill-trust-background text-trust-accent" strokeWidth={1.5} aria-hidden />
              </div>
              <p className="mt-4 max-w-40 font-trust-title text-[0.8rem] font-semibold leading-snug text-trust-foreground md:text-[0.85rem]">
                {selo.titulo}
              </p>
              <p className="mt-1 max-w-40 font-trust-body text-[0.65rem] leading-relaxed text-trust-muted md:text-[0.7rem]">
                {selo.descricao}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
