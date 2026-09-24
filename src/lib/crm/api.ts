/**
 * LARDAN — camada única de acesso ao CRM de Candidaturas.
 *
 * Toda leitura e toda escrita passam por rotinas do banco que verificam a
 * permissão do usuário no servidor. A interface só esconde o que o banco já
 * recusa; esconder item de menu nunca é controle de acesso.
 */
import { supabase } from "@/integrations/supabase/client";

/* ------------------------------------------------------------- tipos -- */

export type CandidaturaDesfecho = "aberta" | "ganha" | "perdida";
export type Prioridade = "normal" | "alta" | "urgente";

export interface Etapa {
  id: string;
  chave: string;
  nome: string;
  ordem: number;
  cor: string;
  inicial: boolean;
  ativa: boolean;
}

export interface Etiqueta {
  id: string;
  nome: string;
  cor: string;
  ativa?: boolean;
}

export interface CandidaturaCard {
  id: string;
  protocolo: string;
  nome: string;
  whatsapp: string;
  whatsapp_norm: string;
  email: string | null;
  cidade: string;
  uf: string;
  etapa_id: string;
  etapa_desde: string;
  prioridade: Prioridade;
  desfecho: CandidaturaDesfecho;
  origem: string;
  campanha: string | null;
  criada_em: string;
  ultimo_contato: string | null;
  primeiro_atendimento: string | null;
  proximo_followup: string | null;
  arquivada_em: string | null;
  reenvios: number;
  responsavel_id: string | null;
  responsavel: string | null;
  tags: Etiqueta[];
}

export interface Radar {
  atrasados: number;
  hoje: number;
  proximas: number;
  sem_acao: number;
  novas: number;
  sem_responsavel: number;
  total: number;
}

export interface Board {
  etapas: Etapa[];
  cards: CandidaturaCard[];
  radar: Radar;
}

export interface Followup {
  id: string;
  quando: string;
  tipo: string;
  situacao: "pendente" | "concluido" | "cancelado";
  observacao: string | null;
  resultado: string | null;
  responsavel: string | null;
  responsavel_id: string | null;
  concluido_em: string | null;
  atrasado: boolean;
}

export interface FollowupAgenda extends Omit<Followup, "atrasado" | "resultado" | "concluido_em"> {
  candidatura_id: string;
  candidata: string;
  whatsapp: string;
  cidade: string;
  uf: string;
  etapa: string;
}

export interface EventoTimeline {
  id: string;
  tipo: string;
  titulo: string;
  descricao: string | null;
  metadata: Record<string, unknown>;
  em: string;
  autor: string | null;
}

export interface Nota {
  id: string;
  texto: string;
  em: string;
  editada_em: string;
  edicoes: number;
  autor_id: string;
  autor: string | null;
}

export interface Avaliacao {
  id: string;
  tipo: string;
  situacao: string;
  enviado_em: string | null;
  concluido_em: string | null;
  referencia: string | null;
}

export interface Envio {
  id: string;
  em: string;
  reenvio: boolean;
  respostas: Record<string, unknown>;
  ip: string | null;
}

export interface Detalhe {
  candidatura: CandidaturaCard & {
    nome_proprio: string | null;
    sobrenome: string | null;
    /** Mascarado quando a pessoa não tem permissão de ver dados pessoais. */
    cpf: string | null;
    cpf_visivel: boolean;
    rua: string | null;
    numero: string | null;
    sem_numero: boolean;
    cep: string | null;
    objetivo: string | null;
    sonho: string | null;
    sonho_valor_cents: number | null;
    disponibilidade: string | null;
    experiencia: string | null;
    canais: string | null;
    motivacao: string | null;
    consentimento_marketing: boolean;
    versao_privacidade: string;
    motivo_perda: string | null;
    motivo_perda_id: string | null;
    perda_observacao: string | null;
    perdida_em: string | null;
    ganha_em: string | null;
    ganho_observacao: string | null;
    party_id: string | null;
  };
  origem: {
    normalizada: string;
    utm: Record<string, string>;
    landing_page: string | null;
    referrer: string | null;
    first_referrer: string | null;
    gclid: string | null;
    fbclid: string | null;
    msclkid: string | null;
    first_touch: Record<string, unknown>;
    last_touch: Record<string, unknown>;
    origem_bruta: string | null;
  };
  tecnico: {
    ip: string | null;
    user_agent: string | null;
    navegador: string | null;
    sistema: string | null;
    dispositivo: string | null;
    idioma: string | null;
  } | null;
  timeline: EventoTimeline[];
  notas: Nota[];
  followups: Followup[];
  avaliacoes: Avaliacao[];
  envios: Envio[];
  historico_etapas: { de: string | null; para: string; em: string; autor: string | null }[];
}

