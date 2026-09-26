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
    <div className="mt-10 border-t border-border/60 pt-8">
      <p className="brand-eyebrow mb-5 text-center">Segurança em primeiro lugar</p>
      <ul className="flex flex-wrap items-stretch justify-center gap-3">
        {SELOS.map((selo) => (
          <li
            key={selo.titulo}
            className="flex items-center gap-3 rounded-full border border-border bg-background px-4 py-2.5"
          >
            <selo.icone className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="leading-tight">
              <span className="block text-[11px] font-medium tracking-[0.06em] text-foreground">
                {selo.titulo}
              </span>
              <span className="block text-[10px] text-muted-foreground">{selo.descricao}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
