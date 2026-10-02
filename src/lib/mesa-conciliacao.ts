import { supabase } from "@/integrations/supabase/client";

async function rpc<T>(f: string, a: Record<string, unknown> = {}): Promise<T> {
  const r = (await supabase.rpc(f as never, a as never)) as unknown as {
    data: unknown;
    error: { message: string } | null;
  };
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export const PAPEL_LABEL: Record<string, string> = {
  consultora: "Consultora",
  revendedora: "Revendedora",
  representante: "Representante",
  fornecedor: "Fornecedor",
  cliente: "Cliente",
  colaborador: "Colaborador",
  candidata: "Candidata",
  transportadora: "Transportadora",
  prestador: "Prestador",
  custodiante: "Custodiante",
  entidade_grupo: "Empresa do grupo",
  usuario: "Usuário",
  loja: "Loja",
};

export const papeisTexto = (p: string[] | null | undefined) =>
  (p ?? []).map((x) => PAPEL_LABEL[x] ?? x).join(" · ");

export type Palpite = {
  chave: string | null;
  vezes: number;
  party_id?: string | null;
  party_nome?: string | null;
  cost_center_id?: string | null;
  chart_account_id?: string | null;
  payment_method_id?: string | null;
};

export type ContraparteMesa = { id: string; nome: string; code: string; papeis: string[] };
export type CentroMesa = {
  id: string;
  codigo: string;
  nome: string;
  responsavel_party_id: string | null;
  responsavel_nome: string | null;
  papeis: string[];
};
export type TituloDaParcela = {
  title_id: string;
  updated_at: string;
  cost_center_id: string | null;
  chart_account_id: string | null;
  payment_method_id: string | null;
  party_id: string | null;
  business_entity_id: string | null;
  financial_account_id: string | null;
};

/** Classificação aprendida com conciliações anteriores do mesmo tipo de histórico. */
export const palpiteDaLinha = (line: string) => rpc<Palpite>("fin_mesa_palpite", { _line: line });
export const contrapartesMesa = (busca: string) =>
  rpc<ContraparteMesa[]>("fin_mesa_contrapartes", { _busca: busca || null });
export const centrosMesa = () => rpc<CentroMesa[]>("fin_mesa_centros");
export const tituloDaParcela = (inst: string) =>
  rpc<TituloDaParcela>("fin_mesa_titulo_da_parcela", { _inst: inst });
