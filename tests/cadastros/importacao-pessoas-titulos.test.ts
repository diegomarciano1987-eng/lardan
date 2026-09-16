/**
 * Importação de pessoas e de títulos financeiros.
 *
 * Prova, com as mesmas funções que a tela usa, que: a simulação não grava; a
 * gravação real reproduz os números da simulação; a mesma pessoa em arquivos
 * diferentes continua sendo uma pessoa; homônimo sem documento fica pendente
 * em vez de fundir; documento de outra pessoa vira conflito; e o reenvio do
 * mesmo arquivo de títulos não duplica. A massa usa o prefixo de homologação
 * e é removida ao fim.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarConta, limpar, rpc, TEST_PREFIX, type Conta } from "../security/harness";

const SERVICE = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
const URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!;

const admin = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const texto = await res.text();
  try {
    return { status: res.status, body: JSON.parse(texto) as unknown };
  } catch {
    return { status: res.status, body: texto as unknown };
  }
};

type Resultado = {
  simulacao: boolean;
  contadores: Record<string, number>;
  linhas: { n: number; situacao: string; motivo: string | null }[];
};

let master: Conta;
const SUFIXO = crypto.randomUUID().slice(0, 8);

/** CPF válido gerado a partir de uma base numérica. */
function cpfValido(base: string) {
  const d = base.padStart(9, "0").slice(0, 9).split("").map(Number);
  const calc = (len: number) => {
    const soma = d
      .slice(0, len)
      .reduce((acc, n, i) => acc + n * (len + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = calc(9);
  d.push(d1);
  const d2 = calc(10);
  return `${d.join("")}${d2}`;
}

const CPF_A = cpfValido(String(Date.now()).slice(-9));
const CPF_B = cpfValido(String(Date.now() + 12345).slice(-9));

const NOME_A = `${TEST_PREFIX} Pessoa A ${SUFIXO}`;
const NOME_B = `${TEST_PREFIX} Pessoa B ${SUFIXO}`;

const pessoas = (rows: Record<string, string>[], papel: string, dry: boolean) =>
  rpc(master.token, "import_pessoas", { _rows: rows, _papel: papel, _dry_run: dry });

const titulos = (
  rows: Record<string, string>[],
  direction: string,
  dry: boolean,
  criar = true,
) =>
  rpc(master.token, "import_titulos", {
    _rows: rows,
    _direction: direction,
    _dry_run: dry,
    _criar_contraparte: criar,
  });

async function contarPessoas() {
  const { body } = await admin(
    `/parties?display_name=ilike.*${encodeURIComponent(SUFIXO)}*&select=id`,
  );
  return (body as unknown[]).length;
}

beforeAll(async () => {
  master = await criarConta({ nome: "import-cadastros-master", papeis: ["master"] });
}, 120_000);

afterAll(async () => {
  await admin(`/financial_titles?descricao=ilike.*${encodeURIComponent(SUFIXO)}*`, {
    method: "DELETE",
  });
  await admin(`/parties?display_name=ilike.*${encodeURIComponent(SUFIXO)}*`, {
    method: "DELETE",
  });
  await limpar();
}, 300_000);

describe("importação de pessoas", () => {
  it("simula sem gravar e devolve os mesmos números da gravação real", async () => {
    const linhas = [
      { n: "2", nome: NOME_A, documento: CPF_A, email: `a.${SUFIXO}@homolog.lardan`, telefone: "11999990000" },
      { n: "3", nome: NOME_B, documento: CPF_B },
    ];

    const simulado = (await pessoas(linhas, "cliente", true)).body as Resultado;
    expect(simulado.simulacao).toBe(true);
    expect(simulado.contadores["recebidas"]).toBe(2);
    expect(simulado.contadores["novos"]).toBe(2);
    expect(await contarPessoas()).toBe(0);

    const real = (await pessoas(linhas, "cliente", false)).body as Resultado;
    expect(real.contadores["novos"]).toBe(simulado.contadores["novos"]);
    expect(await contarPessoas()).toBe(2);
  }, 120_000);

  it("a mesma pessoa em outro arquivo continua sendo uma pessoa", async () => {
    const res = (await pessoas(
      [{ n: "2", nome: `${NOME_A} (grafia diferente)`, documento: CPF_A, profissao: "Consultora" }],
      "consultora",
      false,
    )).body as Resultado;
    expect(res.contadores["novos"]).toBe(0);
    expect((res.contadores["vinculados"] ?? 0) + (res.contadores["atualizados"] ?? 0)).toBe(1);
    expect(await contarPessoas()).toBe(2);
  }, 120_000);

  it("homônimo sem documento não funde: fica pendente de decisão", async () => {
    const res = (await pessoas([{ n: "2", nome: NOME_A }], "cliente", true)).body as Resultado;
    expect(res.contadores["pendentes"]).toBe(1);
    expect(res.linhas[0]?.situacao).toBe("pendente");
  }, 120_000);

  it("documento já usado por outra pessoa vira conflito, não sobrescreve", async () => {
    const res = (await pessoas(
      [{ n: "2", nome: `${TEST_PREFIX} Outro Nome ${SUFIXO}`, documento: CPF_A }],
      "cliente",
      true,
    )).body as Resultado;
    expect(res.contadores["conflitos"]).toBe(1);
    expect(res.linhas[0]?.motivo).toBeTruthy();
  }, 120_000);

  it("linha sem nome é recusada com motivo", async () => {
    const res = (await pessoas([{ n: "2", documento: CPF_B }], "cliente", true)).body as Resultado;
    expect(res.contadores["recusados"]).toBe(1);
    expect(res.linhas[0]?.situacao).toBe("recusado");
  }, 120_000);
});

describe("importação de títulos", () => {
  const linha = {
    n: "2",
    contraparte: NOME_A,
    documento_contraparte: CPF_A,
    descricao: `${TEST_PREFIX} Título ${SUFIXO}`,
    documento: `NF-${SUFIXO}`,
    vencimento: "15/03/2026",
    valor: "1.234,56",
    id_externo: `EXT-${SUFIXO}`,
  };

  it("simula sem gravar e depois grava o título a pagar", async () => {
    const simulado = (await titulos([linha], "payable", true)).body as Resultado;
    expect(simulado.contadores["novos"]).toBe(1);

    const real = (await titulos([linha], "payable", false)).body as Resultado;
    expect(real.contadores["novos"]).toBe(1);

    const { body } = await admin(
      `/financial_titles?id_externo=eq.EXT-${SUFIXO}&select=valor_cents,direction,status`,
    );
    const rows = body as { valor_cents: number; direction: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0]?.valor_cents).toBe(123456);
    expect(rows[0]?.direction).toBe("payable");
  }, 120_000);

  it("reenviar o mesmo arquivo não duplica títulos", async () => {
    const res = (await titulos([linha], "payable", false)).body as Resultado;
    expect(res.contadores["repetidos"]).toBe(1);
    expect(res.contadores["novos"]).toBe(0);

    const { body } = await admin(`/financial_titles?id_externo=eq.EXT-${SUFIXO}&select=id`);
    expect((body as unknown[]).length).toBe(1);
  }, 120_000);

  it("sem contraparte conhecida e sem autorização de criar, fica pendente", async () => {
    const res = (await titulos(
      [
        {
          ...linha,
          contraparte: `${TEST_PREFIX} Fornecedor Inexistente ${SUFIXO}`,
          documento_contraparte: "",
          id_externo: `EXT2-${SUFIXO}`,
        },
      ],
      "payable",
      true,
      false,
    )).body as Resultado;
    expect(res.contadores["pendentes"]).toBe(1);
  }, 120_000);

  it("linha sem valor ou sem vencimento é recusada", async () => {
    const res = (await titulos(
      [{ n: "2", contraparte: NOME_A, documento_contraparte: CPF_A, vencimento: "", valor: "" }],
      "receivable",
      true,
    )).body as Resultado;
    expect(res.contadores["recusados"]).toBe(1);
  }, 120_000);
});
