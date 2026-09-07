/**
 * LARDAN Cloud — massa determinística e prova de carga da importação industrial.
 *
 *   bun run massa:importacao:criar   → gera as planilhas sintéticas em tmp-importacao/
 *   bun run massa:importacao:limpar  → apaga tudo que nasceu da importação de homologação
 *   bun run test:importacao          → prova funcional (100 linhas, todos os cenários)
 *   bun run test:importacao:carga    → prova de escala (100, 1.000, 10.000 e 30.000)
 *
 * Nada aqui toca dado real: todo registro nasce com o prefixo IMPHOMOLOG e as
 * planilhas são geradas por semente fixa (mesma entrada, mesmo arquivo, mesma
 * impressão digital).
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { criarConta, rpc, comoUsuario } from "../tests/security/harness";

const PREFIXO = "IMPHOMOLOG";
const PASTA = process.env["LARDAN_IMPORT_DIR"] ?? "/tmp/lardan-importacao";
const ESCALAS = [100, 1_000, 10_000, 30_000] as const;

type Linha = Record<string, string>;

const CATEGORIAS = ["Anéis", "Colares", "Pulseiras", "Brincos"];
const COLECOES = ["Clássicos", "Aurora", "Marés"];
const FORNECEDORES = [`${PREFIXO} Fornecedor Alfa`, `${PREFIXO} Fornecedor Beta`];

function moeda(centavos: number) {
  return `R$ ${(centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

/** Gera as linhas de uma escala. Mesma escala ⇒ exatamente o mesmo conteúdo. */
export function gerarLinhas(total: number): Linha[] {
  const linhas: Linha[] = [];
  for (let i = 1; i <= total; i += 1) {
    const seq = String(i).padStart(6, "0");
    const custo = 1200 + ((i * 37) % 9000);
    const linha: Linha = {
      "Nome do produto": `${PREFIXO} Peça ${seq}`,
      SKU: `${PREFIXO}-${seq}`,
      "Código legado": `000${seq}`,
      "Código de barras": `789${String(1000000000 + i).slice(0, 10)}`,
      Categoria: CATEGORIAS[i % CATEGORIAS.length]!,
      Coleção: COLECOES[i % COLECOES.length]!,
      Fornecedor: FORNECEDORES[i % FORNECEDORES.length]!,
      Material: "Latão",
      Banho: i % 2 === 0 ? "Ouro 18k" : "Ródio",
      Cor: i % 3 === 0 ? "Dourado" : "Prateado",
      Tamanho: String(14 + (i % 8)),
      "Valor de custo": moeda(custo),
      "Preço de venda": moeda(custo * 3),
      Quantidade: String(i % 7),
      "Publicar no site": i % 50 === 0 ? "sim" : "não",
    };

    // cenários controlados, sempre nas mesmas posições
    if (i % 50 === 7) linha["Nome do produto"] = ""; // recusada: sem nome
    if (i % 50 === 11) linha["Valor de custo"] = "-R$ 10,00"; // recusada: custo negativo
    if (i % 50 === 13) linha["Quantidade"] = "-3"; // recusada: quantidade negativa
    if (i % 50 === 17) linha["Quantidade"] = "0"; // válida, sem movimento
    if (i % 50 === 19) linha["Preço de venda"] = "1.299,90"; // preço sem símbolo
    if (i % 100 === 23 && i > 1) {
      // duplicada dentro do próprio arquivo
      linha["SKU"] = `${PREFIXO}-${String(i - 1).padStart(6, "0")}`;
    }
    if (i % 100 === 29) {
      // conflito: SKU de uma peça e código legado de outra
      linha["Código legado"] = `000${String(i + 1).padStart(6, "0")}`;
    }
    linhas.push(linha);
  }
  return linhas;
}

