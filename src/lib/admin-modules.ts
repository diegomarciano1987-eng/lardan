import type { AppRole } from "@/lib/session";

export type ModuleState = "ativo" | "em_implantacao" | "desativado";

export interface AdminModule {
  slug: string;
  path: string;
  label: string;
  description: string;
  roles: AppRole[];
  state: ModuleState;
  /** Texto de especificação exibido em módulos não ativos (ADM-16). */
  spec?: string;
}

const ALL_STAFF: AppRole[] = [
  "master", "diretoria", "marketing", "suporte", "financeiro",
  "cobranca", "estoque", "montagem", "qualidade",
];

export const ADMIN_MODULES: AdminModule[] = [
  {
    slug: "visao-geral",
    path: "/admin",
    label: "Visão geral",
    description: "Contagens reais da operação e estado dos módulos.",
    roles: ALL_STAFF,
    state: "ativo",
  },
  {
    slug: "candidaturas",
    path: "/admin/leads",
    label: "Candidaturas e contatos",
    description: "Leads do Seja Lardan e mensagens do Contato, com protocolo.",
    roles: ["master", "diretoria", "marketing", "suporte"],
    state: "ativo",
  },
  {
    slug: "cadastros",
    path: "/admin/cadastros",
    label: "Cadastros",
    description: "Produtos, variantes, categorias, coleções, fornecedores, locais e responsáveis.",
    roles: ["master", "diretoria", "marketing", "estoque"],
    state: "em_implantacao",
    spec: "Cadastro completo de produto com ficha técnica, variantes com SKU único, preço público controlado item a item, galeria com texto alternativo obrigatório e rascunho/publicar com histórico. Nenhuma exclusão física: tudo vira arquivo.",
  },
  {
    slug: "estoque",
    path: "/admin/estoque",
    label: "Estoque",
    description: "Saldos, movimentações, reservas, inventário e maletas.",
    roles: ["master", "diretoria", "estoque"],
    state: "desativado",
    spec: "Motor de estoque com razão imutável de movimentações, saldo calculado em transação, recebimento com custo, kardex por item, transferência entre locais, reserva com prazo, inventário com divergência e maletas de consultora. Nenhum saldo é editado diretamente.",
  },
  {
    slug: "importacao",
    path: "/admin/importacao",
    label: "Importação de catálogo",
    description: "Planilhas CSV/XLSX de até 20 mil itens, com homologação.",
    roles: ["master", "diretoria", "estoque"],
    state: "desativado",
    spec: "Assistente em etapas: envio do arquivo, mapa de colunas, validação linha a linha, simulação e execução em lotes transacionais com retomada. Quatro modos: criar, atualizar, sincronizar e substituir. Nada entra no catálogo sem homologação com arquivo de prova.",
  },
  {
    slug: "financeiro",
    path: "/admin/financeiro",
    label: "Financeiro",
    description: "Contas, títulos, parcelas, baixas e conciliação.",
    roles: ["master", "diretoria", "financeiro"],
    state: "desativado",
    spec: "Contas a pagar e receber com parcelas, baixas parciais, estorno com motivo, conciliação manual e painéis de aging. Valores sempre em centavos. Nenhum título some: cancelamento é evento registrado.",
  },
  {
    slug: "integracoes",
    path: "/admin/integracoes",
    label: "Integrações",
    description: "Asaas e demais conectores, preparados e desligados.",
    roles: ["master", "diretoria"],
    state: "desativado",
    spec: "Integração Asaas preparada com flag desligada: contratos internos, fila de saída e caixa de entrada de webhooks com verificação de assinatura. Nenhuma cobrança é emitida nesta etapa.",
  },
  {
    slug: "usuarios",
    path: "/admin/usuarios",
    label: "Usuários e papéis",
    description: "Contas da equipe, papéis de acesso e ativação.",
    roles: ["master"],
    state: "ativo",
  },
  {
    slug: "auditoria",
    path: "/admin/auditoria",
    label: "Auditoria",
    description: "Registro imutável de tudo que foi alterado, por quem e quando.",
    roles: ["master", "diretoria"],
    state: "ativo",
  },
];

export const STATE_LABEL: Record<ModuleState, string> = {
  ativo: "Ativo",
  em_implantacao: "Em implantação",
  desativado: "Desativado",
};
