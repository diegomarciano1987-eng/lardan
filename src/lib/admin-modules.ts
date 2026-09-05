import type { AppRole } from "@/lib/session";
import {
  LayoutDashboard,
  Globe2,
  Tag,
  Boxes,
  BriefcaseBusiness,
  WalletCards,
  UserRound,
  UsersRound,
  ContactRound,
  ShoppingBag,
  CloudUpload,
  BellRing,
  ShieldCheck,
  GraduationCap,
  ChartNoAxesCombined,
  FileClock,
  SlidersHorizontal,
  Store,
  type LucideIcon,
} from "lucide-react";

/**
 * Estado real do módulo.
 * ativo         — rota real, dados reais
 * em_construcao — rota informativa com estado vazio honesto
 * em_breve      — sem rota, item desabilitado
 */
export type ModuleState = "ativo" | "em_construcao" | "em_breve";

export interface AdminModule {
  slug: string;
  /** Ausente quando o módulo ainda não tem rota operacional. */
  path?: string;
  label: string;
  description: string;
  icon: LucideIcon;
  roles: AppRole[];
  state: ModuleState;
  /** Especificação exibida em módulos não ativos. */
  spec?: string;
}

const ALL_STAFF: AppRole[] = [
  "master",
  "diretoria",
  "marketing",
  "suporte",
  "financeiro",
  "cobranca",
  "estoque",
  "montagem",
  "qualidade",
];

const CONTENT: AppRole[] = ["master", "diretoria", "marketing"];
const STOCK: AppRole[] = ["master", "diretoria", "estoque"];
const FINANCE: AppRole[] = ["master", "diretoria", "financeiro"];

