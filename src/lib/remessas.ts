import { supabase } from "@/integrations/supabase/client";

export interface RemessaCard {
  id: string;
  numero: number;
  praca_id: string;
  praca: string;
  representante: string | null;
  data_emissao: string;
  data_acerto: string | null;
  status: string;
  maletas: number;
  maletas_conferidas: number;
  consultoras_praca: number;
  pecas: number;
  valor_cents: number;
}

export interface MaletaDaRemessa {
  cycle_id: string;
  consultora_party_id: string | null;
  consultora: string | null;
  status: string;
  pecas: number;
  valor_cents: number;
  /** 0266: maleta de abertura (sem consultora na saída) → ABERTURA 01, 02… */
  abertura_numero?: number | null;
  /** 0266: ordem da maleta da consultora nesta remessa → MALETA 01; acréscimo → MALETA 02 */
  maleta_seq?: number | null;
}

const dois = (n: number) => String(n).padStart(2, "0");
/** Rótulo da maleta na remessa: "ABERTURA 01" (abertura) ou "MALETA 01" (consultora). */
export function rotuloMaletaRemessa(m: Pick<MaletaDaRemessa, "abertura_numero" | "maleta_seq" | "consultora_party_id">): string | null {
  if (m.abertura_numero) return `ABERTURA ${dois(m.abertura_numero)}`;
  if (m.consultora_party_id && m.maleta_seq) return `MALETA ${dois(m.maleta_seq)}`;
  return null;
}

export const STATUS_REMESSA: Record<string, { rotulo: string; tom: "neutral" | "warning" | "success" | "danger" }> = {
  montagem: { rotulo: "Em montagem", tom: "warning" },
  na_rua: { rotulo: "Na rua", tom: "neutral" },
  acerto: { rotulo: "Em acerto", tom: "warning" },
  fechada: { rotulo: "Finalizada", tom: "success" },
  cancelada: { rotulo: "Cancelada", tom: "danger" },
};

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}

/** Remessas canceladas (testes, criadas por engano) saem das listas; ficam só na auditoria. */
export const listarRemessas = async (status?: string, opcoes?: { comCanceladas?: boolean }) => {
  const l = await rpc<RemessaCard[]>("remessas_lista", { _status: status && status !== "todas" ? status : null });
  return opcoes?.comCanceladas || status === "cancelada" ? l : l.filter((r) => r.status !== "cancelada");
};

export const maletasDaRemessa = (id: string) => rpc<MaletaDaRemessa[]>("remessa_maletas", { _remessa: id });

export const criarRemessa = (p: {
  praca: string;
  numero?: number | null;
  data_emissao?: string | null;
  data_acerto?: string | null;
  representante?: string | null;
  deposito?: string | null;
  observacoes?: string | null;
}) =>
  rpc<{ id: string; numero: number }>("remessa_criar", {
    _praca: p.praca,
    _numero: p.numero ?? null,
    _data_emissao: p.data_emissao ?? null,
    _data_acerto: p.data_acerto ?? null,
    _representante: p.representante ?? null,
    _deposito: p.deposito ?? null,
    _observacoes: p.observacoes ?? null,
  });

export const abrirMaletaNaRemessa = (remessa: string, consultora: string) =>
  rpc<{ cycle_id: string; repetida?: boolean }>("remessa_abrir_maleta", { _remessa: remessa, _consultora: consultora });

/** Busca única: rede toda inclui sem praça e outras praças; o servidor preserva carteiras restritas. */
export const buscarConsultorasDaRemessa = async (remessa: string, termo: string) => {
  const linhas = await rpc<{ party_id: string; display_name: string; code: string | null; cpf: string | null; praca: string | null; mesma_praca: boolean }[]>("remessa_consultoras_buscar", {
    _remessa: remessa, _search: termo.trim() || null,
  });
  return linhas.map((p) => ({ value: p.party_id, label: rotuloConsultora(p),
    group: p.mesma_praca ? "Nesta praça" : p.praca ? "Outras praças" : "Sem praça",
    hint: [p.cpf ? `CPF ${p.cpf}` : null, p.praca ? `Praça ${p.praca}` : "Sem praça"].filter(Boolean).join(" · ") }));
};

/** Vínculo e abertura atômicos: falha na abertura não muda a praça da consultora. */
export const abrirMaletaPelaBusca = (remessa: string, consultora: string) =>
  rpc<{ cycle_id: string; repetida?: boolean }>("remessa_abrir_maleta_busca", { _remessa: remessa, _consultora: consultora });

/** 0322: segunda maleta para quem já tem maleta nesta remessa (motivo obrigatório, fica na auditoria). */
export const abrirSegundaMaletaNaRemessa = (remessa: string, consultora: string, motivo: string) =>
  rpc<{ cycle_id: string; repetida?: boolean; primeira_maleta?: string }>("remessa_abrir_segunda_maleta", {
    _remessa: remessa,
    _consultora: consultora,
    _motivo: motivo,
  });

