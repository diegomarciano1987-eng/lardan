import { supabase } from "@/integrations/supabase/client";
import { compactarFoto } from "@/lib/foto-compacta";

/** Canal de Qualidade (trocas e garantias): regras compartilhadas entre o painel Lardan e o app da consultora. */
export const BUCKET_QUALIDADE = "consultora-pos-venda";

export type StatusTroca = "aberta" | "em_analise" | "aguardando_envio" | "resolvida" | "recusada";
export type SolucaoTroca = "mesma_peca" | "troca" | "credito" | "conserto" | "sem_defeito";

export const STATUS_TROCA: Record<StatusTroca, string> = {
  aberta: "Aberta",
  em_analise: "Em análise",
  aguardando_envio: "Aguardando envio",
  resolvida: "Finalizada",
  recusada: "Recusada",
};

/** Como a consultora lê a situação no app (linguagem dela). */
export const STATUS_TROCA_CONSULTORA: Record<StatusTroca, string> = {
  aberta: "Recebida pela Lardan",
  em_analise: "Em análise na Qualidade",
  aguardando_envio: "Aprovada · vai na próxima maleta",
  resolvida: "Finalizada · peça enviada",
  recusada: "Não aprovada",
};

export const SOLUCAO_TROCA: Record<SolucaoTroca, string> = {
  mesma_peca: "Vai a mesma peça",
  troca: "Troca por outra peça",
  credito: "Crédito no acerto",
  conserto: "Conserto / novo banho",
  sem_defeito: "Sem defeito constatado",
};

export const MOTIVOS_TROCA = ["Escureceu", "Pedra soltou", "Quebrou", "Fecho com defeito", "Tamanho errado", "Cliente desistiu", "Peça achada", "Outro"];

/** Para onde a Lardan pode mover cada situação (espelha qualidade_troca_mover). */
export function proximosStatus(atual: StatusTroca): StatusTroca[] {
  if (atual === "resolvida" || atual === "recusada") return ["em_analise"];
  const todos: StatusTroca[] = ["aberta", "em_analise", "aguardando_envio", "resolvida", "recusada"];
  return todos.filter((s) => s !== atual);
}

/** Diferença da troca: valor da peça devolvida menos a enviada (negativo = consultora leva peça mais cara). */
export function diferencaTroca(devCents: number | null | undefined, repCents: number | null | undefined) {
  if (devCents == null || repCents == null) return null;
  return devCents - repCents;
}

export const protocoloTroca = (p: number | string) => `TG-${String(p).padStart(6, "0")}`;

export const brlTroca = (c: number | null | undefined) =>
  c == null ? "—" : (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export type Troca = {
  id: string;
  protocolo: number;
  legado_id: number | null;
  origem: "legado_smalldata" | "admin_manual" | "app_consultora";
  consultora_party_id: string;
  consultora_codigo: string | null;
  consultora_nome: string | null;
  praca_codigo: number | null;
  praca_nome: string | null;
  tipo: "troca" | "garantia";
  status: StatusTroca;
  motivo: string | null;
  observacao: string | null;
  dev_variant_id: string | null;
  dev_referencia: string | null;
  dev_nome: string | null;
  dev_tamanho: string | null;
  dev_valor_cents: number | null;
  solucao: SolucaoTroca | null;
  rep_variant_id: string | null;
  rep_referencia: string | null;
  rep_nome: string | null;
  rep_tamanho: string | null;
  rep_valor_cents: number | null;
  diferenca_cents: number | null;
  parecer: string | null;
  fotos: string[];
  aberto_em: string;
  aberto_por_nome: string | null;
  finalizado_em: string | null;
  finalizado_por_nome: string | null;
  transmissao_em: string | null;
  transmissao_por_nome: string | null;
  novidade_consultora: boolean;
  novidade_lardan: boolean;
};

export type EventoTroca = {
  id: string;
  autor: "consultora" | "lardan" | "sistema";
  autor_nome: string | null;
  status: string | null;
  texto: string | null;
  fotos: string[];
  interno: boolean;
  created_at: string;
};

export type PecaBusca = { id: string; referencia: string | null; nome: string; tamanho: string | null; valor_cents: number | null; barcode: string | null };

export async function buscarPecaTroca(termo: string): Promise<PecaBusca[]> {
  const { data, error } = await supabase.rpc("qualidade_buscar_peca", { _termo: termo, _limite: 20 });
  if (error) throw error;
  return (data ?? []) as unknown as PecaBusca[];
}

export async function eventosTroca(id: string): Promise<EventoTroca[]> {
  const { data, error } = await supabase
    .from("qualidade_trocas_eventos")
    .select("id,autor,autor_nome,status,texto,fotos,interno,created_at")
    .eq("troca_id", id)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as unknown as EventoTroca[];
}

/** Envia fotos para a pasta da própria conta (exigência do banco) e devolve os caminhos. */
export async function enviarFotosTroca(arquivos: File[], chave: string): Promise<string[]> {
  if (arquivos.length === 0) return [];
  const { data: auth, error: authErro } = await supabase.auth.getUser();
  if (authErro || !auth.user) throw new Error("Entre novamente para continuar.");
  const paths: string[] = [];
  for (let i = 0; i < arquivos.length; i++) {
    const bruto = arquivos[i];
    if (!bruto) continue;
    const f = await compactarFoto(bruto);
    const ext = f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
    const path = `${auth.user.id}/qualidade/${chave}/${i}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET_QUALIDADE).upload(path, f, { contentType: f.type || "image/jpeg", upsert: false });
    if (error && !/already exists/i.test(error.message)) throw error;
    paths.push(path);
  }
  return paths;
}

export async function urlsFotosTroca(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    const { data, error } = await supabase.storage.from(BUCKET_QUALIDADE).createSignedUrl(p, 600);
    if (!error && data) out.push(data.signedUrl);
  }
  return out;
}

export const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";

export function diasDesde(iso: string, ate?: string | null) {
  const fim = ate ? new Date(ate).getTime() : Date.now();
  return Math.max(0, Math.floor((fim - new Date(iso).getTime()) / 86_400_000));
}