export interface Opcoes {
  etapas: Etapa[];
  etiquetas: Etiqueta[];
  motivos_perda: { id: string; rotulo: string; exige_observacao: boolean }[];
  usuarios: { id: string; nome: string }[];
  origens: string[];
  campanhas: string[];
  permissoes: string[];
}

export interface Metricas {
  periodo: { de: string; ate: string };
  total: number;
  novas: number;
  em_atendimento: number;
  ganhas: number;
  perdidas: number;
  taxa_conversao: number;
  minutos_primeiro_atendimento: number;
  dias_no_funil: number;
  por_origem: Record<string, number>;
  motivos_perda: Record<string, number>;
}

export interface Filtros {
  q?: string | undefined;
  etapa?: string | undefined;
  desfecho?: string | undefined;
  prioridade?: string | undefined;
  responsavel?: string | undefined;
  origem?: string | undefined;
  campanha?: string | undefined;
  cidade?: string | undefined;
  uf?: string | undefined;
  tag?: string | undefined;
  de?: string | undefined;
  ate?: string | undefined;
  followup?: string | undefined;
  arquivadas?: boolean | undefined;
}

/* -------------------------------------------------------- chamadas -- */

async function rpc<T>(nome: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(nome as never, args as never);
  if (error) throw new Error(traduzirErro(error.message));
  return data as T;
}

/** Erros do banco chegam como código curto; aqui viram frase para a equipe. */
export function traduzirErro(mensagem: string): string {
  const mapa: Record<string, string> = {
    sem_permissao: "Você não tem permissão para esta ação.",
    candidatura_inexistente: "Candidatura não encontrada.",
    etapa_invalida: "Etapa inválida ou desativada.",
    etapa_em_uso: "Existem candidaturas nesta etapa. Mova-as antes de desativá-la.",
    motivo_invalido: "Escolha um motivo de perda válido.",
    observacao_obrigatoria: "Este motivo exige uma observação.",
    nota_vazia: "Escreva a nota antes de salvar.",
    nota_inexistente: "Nota não encontrada.",
    nota_de_outro_usuario: "Só o autor pode editar esta nota.",
    followup_nao_pendente: "Este follow-up já foi concluído ou cancelado.",
    data_obrigatoria: "Informe a data e a hora do retorno.",
    etiqueta_inexistente: "Etiqueta não encontrada.",
    usuario_invalido: "Usuário inválido ou inativo.",
    prioridade_invalida: "Prioridade inválida.",
    nome_invalido: "Informe um nome válido.",
    sobrenome_invalido: "Informe o sobrenome.",
    cpf_invalido: "Informe um CPF válido.",
    limite_envios: "Muitos envios seguidos. Tente novamente em alguns minutos.",
  };
  for (const [chave, frase] of Object.entries(mapa)) {
    if (mensagem.includes(chave)) return frase;
  }
  return mensagem;
}

const limpar = (f: Filtros) =>
  Object.fromEntries(
    Object.entries(f).filter(([, v]) => v !== undefined && v !== "" && v !== false),
  );