export const consultorasDaPraca = async (praca: string, termo: string) => {
  // 0224: busca por nome (por partes), código atual/antigo/legado ou CPF.
  const linhas = await rpc<{ party_id: string; display_name: string; code: string | null; cpf: string | null }[]>("praca_consultoras_busca", {
    _praca: praca,
    _search: termo.trim() || null,
  });
  // 0315: cidade e responsável junto do nome na busca da abertura
  const ctx = await contextoPessoas(linhas.map((p) => p.party_id));
  return linhas.map((p) => {
    const hint = [p.cpf ? `CPF ${p.cpf}` : null, ...dicaContexto(ctx.get(p.party_id))].filter(Boolean).join(" · ");
    return { value: p.party_id, label: rotuloConsultora(p), ...(hint ? { hint } : {}) };
  });
};

type ContextoPessoa = { party_id: string; cidade: string | null; uf: string | null; praca: string | null; responsavel: string | null };
/** 0315: cidade/UF, praça e responsável de cada pessoa (só de quem o usuário já pode ver). Falha vira sem contexto, nunca bloqueia a busca. */
export async function contextoPessoas(ids: string[]): Promise<Map<string, ContextoPessoa>> {
  const m = new Map<string, ContextoPessoa>();
  if (!ids.length) return m;
  for (let i = 0; i < ids.length; i += 2000) {
    const { data } = await supabase.rpc("pessoas_busca_contexto" as never, { _ids: ids.slice(i, i + 2000) } as never);
    for (const x of ((data ?? []) as unknown as ContextoPessoa[])) m.set(x.party_id, x);
  }
  return m;
}
export const dicaContexto = (c?: ContextoPessoa) =>
  c ? [c.cidade ? `${c.cidade}${c.uf ? `/${c.uf}` : ""}` : null, c.responsavel ? `Resp. ${c.responsavel}` : null] : [];

export const dataBR = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
export const isoDia = (d?: Date) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;

export interface FiltrosRemessa {
  busca?: string;
  status?: string;
  praca?: string;
  representante?: string;
  de?: string | null;
  ate?: string | null;
  campoData?: "emissao" | "acerto";
}

export const buscarRemessas = async (f: FiltrosRemessa) => semCanceladas(f.status, await
  // 0362: a lista normal não mostra as maletas diretas (elas ficam na aba "Maletas individuais")
  rpc<RemessaCard[]>("remessas_buscar2", {
    _diretas: false,
    _busca: f.busca?.trim() || null,
    _status: f.status && f.status !== "todas" ? f.status : null,
    _praca: f.praca || null,
    _representante: f.representante || null,
    _de: f.de ?? null,
    _ate: f.ate ?? null,
    _campo_data: f.campoData ?? "emissao",
  }));
/** Limpeza (ordem do Daniel): o que foi cancelado/excluído some das telas e fica só na auditoria, exceto quando o filtro pede "cancelada". */
export const semCanceladas = <T extends { status: string }>(filtro: string | undefined, l: T[]) =>
  filtro === "cancelada" ? l : l.filter((r) => r.status !== "cancelada");

// ------------------------------------------------- 0157: tipo de envio (pessoal | correio)
export type TipoEnvio = "pessoal" | "correio";
export const lerEnvioRemessa = (id: string) =>
  rpc<{ tipo_envio: TipoEnvio; prazo_correio_dias: number; postar_ate: string | null } | null>("remessa_envio_ler", { _remessa: id });
export const definirEnvioRemessa = (id: string, tipo: TipoEnvio) =>
  rpc<{ tipo_envio: TipoEnvio; repetido: boolean }>("remessa_tipo_envio_definir", { _remessa: id, _tipo: tipo });

/** 0184: finalizar (tranca) a remessa — exige digitar o número; reabrir só Master com motivo. */
export const finalizarRemessa = (id: string, numero: number) =>
  rpc<{ numero: number; maletas?: number; repetida: boolean }>("remessa_finalizar", { _remessa: id, _confirmacao: numero });
export const reabrirRemessa = (id: string, motivo: string) =>
  rpc<{ numero: number; status: string }>("remessa_reabrir", { _remessa: id, _motivo: motivo });

