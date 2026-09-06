import type { AppRole } from "@/lib/session";
import type { Capability } from "@/lib/capabilities";
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
  /** Permissão única exigida (espelha role_capabilities no banco). */
  capability?: Capability;
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
    description: "Central da Vitrine: curadoria, publicação e ações em massa sobre o catálogo do site.",
    icon: Globe2,
    roles: CONTENT,
    capability: "site.manage",
    state: "ativo",
  },
  {
    slug: "cadastros",
    path: "/admin/cadastros",
    label: "Cadastro",
    description: "Porta única de pessoas, empresas, produtos e estruturas da operação.",
    icon: ContactRound,
    roles: [...CONTENT, "estoque", "financeiro", "suporte"],
    capability: "registry.view",
    state: "ativo",
    spec: "Central de Cadastros: identidade canônica de pessoas e organizações, papéis acumuláveis, busca inteligente no servidor, detecção de duplicidades e conversão de candidata em consultora. Nunca duplica registros dos módulos especializados.",
  },
  {
    slug: "produtos",
    path: "/admin/cadastros/produtos",
    label: "Produtos",
    description: "Produtos, variantes, categorias, coleções e galeria de imagens.",
    icon: Tag,
    roles: [...CONTENT, "estoque"],
    capability: "catalog.view",
    state: "ativo",
    spec: "Ficha completa do produto, variantes com SKU único, preço público autorizado item a item, galeria com texto alternativo e fluxo rascunho/publicar. Nada é excluído: tudo vira arquivo.",
  },
  {
    slug: "estoque",
    path: "/admin/estoque",
    label: "Estoque",
    description: "Saldos, razão de movimentações, reservas e inventário.",
    icon: Boxes,
    roles: STOCK,
    capability: "stock.view",
    state: "ativo",
    spec: "Razão imutável de movimentações, saldo calculado em transação, recebimento com custo, kardex por item, transferência entre locais, reserva com prazo e inventário com divergência. Nenhum saldo é editado diretamente.",
  },
  {
    slug: "maletas",
    label: "Maletas",
    description: "Montagem, expedição, retorno e composição das maletas.",
    icon: BriefcaseBusiness,
    roles: STOCK,
    capability: "stock.operate",
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
    capability: "finance.view",
    state: "em_construcao",
    spec: "Contas a pagar e a receber com parcelas, baixas parciais, estorno com motivo, conciliação manual e painéis de aging. Valores sempre em centavos; cancelamento é evento registrado.",
  },
  {
    slug: "consultoras",
    label: "Consultoras",
    description: "Cadastro, carteira, maletas e situação das consultoras.",
    icon: UserRound,
    roles: ["master", "diretoria", "suporte"],
    capability: "partners.view",
    state: "em_breve",
  },
  {
    slug: "representantes",
    label: "Representantes",
    description: "Regiões, carteira de consultoras e situação.",
    icon: UsersRound,
    roles: ["master", "diretoria"],
    capability: "partners.view",
    state: "em_breve",
  },
  {
    slug: "clientes",
    label: "Clientes",
    description: "Base de clientes com dados mínimos autorizados.",
    icon: ContactRound,
    roles: ["master", "diretoria", "suporte"],
    capability: "partners.view",
    state: "em_breve",
  },
  {
    slug: "vendas",
    label: "Vendas",
    description: "Pedidos, devoluções e acerto de maleta.",
    icon: ShoppingBag,
    roles: ["master", "diretoria", "financeiro"],
    capability: "finance.view",
    state: "em_breve",
  },
  {
    slug: "importacao",
    path: "/admin/importacao",
    label: "Importações",
    description: "Planilhas CSV/XLSX de catálogo, com validação e homologação.",
    icon: CloudUpload,
    roles: STOCK,
    capability: "imports.run",
    state: "em_construcao",
    spec: "Assistente em etapas: envio, mapa de colunas, validação linha a linha, simulação e execução em lotes transacionais com retomada. Nada entra no catálogo sem homologação com arquivo de prova.",
  },
  {
    slug: "cobranca",
    label: "Cobrança",
    description: "Régua de cobrança e acompanhamento de inadimplência.",
    icon: BellRing,
    roles: ["master", "diretoria", "cobranca", "financeiro"],
    capability: "finance.view",
    state: "em_breve",
  },
  {
    slug: "qualidade",
    label: "Qualidade",
    description: "Garantia, reparo e conferência de peças.",
    icon: ShieldCheck,
    roles: ["master", "diretoria", "qualidade"],
    capability: "stock.view",
    state: "em_breve",
  },
  {
    slug: "academy",
    label: "Academy",
    description: "Treinamento e materiais para a rede.",
    icon: GraduationCap,
    roles: ["master", "diretoria", "marketing"],
    capability: "site.manage",
    state: "em_breve",
  },
  {
    slug: "bi",
    label: "BI e Relatórios",
    description: "Relatórios consolidados e exportações autorizadas.",
    icon: ChartNoAxesCombined,
    roles: ["master", "diretoria", "financeiro"],
    capability: "finance.view",
    state: "em_breve",
  },
  {
    slug: "auditoria",
    path: "/admin/auditoria",
    label: "Auditoria",
    description: "Registro imutável de tudo que foi alterado, por quem e quando.",
    icon: FileClock,
    roles: ["master", "diretoria"],
    capability: "audit.view",
    state: "ativo",
  },
  {
    slug: "configuracoes",
    path: "/admin/configuracoes",
    label: "Configurações",
    description: "Usuários e papéis, integrações e parâmetros do sistema.",
    icon: SlidersHorizontal,
    roles: ["master", "diretoria"],
    capability: "audit.view",
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
    capability: "leads.view",
    state: "ativo",
  },
  {
    slug: "usuarios",
    path: "/admin/usuarios",
    label: "Usuários e papéis",
    description: "Contas da equipe, papéis de acesso e ativação.",
    icon: UsersRound,
    roles: ["master"],
    capability: "users.manage",
    state: "ativo",
  },
  {
    slug: "integracoes",
    path: "/admin/integracoes",
    label: "Integrações",
    description: "Asaas e demais conectores, preparados e desligados.",
    icon: SlidersHorizontal,
    roles: ["master", "diretoria"],
    capability: "audit.view",
    state: "em_construcao",
    spec: "Integração Asaas preparada com sinalizador desligado: contratos internos, fila de saída e caixa de entrada de webhooks com verificação de assinatura. Nenhuma cobrança é emitida nesta etapa.",
  },
];

export const ALL_MODULES = [...ADMIN_MODULES, ...ADMIN_SUBMODULES];

/** Módulo visível: a permissão do banco decide; papéis são só o desenho antigo. */
export function moduleAllowed(
  m: AdminModule,
  caps: string[],
  roles: AppRole[],
): boolean {
  if (m.slug === "visao-geral") return true;
  if (m.capability) return caps.includes(m.capability);
  return m.roles.some((r) => roles.includes(r));
}

export function findModule(slug: string) {
  return ALL_MODULES.find((m) => m.slug === slug);
}

export const STATE_LABEL: Record<ModuleState, string> = {
  ativo: "Ativo",
  em_construcao: "Em construção",
  em_breve: "Em breve",
};