export const carregarBoard = (f: Filtros = {}) => rpc<Board>("crm_board", { _f: limpar(f) });
export const carregarRadar = () => rpc<Radar>("crm_radar");
export const carregarOpcoes = () => rpc<Opcoes>("crm_options");
export const carregarLista = (f: Filtros = {}, limite = 50, offset = 0) =>
  rpc<{ total: number; itens: CandidaturaCard[] }>("crm_list", {
    _f: limpar(f),
    _limit: limite,
    _offset: offset,
  });
export const carregarDetalhe = (id: string) => rpc<Detalhe>("crm_detail", { _lead: id });
export const carregarAgenda = (escopo: string, somenteMeus = false) =>
  rpc<FollowupAgenda[]>("crm_followups_list", { _escopo: escopo, _somente_meus: somenteMeus });
export const carregarMetricas = (de?: string, ate?: string) =>
  rpc<Metricas>("crm_metrics", { _de: de ?? null, _ate: ate ?? null });

export const moverEtapa = (lead: string, etapa: string, nota?: string) =>
  rpc("crm_move_stage", { _lead: lead, _stage: etapa, _note: nota ?? null });
export const atribuir = (lead: string, usuario: string | null) =>
  rpc("crm_assign", { _lead: lead, _user: usuario });
export const definirPrioridade = (lead: string, prioridade: Prioridade) =>
  rpc("crm_set_priority", { _lead: lead, _priority: prioridade });
export const adicionarNota = (lead: string, texto: string) =>
  rpc<string>("crm_note_add", { _lead: lead, _body: texto });
export const editarNota = (nota: string, texto: string) =>
  rpc("crm_note_edit", { _note: nota, _body: texto });
export const criarFollowup = (p: {
  lead: string;
  quando: string;
  tipo: string;
  responsavel?: string | null;
  observacao?: string | null;
}) =>
  rpc<string>("crm_followup_create", {
    _lead: p.lead,
    _due_at: p.quando,
    _kind: p.tipo,
    _assigned_to: p.responsavel ?? null,
    _note: p.observacao ?? null,
  });
export const concluirFollowup = (id: string, resultado?: string) =>
  rpc("crm_followup_complete", { _id: id, _outcome: resultado ?? null });
export const cancelarFollowup = (id: string, motivo?: string) =>
  rpc("crm_followup_cancel", { _id: id, _motivo: motivo ?? null });
export const aplicarEtiqueta = (lead: string, tag: string, aplicar: boolean) =>
  rpc("crm_tag_set", { _lead: lead, _tag: tag, _aplicar: aplicar });
export const registrarCliqueWhatsapp = (lead: string) =>
  rpc("crm_whatsapp_click", { _lead: lead });
export const marcarGanho = (lead: string, nota?: string) =>
  rpc("crm_mark_won", { _lead: lead, _nota: nota ?? null });
export const marcarPerdido = (lead: string, motivo: string, nota?: string) =>
  rpc("crm_mark_lost", { _lead: lead, _reason: motivo, _nota: nota ?? null });
export const reabrir = (lead: string, nota?: string) =>
  rpc("crm_reopen", { _lead: lead, _nota: nota ?? null });
export const arquivar = (lead: string, nota?: string) =>
  rpc("crm_archive", { _lead: lead, _nota: nota ?? null });
export const salvarEtapa = (p: Record<string, unknown>) => rpc<string>("crm_stage_save", { _payload: p });
export const reordenarEtapas = (ordem: { id: string; ordem: number }[]) =>
  rpc("crm_stage_reorder", { _ordem: ordem });
export const salvarEtiqueta = (p: Record<string, unknown>) => rpc<string>("crm_tag_save", { _payload: p });

/* --------------------------------------------------- apresentação -- */

