/** Unidades federativas oficiais (IBGE). Fallback local quando o IBGE cai. */
export interface Uf {
  sigla: string;
  nome: string;
  codigo_ibge: number;
}

export const UFS_BR: Uf[] = [
  { sigla: "AC", nome: "Acre", codigo_ibge: 12 },
  { sigla: "AL", nome: "Alagoas", codigo_ibge: 27 },
  { sigla: "AP", nome: "Amapá", codigo_ibge: 16 },
  { sigla: "AM", nome: "Amazonas", codigo_ibge: 13 },
  { sigla: "BA", nome: "Bahia", codigo_ibge: 29 },
  { sigla: "CE", nome: "Ceará", codigo_ibge: 23 },
  { sigla: "DF", nome: "Distrito Federal", codigo_ibge: 53 },
  { sigla: "ES", nome: "Espírito Santo", codigo_ibge: 32 },
  { sigla: "GO", nome: "Goiás", codigo_ibge: 52 },
  { sigla: "MA", nome: "Maranhão", codigo_ibge: 21 },
  { sigla: "MT", nome: "Mato Grosso", codigo_ibge: 51 },
  { sigla: "MS", nome: "Mato Grosso do Sul", codigo_ibge: 50 },
  { sigla: "MG", nome: "Minas Gerais", codigo_ibge: 31 },
  { sigla: "PA", nome: "Pará", codigo_ibge: 15 },
  { sigla: "PB", nome: "Paraíba", codigo_ibge: 25 },
  { sigla: "PR", nome: "Paraná", codigo_ibge: 41 },
  { sigla: "PE", nome: "Pernambuco", codigo_ibge: 26 },
  { sigla: "PI", nome: "Piauí", codigo_ibge: 22 },
  { sigla: "RJ", nome: "Rio de Janeiro", codigo_ibge: 33 },
  { sigla: "RN", nome: "Rio Grande do Norte", codigo_ibge: 24 },
  { sigla: "RS", nome: "Rio Grande do Sul", codigo_ibge: 43 },
  { sigla: "RO", nome: "Rondônia", codigo_ibge: 11 },
  { sigla: "RR", nome: "Roraima", codigo_ibge: 14 },
  { sigla: "SC", nome: "Santa Catarina", codigo_ibge: 42 },
  { sigla: "SP", nome: "São Paulo", codigo_ibge: 35 },
  { sigla: "SE", nome: "Sergipe", codigo_ibge: 28 },
  { sigla: "TO", nome: "Tocantins", codigo_ibge: 17 },
];

export const SIGLAS_UF = UFS_BR.map((u) => u.sigla);

export const ufValida = (v: string | null | undefined) =>
  !!v && SIGLAS_UF.includes(v.toUpperCase());

export const OPCOES_UF = UFS_BR.map((u) => ({ value: u.sigla, label: `${u.sigla} · ${u.nome}` }));