function planilha(linhas: Linha[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Importação");
  return Buffer.from(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

function criar() {
  mkdirSync(PASTA, { recursive: true });
  for (const n of ESCALAS) {
    const bytes = planilha(gerarLinhas(n));
    const caminho = `${PASTA}/importacao-${n}.xlsx`;
    writeFileSync(caminho, bytes);
    const sha = createHash("sha256").update(bytes).digest("hex");
    console.log(`${caminho.padEnd(38)} ${String(n).padStart(6)} linhas  sha ${sha.slice(0, 12)}`);
  }
}

/* -------------------------------------------------------------- carga -- */

interface Medida {
  escala: number;
  bytes: number;
  leitura: number;
  recepcao: number;
  validacao: number;
  processamento: number;
  total: number;
  blocos: number;
  criados: number;
  atualizados: number;
  recusadas: number;
  conflitos: number;
  entradas: number;
  unidades: number;
}

const agora = () => Date.now();

async function executarEscala(token: string, total: number, local: string | null): Promise<Medida> {
  const t0 = agora();
  const linhas = gerarLinhas(total);
  const bytes = planilha(linhas);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const leitura = agora() - t0;

  const cabecalhos = Object.keys(linhas[0]!);
  const arq = await rpc(token, "import_file_register", {
    _sha: sha,
    _file_name: `importacao-${total}.xlsx`,
    _byte_size: bytes.byteLength,
    _content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    _headers: cabecalhos,
    _row_count: total,
    _column_count: cabecalhos.length,
    _parser: "lardan-xlsx-2",
  });
  const fileId = (arq.body as { id: string }).id;

  const mapa: Record<string, string> = {
    nome: "Nome do produto",
    sku: "SKU",
    codigo_legado: "Código legado",
    ean: "Código de barras",
    categoria: "Categoria",
    colecao: "Coleção",
    fornecedor: "Fornecedor",
    material: "Material",
    banho: "Banho",
    cor: "Cor",
    tamanho: "Tamanho",
    custo: "Valor de custo",
    preco: "Preço de venda",
    quantidade: "Quantidade",
    publicar: "Publicar no site",
  };

  const job = await rpc(token, "import_job_open2", {
    _file: fileId,
    _mode: local ? "entrada" : "catalogo",
    _mapping: mapa,
    _defaults: {},
    _dry_run: false,
    _location_id: local,
    _operation_date: new Date().toISOString().slice(0, 10),
    _reason_code: null,
    _reference: `${PREFIXO}-CARGA-${total}`,
    _template_id: null,
    _template_version: null,
    _simulation_of: null,
    _correction_of: null,
  });
  const jobId = (job.body as { id: string }).id;

  const t1 = agora();
  let blocos = 0;
  for (let i = 0; i < linhas.length; i += 500) {
    await rpc(token, "import_rows_stage", {
      _job: jobId,
      _rows: linhas.slice(i, i + 500).map((raw, k) => ({ n: i + k + 1, raw })),
    });
    blocos += 1;
  }
  await rpc(token, "import_job_seal", { _job: jobId });
  const recepcao = agora() - t1;

  const t2 = agora();
  for (;;) {
    const r = await rpc(token, "import_job_validate", { _job: jobId, _limit: 1000 });
    blocos += 1;
    if ((r.body as { restantes: number }).restantes === 0) break;
  }
  const validacao = agora() - t2;

  const t3 = agora();
  const worker = crypto.randomUUID();
  for (;;) {
    const r = await rpc(token, "import_job_process", { _job: jobId, _limit: 250, _worker: worker });
    blocos += 1;
    if ((r.body as { restantes: number }).restantes === 0) break;
  }
  const processamento = agora() - t3;

  const c = await rpc(token, "import_job_counters", { _job: jobId });
  const ind = c.body as Record<string, number>;

  return {
    escala: total,
    bytes: bytes.byteLength,
    leitura,
    recepcao,
    validacao,
    processamento,
    total: agora() - t0,
    blocos,
    criados: (ind["produtos_criados"] ?? 0) + (ind["variantes_criadas"] ?? 0),
    atualizados: (ind["produtos_atualizados"] ?? 0) + (ind["variantes_atualizadas"] ?? 0),
    recusadas: ind["recusadas"] ?? 0,
    conflitos: ind["conflitos"] ?? 0,
    entradas: ind["entradas"] ?? 0,
    unidades: ind["unidades"] ?? 0,
  };
}

async function carga(escalas: readonly number[]) {
  const conta = await criarConta({ nome: "importacao", papeis: ["master"] });
  if (!conta.token) throw new Error("não consegui autenticar a conta de homologação");
  const locais = await comoUsuario(conta.token, "/locations?select=id&is_active=eq.true&limit=1");
  const local = (locais.body as { id: string }[])[0]?.id ?? null;

  const medidas: Medida[] = [];
  for (const n of escalas) {
    console.log(`\n▶ escala ${n.toLocaleString("pt-BR")} linhas…`);
    medidas.push(await executarEscala(conta.token, n, local));
  }

  const ms = (v: number) => `${(v / 1000).toFixed(1)}s`;
  console.log(
    "\n| Escala | Arquivo | Leitura | Recepção | Validação | Processamento | Total | Criados | Atualizados | Recusadas | Conflitos | Entradas | Unidades |",
  );
  console.log("|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const m of medidas) {
    console.log(
      `| ${m.escala.toLocaleString("pt-BR")} | ${(m.bytes / 1024).toFixed(0)} KB | ${ms(m.leitura)} | ${ms(m.recepcao)} | ${ms(m.validacao)} | ${ms(m.processamento)} | ${ms(m.total)} | ${m.criados} | ${m.atualizados} | ${m.recusadas} | ${m.conflitos} | ${m.entradas} | ${m.unidades} |`,
    );
  }
}

/* ------------------------------------------------------------- limpar -- */

async function limpar() {
  const URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!;
  const SERVICE = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  const del = (path: string) =>
    fetch(`${URL}/rest/v1${path}`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    }).then((r) => r.status);

  await del(`/import_rows?raw->>SKU=like.${PREFIXO}%25`);
  await del(`/import_jobs?reference=like.${PREFIXO}%25`);
  await del(`/import_files?file_name=like.importacao-%25`);
  await del(`/product_variants?sku=like.${PREFIXO}%25`);
  await del(`/products?name=like.${PREFIXO}%25`);
  await del(`/suppliers?name=like.${PREFIXO}%25`);
  console.log("massa de importação removida.");
}

const comando = process.argv[2] ?? "criar";
if (comando === "criar") criar();
else if (comando === "limpar") await limpar();
else if (comando === "carga") await carga(ESCALAS);
else if (comando === "funcional") await carga([100]);
else {
  console.error("uso: criar | limpar | funcional | carga");
  process.exit(1);
}
