/**
 * LARDAN Cloud — importação de cadastros e de títulos financeiros.
 *
 * A planilha é lida no navegador (texto puro, sem perder zeros à esquerda) e
 * enviada ao banco em blocos. Quem decide o que é novo, o que é vínculo, o que
 * é repetido e o que é recusado é sempre o servidor: `import_pessoas` e
 * `import_titulos`. Simulação e execução usam exatamente o mesmo caminho.
 */
import { supabase } from "@/integrations/supabase/client";

export type SituacaoLinha =
  | "novo"
  | "vinculado"
  | "atualizado"
  | "sem_alteracao"
  | "conflito"
  | "repetido"
  | "recusado"
  | "pendente";

export const SITUACAO_LABEL: Record<SituacaoLinha, string> = {
  novo: "Novo registro",
  vinculado: "Vinculado a quem já existia",
  atualizado: "Atualizado",
  sem_alteracao: "Sem alteração",
  conflito: "Conflito",
  repetido: "Já importado antes",
  recusado: "Recusado",
  pendente: "Aguardando decisão",
};

export interface LinhaResultado {
  n: number;
  nome?: string | null;
  contraparte?: string | null;
  valor_cents?: number | null;
  vencimento?: string | null;
  situacao: SituacaoLinha;
  motivo: string | null;
  party_id?: string | null;
  title_id?: string | null;
}

export interface ResultadoImportacao {
  simulacao: boolean;
  contadores: Record<string, number>;
  linhas: LinhaResultado[];
}

const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

async function chamar(fn: string, args: Record<string, unknown>) {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as ResultadoImportacao;
}

/** Junta os resultados de vários blocos em um só. */
function somar(partes: ResultadoImportacao[]): ResultadoImportacao {
  const contadores: Record<string, number> = {};
  const linhas: LinhaResultado[] = [];
  for (const p of partes) {
    for (const [k, v] of Object.entries(p.contadores ?? {})) contadores[k] = (contadores[k] ?? 0) + Number(v);
    linhas.push(...(p.linhas ?? []));
  }
  return { simulacao: partes[0]?.simulacao ?? true, contadores, linhas };
}

const BLOCO = 300;

async function emBlocos(
  linhas: Record<string, string>[],
  fn: (bloco: Record<string, string>[]) => Promise<ResultadoImportacao>,
  onProgresso?: (feitas: number, total: number) => void,
) {
  const partes: ResultadoImportacao[] = [];
  for (let i = 0; i < linhas.length; i += BLOCO) {
    partes.push(await fn(linhas.slice(i, i + BLOCO)));
    onProgresso?.(Math.min(i + BLOCO, linhas.length), linhas.length);
  }
  return somar(partes);
}

export type PapelImportavel = "cliente" | "consultora" | "representante" | "colaborador" | "loja";

export function importarPessoas(
  linhas: Record<string, string>[],
  papel: PapelImportavel,
  simulacao: boolean,
  onProgresso?: (feitas: number, total: number) => void,
) {
  return emBlocos(
    linhas,
    (bloco) => chamar("import_pessoas", { _rows: bloco, _papel: papel, _dry_run: simulacao }),
    onProgresso,
  );
}

export function importarTitulos(
  linhas: Record<string, string>[],
  direcao: "payable" | "receivable",
  simulacao: boolean,
  criarContraparte: boolean,
  onProgresso?: (feitas: number, total: number) => void,
) {
  return emBlocos(
    linhas,
    (bloco) =>
      chamar("import_titulos", {
        _rows: bloco,
        _direction: direcao,
        _dry_run: simulacao,
        _criar_contraparte: criarContraparte,
      }),
    onProgresso,
  );
}

/* ------------------------------------------------------------- de-para --- */

export interface CampoImportacao {
  key: string;
  label: string;
  obrigatorio?: boolean;
  apelidos: string[];
}

export const CAMPOS_PESSOA: CampoImportacao[] = [
  { key: "nome", label: "Nome", obrigatorio: true, apelidos: ["nome", "nome completo", "cliente", "razao social", "consultora", "representante", "colaborador", "nome fantasia", "loja"] },
  { key: "documento", label: "CPF / CNPJ", apelidos: ["cpf", "cnpj", "cpf/cnpj", "documento", "doc"] },
  { key: "email", label: "E-mail", apelidos: ["email", "e-mail", "mail"] },
  { key: "telefone", label: "Telefone / WhatsApp", apelidos: ["telefone", "celular", "whatsapp", "fone", "contato"] },
  { key: "nascimento", label: "Nascimento", apelidos: ["nascimento", "data de nascimento", "aniversario", "dt nascimento"] },
  { key: "profissao", label: "Profissão", apelidos: ["profissao", "ocupacao", "cargo", "funcao"] },
  { key: "observacao", label: "Observação", apelidos: ["observacao", "obs", "anotacoes", "notas"] },
];

export const CAMPOS_TITULO: CampoImportacao[] = [
  { key: "contraparte", label: "Contraparte (fornecedor / cliente)", obrigatorio: true, apelidos: ["fornecedor", "cliente", "contraparte", "favorecido", "beneficiario", "razao social", "nome", "sacado"] },
  { key: "documento_contraparte", label: "CPF / CNPJ da contraparte", apelidos: ["cnpj", "cpf", "cpf/cnpj fornecedor", "documento do fornecedor", "documento da contraparte"] },
  { key: "descricao", label: "Descrição", apelidos: ["descricao", "historico", "referencia", "titulo", "observacao do titulo"] },
  { key: "documento", label: "Número do documento / NF", apelidos: ["documento", "nota", "nf", "numero do documento", "num documento", "duplicata"] },
  { key: "emissao", label: "Emissão", apelidos: ["emissao", "data de emissao", "dt emissao", "data"] },
  { key: "competencia", label: "Competência", apelidos: ["competencia", "mes de competencia"] },
  { key: "vencimento", label: "Vencimento", obrigatorio: true, apelidos: ["vencimento", "data de vencimento", "dt vencimento", "venc"] },
  { key: "valor", label: "Valor", obrigatorio: true, apelidos: ["valor", "valor do titulo", "total", "valor total", "valor r$", "vlr"] },
  { key: "id_externo", label: "Identificador do sistema antigo", apelidos: ["id", "codigo", "id externo", "identificador"] },
  { key: "observacao", label: "Observação", apelidos: ["observacao", "obs", "notas"] },
];

function normalizar(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Sugere a coluna da planilha para cada campo do sistema. */
export function sugerirMapa(cabecalhos: string[], campos: CampoImportacao[]) {
  const mapa: Record<string, string> = {};
  const usados = new Set<string>();
  for (const campo of campos) {
    const alvo = cabecalhos.find((c) => {
      if (usados.has(c)) return false;
      const n = normalizar(c);
      return n === normalizar(campo.label) || campo.apelidos.some((a) => n === normalizar(a));
    });
    if (alvo) {
      mapa[campo.key] = alvo;
      usados.add(alvo);
    }
  }
  return mapa;
}

/** Aplica o de-para e devolve as linhas prontas para o servidor. */
export function aplicarMapa(
  linhas: Record<string, string>[],
  mapa: Record<string, string>,
): Record<string, string>[] {
  return linhas.map((linha, i) => {
    const saida: Record<string, string> = { n: String(i + 2) };
    for (const [campo, coluna] of Object.entries(mapa)) {
      if (!coluna) continue;
      const v = (linha[coluna] ?? "").trim();
      if (v) saida[campo] = v;
    }
    return saida;
  });
}
