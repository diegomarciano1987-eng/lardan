/**
 * Leitura dos CSV do pacote "LARDAN_HISTORICO_SmallData" (gerado pelo extrator).
 * Puro, sem dependência: aspas, vírgulas e quebras de linha dentro de campo,
 * BOM e fim de linha Windows. Todo valor fica como texto: o banco converte.
 */
export type LinhaCsv = Record<string, string>;

export function lerCsv(texto: string): LinhaCsv[] {
  const s = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let aspas = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (aspas) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") {
      linha.push(campo);
      campo = "";
    } else if (c === "\n") {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else if (c !== "\r") campo += c;
  }
  if (campo !== "" || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }
  const cabecalho = linhas[0];
  if (!cabecalho) return [];
  const nomes = cabecalho.map((n) => n.trim());
  return linhas
    .slice(1)
    .filter((l) => l.length > 1 || (l.length === 1 && l[0] !== ""))
    .map((l) => {
      const o: LinhaCsv = {};
      nomes.forEach((n, i) => {
        o[n] = l[i] ?? "";
      });
      return o;
    });
}

/** Divide em blocos de até `tamanho` linhas (o banco aceita até 2.000 por envio). */
export function emBlocos<T>(itens: T[], tamanho = 1000): T[][] {
  const blocos: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) blocos.push(itens.slice(i, i + tamanho));
  return blocos;
}

/** Ordem obrigatória: cadastros antes das maletas; notas e acertos por último. */
export const ARQUIVOS_HISTORICO = [
  { tipo: "pracas", arquivo: "pracas.csv", rotulo: "Praças", colunas: ["codigo", "nome"] },
  { tipo: "representantes", arquivo: "representantes.csv", rotulo: "Representantes", colunas: ["codigo", "nome"] },
  { tipo: "consultoras", arquivo: "consultoras.csv", rotulo: "Consultoras", colunas: ["codcli", "nome", "cpf"] },
  { tipo: "produtos", arquivo: "produtos.csv", rotulo: "Produtos", colunas: ["codigo", "nome", "categoria"] },
  { tipo: "remessas", arquivo: "remessas.csv", rotulo: "Remessas", colunas: ["numero", "emissao", "status"] },
  { tipo: "maletas", arquivo: "maletas.csv", rotulo: "Maletas", colunas: ["remessa", "codcli", "kit", "pecas_enviadas"] },
  { tipo: "maleta_categorias", arquivo: "maleta_categorias.csv", rotulo: "Maletas por categoria", colunas: ["remessa", "codcli", "kit", "categoria"] },
  { tipo: "maleta_vendidos", arquivo: "maleta_vendidos.csv", rotulo: "Peças vendidas", colunas: ["remessa", "codcli", "kit", "produto", "quantidade"] },
  { tipo: "notas", arquivo: "notas.csv", rotulo: "Notas fiscais", colunas: ["nf_id", "numero", "serie"] },
  { tipo: "acertos_praca", arquivo: "acertos_praca.csv", rotulo: "Acertos de praça", colunas: ["codigo", "praca", "data"] },
  { tipo: "acertos_consultora", arquivo: "acertos_consultora.csv", rotulo: "Acertos das consultoras (valor da venda)", colunas: ["remessa", "codcli", "valor", "data"] },
  { tipo: "maletas_status", arquivo: "maletas_status.csv", rotulo: "Situação das maletas (status do SmallData)", colunas: ["remessa", "codcli", "status", "data"] },
] as const;

export type TipoHistorico = (typeof ARQUIVOS_HISTORICO)[number]["tipo"];

/** Confere se o arquivo tem as colunas esperadas antes de enviar qualquer linha. */
export function conferirColunas(tipo: TipoHistorico, linhas: LinhaCsv[]): string | null {
  const def = ARQUIVOS_HISTORICO.find((a) => a.tipo === tipo);
  const primeira = linhas[0];
  if (!def) return `Tipo desconhecido: ${tipo}`;
  if (!primeira) return `${def.arquivo}: arquivo vazio.`;
  const faltam = def.colunas.filter((c) => !(c in primeira));
  return faltam.length ? `${def.arquivo}: faltam as colunas ${faltam.join(", ")}.` : null;
}