/** 0184: consultoras ainda sem praça (do representante da remessa) para trazer à praça da remessa. */
export const consultorasSemPraca = async (remessa: string, termo: string) => {
  if (termo.trim().length < 2) return [];
  const l = await rpc<{ party_id: string; display_name: string; representante: string | null; code: string | null; cpf: string | null; praca: string | null }[]>("remessa_consultoras_sem_praca_busca", {
    _remessa: remessa, _search: termo.trim(),
  });
  return l.map((p) => ({ value: p.party_id, label: rotuloConsultora(p), hint: [p.cpf ? `CPF ${p.cpf}` : null, p.representante ? `Rep. ${p.representante}` : null, p.praca ? `Praça ${p.praca} (vem para esta)` : "Sem praça"].filter(Boolean).join(" · ") }));
};
export const vincularConsultoraRemessa = (remessa: string, consultora: string) =>
  rpc<{ repetida: boolean }>("remessa_vincular_consultora", { _remessa: remessa, _consultora: consultora });

/** Rótulo padrão de consultora nos seletores: "[Cód. 1234] Nome". */
export const rotuloConsultora = (p: { display_name: string; code: string | null }) =>
  p.code ? `[Cód. ${p.code}] ${p.display_name}` : p.display_name;

// ------------------------------------------------- 0246: informações da remessa (para o acerto)
export type MotivoSemMaleta = "inadimplente" | "pausa" | "sem_estoque" | "desistiu" | "outro";
export const MOTIVOS_SEM_MALETA: { id: MotivoSemMaleta; rotulo: string }[] = [
  { id: "inadimplente", rotulo: "Inadimplente" },
  { id: "pausa", rotulo: "Pediu pausa" },
  { id: "sem_estoque", rotulo: "Sem peças/estoque" },
  { id: "desistiu", rotulo: "Desistiu" },
  { id: "outro", rotulo: "Outro (escreva)" },
];
export interface InformacaoRemessa {
  party_id: string; nome: string; codigo: string | null; cycle_id: string | null; maleta: string | null; status_maleta: string | null;
  tem_maleta: boolean; sem_maleta_motivo: MotivoSemMaleta | null; info_acerto: string | null; atualizado_por_nome: string | null;
  updated_at: string | null; debito_vencido_cents: number;
}
export const informacoesDaRemessa = (id: string) => rpc<InformacaoRemessa[]>("remessa_informacoes_lista", { _remessa: id });
export const salvarInformacaoRemessa = (remessa: string, party: string, motivo: MotivoSemMaleta | null, info: string) =>
  rpc<unknown>("remessa_informacao_salvar", { _remessa: remessa, _party: party, _motivo: motivo, _info: info });

/** 0352: "Nova maleta" direta — sem representante; consultora, data de acerto e responsável. */
export type ConsultoraDireta = { party_id: string; display_name: string; code: string | null; cpf: string | null; praca_id: string | null; praca: string | null };
export const consultorasMaletaDireta = (termo: string) =>
  termo.trim().length < 2 ? Promise.resolve([] as ConsultoraDireta[]) : rpc<ConsultoraDireta[]>("maleta_direta_consultoras", { _search: termo.trim() });
export const responsaveisMaletaDireta = () => rpc<{ user_id: string; nome: string }[]>("maleta_direta_responsaveis", {});
export const abrirMaletaDireta = (p: {
  consultora: string;
  data_acerto: string;
  responsavel: string;
  deposito?: string | null;
  praca?: string | null;
  tipo_envio?: TipoEnvio;
}) =>
  rpc<{ cycle_id: string; remessa_id: string; remessa_numero: number; repetida?: boolean }>("maleta_direta_abrir", {
    _consultora: p.consultora,
    _data_acerto: p.data_acerto,
    _responsavel: p.responsavel,
    _deposito: p.deposito ?? null,
    _praca: p.praca ?? null,
    _tipo_envio: p.tipo_envio ?? "pessoal",
  });

// ------------------------------------------------- 0362: aba "Maletas individuais" (remessa direta, só responsável)
export interface MaletaIndividual {
  cycle_id: string;
  remessa_id: string;
  remessa_numero: number;
  maleta: string;
  consultora_party_id: string | null;
  consultora: string | null;
  consultora_codigo: string | null;
  responsavel: string;
  praca: string;
  data_emissao: string;
  data_acerto: string | null;
  status: string;
  pecas: number;
  valor_cents: number;
}
export type SituacaoIndividual = "abertas" | "encerradas" | "todas";
export const buscarMaletasIndividuais = (busca: string, situacao: SituacaoIndividual) =>
  rpc<MaletaIndividual[]>("maletas_individuais_buscar", { _busca: busca.trim() || null, _situacao: situacao });

/** 0385: representante que atende a maioria das consultoras da praça (sugestão na Nova remessa). */
export const representanteSugerido = async (praca: string) => {
  const { data, error } = await supabase.rpc("remessa_rep_sugerido", { _praca: praca });
  if (error) throw error;
  const l = (data ?? []) as { party_id: string; nome: string; consultoras: number }[];
  return l[0] ?? null;
};
