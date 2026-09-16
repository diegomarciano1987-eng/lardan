import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Briefcase, Gem, Handshake, Package, Receipt, Store, Users, Wallet } from "lucide-react";
import { PageHeader, Panel } from "@/components/admin/ui";
import { ImportProductsDialog } from "@/components/admin/ImportProductsDialog";
import {
  ImportWizardCadastros,
  type DestinoImportacao,
} from "@/components/admin/ImportWizardCadastros";
import { useCapabilities, can } from "@/lib/capabilities";

export const Route = createFileRoute("/_authenticated/admin/importacao")({
  component: CentralDeImportacao,
  head: () => ({
    meta: [
      { title: "Importação — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type Card = {
  slug: string;
  titulo: string;
  resumo: string;
  icone: typeof Users;
  capacidade: string;
  destino?: DestinoImportacao;
  produtos?: boolean;
};

const CARDS: Card[] = [
  {
    slug: "clientes",
    titulo: "Pessoas e clientes",
    resumo: "Base geral de pessoas. Identifica por documento, depois contato, depois nome.",
    icone: Users,
    capacidade: "registry.manage",
    destino: {
      tipo: "pessoas",
      papel: "cliente",
      titulo: "Importar pessoas e clientes",
      descricao: "Cada linha vira uma pessoa em rascunho com o papel de cliente. Nada é publicado.",
    },
  },
  {
    slug: "consultoras",
    titulo: "Consultoras",
    resumo: "Cria a pessoa e a ficha de consultora vinculada.",
    icone: Gem,
    capacidade: "registry.manage",
    destino: {
      tipo: "pessoas",
      papel: "consultora",
      titulo: "Importar consultoras",
      descricao: "Cada linha vira uma pessoa com papel de consultora e ficha de consultoria.",
    },
  },
  {
    slug: "representantes",
    titulo: "Representantes",
    resumo: "Rede comercial. O nome do representante não é usado como identificador numérico.",
    icone: Handshake,
    capacidade: "registry.manage",
    destino: {
      tipo: "pessoas",
      papel: "representante",
      titulo: "Importar representantes",
      descricao: "Cada linha vira uma pessoa com papel de representante.",
    },
  },
  {
    slug: "colaboradores",
    titulo: "Colaboradores",
    resumo: "Equipe interna. Importar não cria acesso de login.",
    icone: Briefcase,
    capacidade: "registry.manage",
    destino: {
      tipo: "pessoas",
      papel: "colaborador",
      titulo: "Importar colaboradores",
      descricao: "Cada linha vira uma pessoa com papel de colaborador. Nenhum usuário é criado.",
    },
  },
  {
    slug: "lojas",
    titulo: "Lojas",
    resumo: "Pontos de venda parceiros.",
    icone: Store,
    capacidade: "registry.manage",
    destino: {
      tipo: "pessoas",
      papel: "loja",
      titulo: "Importar lojas",
      descricao: "Cada linha vira um cadastro com papel de loja.",
    },
  },
  {
    slug: "produtos",
    titulo: "Produtos e estoque",
    resumo: "Peças, variantes, banhos, códigos de barras e custos, em lotes retomáveis.",
    icone: Package,
    capacidade: "imports.run",
    produtos: true,
  },
  {
    slug: "pagar",
    titulo: "Contas a pagar",
    resumo: "Títulos a pagar com vencimento e valor. Reenvio do mesmo arquivo não duplica.",
    icone: Wallet,
    capacidade: "finance.payable.manage",
    destino: {
      tipo: "titulos",
      direcao: "payable",
      titulo: "Importar contas a pagar",
      descricao:
        "Cada linha vira um título a pagar em aberto, com parcela única. Nenhuma baixa é feita.",
    },
  },
  {
    slug: "receber",
    titulo: "Contas a receber",
    resumo: "Títulos a receber com vencimento e valor. Nenhum recebimento é baixado.",
    icone: Receipt,
    capacidade: "finance.receivable.manage",
    destino: {
      tipo: "titulos",
      direcao: "receivable",
      titulo: "Importar contas a receber",
      descricao:
        "Cada linha vira um título a receber em aberto, com parcela única. Nenhuma baixa é feita.",
    },
  },
];

function CentralDeImportacao() {
  const capabilities = useCapabilities();
  const [destino, setDestino] = React.useState<DestinoImportacao | null>(null);
  const [produtos, setProdutos] = React.useState(false);

  const disponiveis = CARDS.filter((c) =>
    can(capabilities as never[], c.capacidade as never),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lardan Cloud"
        title="Importação"
        description="Escolha o que vai entrar, confira a simulação e só então grave. Toda importação passa pela mesma conferência."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {disponiveis.map((c) => {
          const Icone = c.icone;
          return (
            <button
              key={c.slug}
              type="button"
              onClick={() => (c.produtos ? setProdutos(true) : setDestino(c.destino ?? null))}
              className="rounded-[14px] border border-line bg-surface p-5 text-left transition hover:border-champagne"
            >
              <Icone className="h-5 w-5 text-bronze" aria-hidden />
              <h2 className="mt-3 text-base font-semibold text-ledger-text">{c.titulo}</h2>
              <p className="mt-1 text-sm text-ledger-muted">{c.resumo}</p>
            </button>
          );
        })}
      </div>

      {disponiveis.length === 0 ? (
        <Panel title="Sem permissão">
          <p className="text-sm text-ledger-muted">
            Seu perfil não tem autorização para importar dados.
          </p>
        </Panel>
      ) : null}

      <Panel title="Como funciona">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ledger-muted">
          <li>O arquivo é lido como texto: zeros à esquerda e códigos curtos são preservados.</li>
          <li>A simulação usa exatamente as mesmas regras da gravação — só não grava.</li>
          <li>Linhas repetidas são reconhecidas e não viram registros duplicados.</li>
          <li>Conflitos e decisões de negócio ficam listados, sem adivinhação.</li>
        </ul>
      </Panel>

      <ImportWizardCadastros destino={destino} onOpenChange={(a) => !a && setDestino(null)} />
      <ImportProductsDialog open={produtos} onOpenChange={setProdutos} />
    </div>
  );
}