export const ORIGEM_ROTULO: Record<string, string> = {
  google: "Google",
  google_ads: "Google Ads",
  google_organico: "Google orgânico",
  meta: "Meta",
  meta_ads: "Meta Ads",
  instagram: "Instagram",
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  copilot: "Copilot",
  claude: "Claude",
  grok: "Grok",
  bing: "Bing",
  bing_ads: "Bing Ads",
  bing_organico: "Bing orgânico",
  duckduckgo: "DuckDuckGo",
  yahoo: "Yahoo",
  ecosia: "Ecosia",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  telegram: "Telegram",
  email: "E-mail",
  whatsapp: "WhatsApp",
  indicacao: "Indicação",
  direto: "Direto",
  outro: "Outro",
  nao_identificado: "Não identificado",
};

export const rotuloOrigem = (v: string | null | undefined) =>
  v ? (ORIGEM_ROTULO[v] ?? v) : "Não identificado";

export const FOLLOWUP_TIPOS: { valor: string; rotulo: string }[] = [
  { valor: "ligacao", rotulo: "Ligação" },
  { valor: "whatsapp", rotulo: "WhatsApp" },
  { valor: "retorno", rotulo: "Retorno" },
  { valor: "documentacao", rotulo: "Documentação" },
  { valor: "entrevista", rotulo: "Entrevista" },
  { valor: "analise", rotulo: "Análise" },
  { valor: "outro", rotulo: "Outro" },
];

export const rotuloTipoFollowup = (v: string) =>
  FOLLOWUP_TIPOS.find((t) => t.valor === v)?.rotulo ?? v;

/**
 * Link de conversa no WhatsApp. É apenas um link: o sistema não tem integração
 * com o WhatsApp e não sabe se a mensagem foi enviada.
 */
export function linkWhatsapp(numero: string, mensagem?: string) {
  const digitos = (numero ?? "").replace(/\D/g, "");
  const completo = digitos.startsWith("55") ? digitos : `55${digitos}`;
  const base = `https://wa.me/${completo}`;
  return mensagem ? `${base}?text=${encodeURIComponent(mensagem)}` : base;
}

export function mensagemPadrao(nome: string, atendente: string | null) {
  const primeiro = nome.split(" ")[0] ?? nome;
  const quem = atendente ? `${atendente.split(" ")[0]} da Lardan` : "a equipe Lardan";
  return `Olá, ${primeiro}. Aqui é ${quem}. Recebemos a sua candidatura para ser Consultora Lardan e gostaria de conversar com você.`;
}

/* ------------------------------------------------------------ tempo -- */

const fmtHora = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});
const fmtData = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});
const fmtCompleto = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

export const dataHora = (iso: string | null | undefined) =>
  iso ? fmtCompleto.format(new Date(iso)) : "—";

/** "há 2 dias", "há 3h", "agora" — sempre relativo ao momento atual. */
export function desde(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "há 1 dia";
  if (d < 30) return `há ${d} dias`;
  const m = Math.floor(d / 30);
  return m === 1 ? "há 1 mês" : `há ${m} meses`;
}

export type TomPrazo = "atrasado" | "hoje" | "futuro" | "nenhum";

export function prazo(iso: string | null | undefined): { tom: TomPrazo; texto: string } {
  if (!iso) return { tom: "nenhum", texto: "Sem próxima ação" };
  const alvo = new Date(iso);
  const agora = new Date();
  const hoje = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" });
  if (alvo.getTime() < agora.getTime()) {
    const dias = Math.floor((agora.getTime() - alvo.getTime()) / 86400000);
    return {
      tom: "atrasado",
      texto:
        dias >= 1
          ? `Follow-up atrasado há ${dias} ${dias === 1 ? "dia" : "dias"}`
          : "Follow-up atrasado",
    };
  }
  if (hoje.format(alvo) === hoje.format(agora)) {
    return { tom: "hoje", texto: `Hoje · ${fmtHora.format(alvo)}` };
  }
  return { tom: "futuro", texto: `${fmtData.format(alvo)} · ${fmtHora.format(alvo)}` };
}

export function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/);
  const a = partes[0]?.[0] ?? "";
  const b = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? "") : "";
  return (a + b).toUpperCase();
}
