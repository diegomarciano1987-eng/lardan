import { supabase } from "@/integrations/supabase/client";

export type Cliente = {
  id: string;
  nome: string;
  telefone: string;
  email: string | null;
  aniversario: string | null;
  preferencias: string;
  observacoes: string;
  proximo_retorno: string | null;
  created_at: string;
  etapa: Etapa;
  instagram: string | null;
  origem: string;
  encerrada: boolean;
  encerrada_motivo: string | null;
  ultima_interacao: string | null;
};

export type Etapa = "nova" | "conversa" | "escolhendo" | "combinado" | "cliente";
export const ETAPAS: { id: Etapa; rotulo: string; dica: string }[] = [
  { id: "nova", rotulo: "Nova interessada", dica: "Cadastrada, ainda sem conversa registrada" },
  { id: "conversa", rotulo: "Em conversa", dica: "Contato iniciado" },
  { id: "escolhendo", rotulo: "Escolhendo peças", dica: "Já sabe do que ela gosta" },
  { id: "combinado", rotulo: "Pedido combinado", dica: "Pedido em atendimento, ainda não é venda" },
  { id: "cliente", rotulo: "Cliente", dica: "Já tem venda registrada" },
];
export const rotuloEtapa = (e: string) => ETAPAS.find((x) => x.id === e)?.rotulo ?? (e === "pausada" ? "Pausada" : e === "reativada" ? "Reativada" : e);
export type EventoEtapa = { id: string; de: string | null; para: string; motivo: string | null; created_at: string };

export async function moverEtapa(id: string, etapa: Etapa) {
  const r = await t("consultant_clients").update({ etapa } as never).eq("id", id);
  if (r.error) throw r.error;
}
export async function pausarPessoa(id: string, motivo: string | null) {
  const r = await t("consultant_clients").update({ encerrada: motivo !== null, encerrada_motivo: motivo } as never).eq("id", id);
  if (r.error) throw r.error;
}
export async function historicoEtapas(id: string): Promise<EventoEtapa[]> {
  const { data, error } = await t("consultant_client_stage_events").select("id,de,para,motivo,created_at").eq("client_id", id).order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as EventoEtapa[];
}
export const linkInstagram = (u: string | null) => (u && /^[a-z0-9._]{1,30}$/.test(u) ? `https://instagram.com/${u}` : null);

export type Atendimento = { id: string; canal: "whatsapp" | "ligacao" | "presencial" | "outro"; nota: string; created_at: string };

export type Peca = {
  cycle_id: string;
  variant_id: string;
  produto: string;
  variante: string | null;
  disponivel: number;
  preco_cents: number;
  media_id: string | null;
  maleta: string;
};

export type Inicio = {
  nome: string | null;
  clientes: number;
  retornos_hoje: number;
  retornos_atrasados: number;
  pedidos_abertos: number;
  pedidos_novos: number;
  pedidos_mes: number;
  maletas_receber: number;
  maletas_conferir: number;
  pecas_disponiveis: number;
};

const t = (n: string) => supabase.from(n as never);
const rpc = async <T,>(n: string, a: Record<string, unknown> = {}) => {
  const { data, error } = await supabase.rpc(n as never, a as never);
  if (error) throw error;
  return data as T;
};

export const CANAL: Record<Atendimento["canal"], string> = {
  whatsapp: "WhatsApp",
  ligacao: "Ligação",
  presencial: "Pessoalmente",
  outro: "Outro",
};

export const carregarInicio = () => rpc<Inicio>("consultant_home");
export const pecasDisponiveis = () => rpc<Peca[]>("consultant_pieces");

export async function listarClientes(): Promise<Cliente[]> {
  const { data, error } = await t("consultant_clients").select("*").order("nome");
  if (error) throw error;
  return (data ?? []) as unknown as Cliente[];
}

export async function obterCliente(id: string): Promise<Cliente | null> {
  const { data, error } = await t("consultant_clients").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as unknown as Cliente | null;
}

export async function salvarCliente(c: Partial<Cliente> & { nome: string }, party: string) {
  const linha = {
    nome: c.nome.trim(),
    telefone: (c.telefone ?? "").replace(/\D/g, "").slice(0, 13),
    email: c.email?.trim() || null,
    aniversario: c.aniversario || null,
    preferencias: c.preferencias ?? "",
    observacoes: c.observacoes ?? "",
    proximo_retorno: c.proximo_retorno || null,
    instagram: c.instagram?.trim() || null,
    origem: (c.origem ?? "").trim().slice(0, 80),
  };
  const r = c.id
    ? await t("consultant_clients").update(linha as never).eq("id", c.id).select("id").single()
    : await t("consultant_clients").insert({ ...linha, consultora_party_id: party } as never).select("id").single();
  if (r.error) throw r.error;
  return (r.data as unknown as { id: string }).id;
}

export async function listarAtendimentos(cliente: string): Promise<Atendimento[]> {
  const { data, error } = await t("consultant_client_contacts").select("id,canal,nota,created_at").eq("client_id", cliente).order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as Atendimento[];
}

export async function registrarAtendimento(cliente: string, party: string, canal: Atendimento["canal"], nota: string, retorno: string | null) {
  const r = await t("consultant_client_contacts").insert({ client_id: cliente, consultora_party_id: party, canal, nota } as never);
  if (r.error) throw r.error;
  const u = await t("consultant_clients").update({ proximo_retorno: retorno } as never).eq("id", cliente);
  if (u.error) throw u.error;
}

export async function meuParty(): Promise<string> {
  const id = await rpc<string | null>("my_party_id");
  if (!id) throw new Error("Seu cadastro de consultora não foi encontrado.");
  return id;
}

export const criarPedido = (cliente: string, itens: { cycle_id: string; variant_id: string; quantidade: number }[], chave: string) =>
  rpc<{ order_id: string; codigo: string; total_cents: number; repetido?: boolean }>("consultant_order_create", {
    _client: cliente,
    _itens: itens,
    _idempotency_key: chave,
  });

export const soDigitos = (s: string) => s.replace(/\D/g, "");

export function formatarTelefone(d: string) {
  const n = soDigitos(d).replace(/^55(?=\d{10,11}$)/, "");
  if (n.length <= 2) return n;
  if (n.length <= 6) return `(${n.slice(0, 2)}) ${n.slice(2)}`;
  if (n.length <= 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7, 11)}`;
}

export const linkWhats = (tel: string, texto = "") => {
  const n = soDigitos(tel).replace(/^55(?=\d{10,11}$)/, "");
  return n.length >= 10 ? `https://wa.me/55${n}${texto ? `?text=${encodeURIComponent(texto)}` : ""}` : null;
};

export const dataBR = (iso: string | null) => (iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("pt-BR") : "");
export const hojeISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