export const ADMIN_MODULES: AdminModule[] = [
  {
    slug: "visao-geral",
    path: "/admin",
    label: "Visão Geral",
    description: "Movimentação de estoque, finanças e operações da rede em um só lugar.",
    icon: LayoutDashboard,
    roles: ALL_STAFF,
    state: "ativo",
  },
  {
    slug: "site",
    path: "/admin/site",
    label: "Site",
    description: "Páginas, categorias, coleções, mídias e publicação do site público.",
    icon: Globe2,
    roles: CONTENT,
    state: "em_construcao",
    spec: "Edição das páginas do site com rascunho, versão publicada e histórico imutável; biblioteca de mídias com texto alternativo obrigatório; publicação controlada por papel.",
  },
  {
    slug: "cadastros",
    path: "/admin/cadastros",
    label: "Produtos",
    description: "Produtos, variantes, categorias, coleções e galeria de imagens.",
    icon: Tag,
    roles: [...CONTENT, "estoque"],
    state: "em_construcao",
    spec: "Ficha completa do produto, variantes com SKU único, preço público autorizado item a item, galeria com texto alternativo e fluxo rascunho/publicar. Nada é excluído: tudo vira arquivo.",
  },
  {
    slug: "estoque",
    path: "/admin/estoque",
    label: "Estoque",
    description: "Saldos, razão de movimentações, reservas e inventário.",
    icon: Boxes,
    roles: STOCK,
    state: "em_construcao",
    spec: "Razão imutável de movimentações, saldo calculado em transação, recebimento com custo, kardex por item, transferência entre locais, reserva com prazo e inventário com divergência. Nenhum saldo é editado diretamente.",
  },
  {
    slug: "maletas",
    label: "Maletas",
    description: "Montagem, expedição, retorno e composição das maletas.",
    icon: BriefcaseBusiness,
    roles: STOCK,
    state: "em_breve",
    spec: "Depende do motor de estoque.",
  },
  {
    slug: "financeiro",
    path: "/admin/financeiro",
    label: "Financeiro",
    description: "Contas, títulos, parcelas, baixas e conciliação.",
    icon: WalletCards,
    roles: FINANCE,
    state: "em_construcao",
    spec: "Contas a pagar e a receber com parcelas, baixas parciais, estorno com motivo, conciliação manual e painéis de aging. Valores sempre em centavos; cancelamento é evento registrado.",
  },
  {
    slug: "consultoras",
    label: "Consultoras",
    description: "Cadastro, carteira, maletas e situação das consultoras.",
    icon: UserRound,
    roles: ["master", "diretoria", "suporte"],
    state: "em_breve",
  },
  {
    slug: "representantes",
    label: "Representantes",
    description: "Regiões, carteira de consultoras e situação.",
    icon: UsersRound,
    roles: ["master", "diretoria"],
    state: "em_breve",
  },
  {
    slug: "clientes",
    label: "Clientes",
    description: "Base de clientes com dados mínimos autorizados.",
    icon: ContactRound,
    roles: ["master", "diretoria", "suporte"],
    state: "em_breve",
  },
  {
    slug: "vendas",
    label: "Vendas",
    description: "Pedidos, devoluções e acerto de maleta.",
    icon: ShoppingBag,
    roles: ["master", "diretoria", "financeiro"],
    state: "em_breve",
  },
  {
    slug: "importacao",
    path: "/admin/importacao",
    label: "Importações",
    description: "Planilhas CSV/XLSX de catálogo, com validação e homologação.",
    icon: CloudUpload,
    roles: STOCK,
    state: "em_construcao",
    spec: "Assistente em etapas: envio, mapa de colunas, validação linha a linha, simulação e execução em lotes transacionais com retomada. Nada entra no catálogo sem homologação com arquivo de prova.",
  },
  {
    slug: "cobranca",
    label: "Cobrança",
    description: "Régua de cobrança e acompanhamento de inadimplência.",
    icon: BellRing,
    roles: ["master", "diretoria", "cobranca", "financeiro"],
    state: "em_breve",
  },
  {
    slug: "qualidade",
    label: "Qualidade",
    description: "Garantia, reparo e conferência de peças.",
    icon: ShieldCheck,
    roles: ["master", "diretoria", "qualidade"],
    state: "em_breve",
  },
  {
    slug: "academy",
    label: "Academy",
    description: "Treinamento e materiais para a rede.",
    icon: GraduationCap,
    roles: ["master", "diretoria", "marketing"],
    state: "em_breve",
  },
  {
    slug: "bi",
    label: "BI e Relatórios",
    description: "Relatórios consolidados e exportações autorizadas.",
    icon: ChartNoAxesCombined,
    roles: ["master", "diretoria", "financeiro"],
    state: "em_breve",
  },
  {
    slug: "auditoria",
    path: "/admin/auditoria",
    label: "Auditoria",
    description: "Registro imutável de tudo que foi alterado, por quem e quando.",
    icon: FileClock,
    roles: ["master", "diretoria"],
    state: "ativo",
  },
  {
    slug: "configuracoes",
    path: "/admin/configuracoes",
    label: "Configurações",
    description: "Usuários e papéis, integrações e parâmetros do sistema.",
    icon: SlidersHorizontal,
    roles: ["master", "diretoria"],
    state: "ativo",
  },
  {
    slug: "pdv",
    label: "PDV Loja",
    description: "Frente de caixa da loja física.",
    icon: Store,
    roles: ALL_STAFF,
    state: "em_breve",
  },
];

/** Módulos internos alcançáveis fora do menu inferior. */
export const ADMIN_SUBMODULES: AdminModule[] = [
  {
    slug: "candidaturas",
    path: "/admin/leads",
    label: "Candidaturas e contatos",
    description: "Leads do Seja Lardan e mensagens do Contato, com protocolo.",
    icon: ContactRound,
    roles: ["master", "diretoria", "marketing", "suporte"],
    state: "ativo",
  },
  {
    slug: "usuarios",
    path: "/admin/usuarios",
    label: "Usuários e papéis",
    description: "Contas da equipe, papéis de acesso e ativação.",
    icon: UsersRound,
    roles: ["master"],
    state: "ativo",
  },
  {
    slug: "integracoes",
    path: "/admin/integracoes",
    label: "Integrações",
    description: "Asaas e demais conectores, preparados e desligados.",
    icon: SlidersHorizontal,
    roles: ["master", "diretoria"],
    state: "em_construcao",
    spec: "Integração Asaas preparada com sinalizador desligado: contratos internos, fila de saída e caixa de entrada de webhooks com verificação de assinatura. Nenhuma cobrança é emitida nesta etapa.",
  },
];

export const ALL_MODULES = [...ADMIN_MODULES, ...ADMIN_SUBMODULES];

export function findModule(slug: string) {
  return ALL_MODULES.find((m) => m.slug === slug);
}

export const STATE_LABEL: Record<ModuleState, string> = {
  ativo: "Ativo",
  em_construcao: "Em construção",
  em_breve: "Em breve",
};
