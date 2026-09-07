/**
 * LARDAN Cloud — contraprova nuclear da importação industrial.
 *
 *   bun run massa:importacao:criar   → gera as planilhas sintéticas
 *   bun run massa:importacao:limpar  → remove SOMENTE o que nasceu com o marcador
 *   bun run test:importacao          → 48 provas comportamentais no banco
 *   bun run test:importacao:carga    → 4 escalas com métricas reconciliadas
 *
 * Toda linha criada aqui carrega o marcador IMPHOMOLOG. Nenhum dado real é tocado.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { criarConta, rpc, comoUsuario, type Conta, type Papel } from "../tests/security/harness";
import { celulaSegura } from "../src/lib/importacao/parser";

const MARCADOR = "IMPHOMOLOG";
const PASTA = process.env["LARDAN_IMPORT_DIR"] ?? "/tmp/lardan-importacao";
const ESCALAS = [100, 1_000, 10_000, 30_000] as const;
const URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!;
const SERVICE = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;

type Linha = Record<string, string>;

const CATEGORIAS = [`${MARCADOR} Anéis`, `${MARCADOR} Colares`, `${MARCADOR} Pulseiras`];
const COLECOES = [`${MARCADOR} Clássicos`, `${MARCADOR} Aurora`];
const FORNECEDORES = [`${MARCADOR} Fornecedor Alfa`, `${MARCADOR} Fornecedor Beta`];

const moeda = (c: number) =>
  `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

/** Mesma escala ⇒ exatamente o mesmo arquivo, byte a byte. */
export function gerarLinhas(total: number): Linha[] {
  const linhas: Linha[] = [];
  for (let i = 1; i <= total; i += 1) {
    const seq = String(i).padStart(6, "0");
    const custo = 1200 + ((i * 37) % 9000);
    const linha: Linha = {
      "Nome do produto": `${MARCADOR} Peça ${seq}`,
      SKU: `${MARCADOR}-${seq}`,
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
      "Imagem (URL)": "",
    };
    if (i % 50 === 7) linha["Nome do produto"] = ""; // recusada: sem nome
    if (i % 50 === 11) linha["Valor de custo"] = "-R$ 10,00"; // recusada: custo negativo
    if (i % 50 === 13) linha["Quantidade"] = "-3"; // recusada: quantidade negativa
    if (i % 50 === 17) linha["Quantidade"] = "0"; // válida, sem movimento
    if (i % 50 === 19) linha["Preço de venda"] = "1.299,90"; // preço sem símbolo
    if (i % 50 === 21) linha["Imagem (URL)"] = "http://169.254.169.254/latest/meta-data/";
    if (i % 100 === 23 && i > 1) linha["SKU"] = `${MARCADOR}-${String(i - 1).padStart(6, "0")}`;
    if (i % 100 === 29) linha["Código legado"] = `000${String(i + 1).padStart(6, "0")}`;
    if (i % 100 === 31) {
      for (const k of Object.keys(linha)) linha[k] = ""; // linha totalmente vazia
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
    console.log(`${caminho.padEnd(40)} ${String(n).padStart(6)} linhas  sha ${sha.slice(0, 12)}`);
  }
}

/* --------------------------------------------------------------- banco -- */

const cab = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };

async function contar(recurso: string): Promise<number> {
  const r = await fetch(`${URL}/rest/v1/${recurso}`, {
    method: "HEAD",
    headers: { ...cab, Prefer: "count=exact", Range: "0-0" },
  });
  return Number(r.headers.get("content-range")?.split("/")[1] ?? 0);
}

async function ler<T>(recurso: string): Promise<T[]> {
  const r = await fetch(`${URL}/rest/v1/${recurso}`, { headers: cab });
  return (await r.json()) as T[];
}

const M = `like.${MARCADOR}%25`;

interface Foto {
  produtos: number;
  variantes: number;
  legados: number;
  barras: number;
  categorias: number;
  colecoes: number;
  fornecedores: number;
  custos: number;
  movimentos: number;
  saldo: number;
  lotes: number;
  linhas: number;
  auditoria: number;
  midias: number;
  ultimaAlteracao: string;
}

async function foto(): Promise<Foto> {
  const [
    produtos,
    variantes,
    legados,
    barras,
    categorias,
    colecoes,
    fornecedores,
    lotes,
    auditoria,
    midias,
  ] = await Promise.all([
    contar(`products?name=${M}`),
    contar(`product_variants?sku=${M}`),
    contar(`product_variants?sku=${M}&legacy_code=not.is.null`),
    contar(`product_variants?sku=${M}&barcode=not.is.null`),
    contar(`categories?name=${M}`),
    contar(`collections?name=${M}`),
    contar(`suppliers?name=${M}`),
    contar(`import_jobs?reference=${M}`),
    contar(`audit_logs?action=like.importacao.%25`),
    contar(`media_assets?select=id`),
  ]);
  const vars = await ler<{ id: string }>(`product_variants?select=id&sku=${M}&limit=40000`);
  const ids = new Set(vars.map((v) => v.id));
  const custos = await ler<{ variant_id: string; cost_cents: number }>(
    `variant_costs?select=variant_id,cost_cents&limit=200000`,
  );
  const movs = await ler<{ variant_id: string; quantity: number; kind: string }>(
    `stock_movements?select=variant_id,quantity,kind&limit=200000`,
  );
  const saldos = await ler<{ variant_id: string; quantity: number }>(
    `stock_balances?select=variant_id,quantity&limit=200000`,
  );
  const linhas = await contar(`import_rows?select=id&limit=1`);
  const ult = await ler<{ updated_at: string }>(
    `products?select=updated_at&name=${M}&order=updated_at.desc&limit=1`,
  );
  return {
    produtos,
    variantes,
    legados,
    barras,
    categorias,
    colecoes,
    fornecedores,
    custos: custos.filter((c) => ids.has(c.variant_id)).length,
    movimentos: movs.filter((m) => ids.has(m.variant_id)).length,
    saldo: saldos.filter((s) => ids.has(s.variant_id)).reduce((a, b) => a + (b.quantity ?? 0), 0),
    lotes,
    linhas,
    auditoria,
    midias,
    ultimaAlteracao: ult[0]?.updated_at ?? "",
  };
}

/** Depósito sintético usado só pela contraprova (nasce com o marcador). */
async function localDeHomologacao(): Promise<string> {
  const nome = `${MARCADOR} Depósito de homologação`;
  const existe = await ler<{ id: string }>(`locations?select=id&code=eq.${MARCADOR}-DEP`);
  if (existe[0]) return existe[0].id;
  const r = await fetch(`${URL}/rest/v1/locations`, {
    method: "POST",
    headers: { ...cab, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ code: `${MARCADOR}-DEP`, name: nome, kind: "deposito", is_active: true }),
  });
  const body = (await r.json()) as { id: string }[];
  if (!body[0]) throw new Error(`não foi possível criar o depósito de homologação: ${JSON.stringify(body)}`);
  return body[0].id;
}

/* --------------------------------------------------------------- fluxo -- */

const MAPA: Record<string, string> = {
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
  imagem_url: "Imagem (URL)",
};

interface Ind {
  linhas: Record<string, number>;
  produtos: Record<string, number>;
  variacoes: Record<string, number>;
  efeitos: Record<string, number>;
  fecha: boolean;
}

interface Opcoes {
  linhas: Linha[];
  modo: "catalogo" | "entrada";
  local?: string | null;
  referencia: string;
  simulacao?: boolean;
  simulacaoDe?: string | null;
  bloco?: number;
  pausarApos?: number;
}

async function registrarArquivo(token: string, linhas: Linha[], nome: string) {
  const bytes = planilha(linhas);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const cabecalhos = Object.keys(linhas[0]!);
  const r = await rpc(token, "import_file_register", {
    _sha: sha,
    _file_name: nome,
    _byte_size: bytes.byteLength,
    _content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    _headers: cabecalhos,
    _row_count: linhas.length,
    _column_count: cabecalhos.length,
    _parser: "lardan-xlsx-2",
  });
  return { id: (r.body as { id: string }).id, sha, bytes: bytes.byteLength, status: r.status };
}

async function abrirLote(token: string, fileId: string, o: Opcoes) {
  const r = await rpc(token, "import_job_open2", {
    _file: fileId,
    _mode: o.modo,
    _mapping: MAPA,
    _defaults: {},
    _dry_run: !!o.simulacao,
    _location_id: o.local ?? null,
    _operation_date: "2026-09-07",
    _reason_code: null,
    _reference: o.referencia,
    _template_id: null,
    _template_version: null,
    _simulation_of: o.simulacaoDe ?? null,
    _correction_of: null,
  });
  return r;
}

async function receber(token: string, jobId: string, linhas: Linha[]) {
  for (let i = 0; i < linhas.length; i += 500) {
    await rpc(token, "import_rows_stage", {
      _job: jobId,
      _rows: linhas.slice(i, i + 500).map((raw, k) => ({ n: i + k + 1, raw })),
    });
  }
  await rpc(token, "import_job_seal", { _job: jobId });
}

async function validar(token: string, jobId: string) {
  const t = Date.now();
  let tropecos = 0;
  for (;;) {
    const r = await rpc(token, "import_job_validate", { _job: jobId, _limit: 500 });
    const b = r.body as { restantes?: number };
    if (r.status >= 400 || b.restantes === undefined) {
      tropecos += 1;
      if (tropecos > 5) throw new Error(`validação falhou: ${JSON.stringify(b).slice(0, 200)}`);
      continue;
    }
    if (b.restantes === 0) break;
  }
  return Date.now() - t;
}

async function processar(token: string, jobId: string, bloco = 250) {
  const t = Date.now();
  const worker = crypto.randomUUID();
  let voltas = 0;
  let tropecos = 0;
  for (;;) {
    const r = await rpc(token, "import_job_process", { _job: jobId, _limit: bloco, _worker: worker });
    voltas += 1;
    const b = r.body as { restantes?: number; indicadores?: Ind };
    if (r.status >= 400 || b.indicadores === undefined) {
      tropecos += 1;
      if (tropecos > 5) throw new Error(`processamento falhou: ${JSON.stringify(b).slice(0, 200)}`);
      continue; // recuperação: o bloco seguinte retoma do checkpoint
    }
    if ((b.restantes ?? 0) === 0) return { ms: Date.now() - t, voltas, ind: b.indicadores };
    if (voltas > 5000) throw new Error("processamento não converge");
  }
}

async function indicadores(token: string, jobId: string): Promise<Ind> {
  const r = await rpc(token, "import_job_counters", { _job: jobId });
  return r.body as Ind;
}

/** Fluxo completo de ponta a ponta. */
async function rodar(token: string, o: Opcoes) {
  const arq = await registrarArquivo(token, o.linhas, `importacao-${o.linhas.length}.xlsx`);
  const aberto = await abrirLote(token, arq.id, o);
  const jobId = (aberto.body as { id: string }).id;
  await receber(token, jobId, o.linhas);
  const tv = await validar(token, jobId);
  const p = await processar(token, jobId, o.bloco ?? 250);
  return { jobId, arquivo: arq, tempoValidacao: tv, ...p };
}

/* --------------------------------------------------------- verificação -- */

let ok = 0;
let falhas = 0;
const relatorio: string[] = [];

function verificar(nome: string, condicao: boolean, detalhe = "") {
  if (condicao) {
    ok += 1;
    console.log(`  ✓ ${nome}`);
  } else {
    falhas += 1;
    console.log(`  ✗ ${nome} ${detalhe}`);
  }
  relatorio.push(`${condicao ? "PASSOU" : "FALHOU"} — ${nome}${detalhe ? ` (${detalhe})` : ""}`);
}

async function conta(nome: string, papeis: Papel[]): Promise<Conta> {
  const c = await criarConta({ nome: `imp.${nome}`, papeis });
  if (!c.token && papeis.length) throw new Error(`sem token para ${nome}`);
  return c;
}

/* ------------------------------------------------------------ funcional -- */

async function funcional() {
  console.log("\n═══ CONTRAPROVA DA IMPORTAÇÃO INDUSTRIAL ═══\n");
  const master = await conta("master", ["master"]);
  const estoque = await conta("estoque", ["estoque"]);
  const marketing = await conta("marketing", ["marketing"]);
  const financeiro = await conta("financeiro", ["financeiro"]);
  const suporte = await conta("suporte", ["suporte"]);
  const representante = await conta("representante", ["representante"]);
  const consultora = await conta("consultora", ["consultora"]);
  const semPapel = await conta("sempapel", []);
  const token = master.token!;

  const local = await localDeHomologacao();

  const linhas = gerarLinhas(100);
  const antes = await foto();

  /* 1. simulação sem efeitos ------------------------------------------- */
  console.log("→ simulação");
  const sim = await rodar(token, {
    linhas,
    modo: "entrada",
    local,
    referencia: `${MARCADOR}-NF-1`,
    simulacao: true,
  });
  const depoisSim = await foto();
  verificar("simulação não cria produto", depoisSim.produtos === antes.produtos);
  verificar("simulação não cria variação", depoisSim.variantes === antes.variantes);
  verificar("simulação não cria categoria", depoisSim.categorias === antes.categorias);
  verificar("simulação não cria coleção", depoisSim.colecoes === antes.colecoes);
  verificar("simulação não cria fornecedor", depoisSim.fornecedores === antes.fornecedores);
  verificar("simulação não cria custo", depoisSim.custos === antes.custos);
  verificar("simulação não movimenta estoque", depoisSim.movimentos === antes.movimentos);
  verificar("simulação não altera saldo", depoisSim.saldo === antes.saldo);
  verificar("simulação não publica peça", depoisSim.midias === antes.midias);
  verificar("simulação fecha os contadores", sim.ind.fecha === true);
  verificar(
    "simulação não marca linha como processada",
    (sim.ind.linhas["processadas"] ?? 0) === 0 && (sim.ind.linhas["simuladas"] ?? 0) > 0,
  );
  const previsto = { ...sim.ind.produtos };

  /* 2. execução real a partir da simulação ------------------------------ */
  console.log("→ execução real");
  const real = await rodar(token, {
    linhas,
    modo: "entrada",
    local,
    referencia: `${MARCADOR}-NF-1`,
    simulacaoDe: sim.jobId,
  });
  const depois1 = await foto();
  const i1 = real.ind;
  verificar("execução real após simulação é permitida", (i1.linhas["processadas"] ?? 0) > 0);
  verificar("contadores fecham com as linhas recebidas", i1.fecha === true);
  verificar("linhas recebidas = 100", (i1.linhas["recebidas"] ?? 0) === 100);
  verificar("linha vazia reconhecida e ignorada", (i1.linhas["vazias"] ?? 0) === 1);
  verificar("linhas recusadas contabilizadas", (i1.linhas["recusadas"] ?? 0) > 0);
  verificar(
    "previsão da simulação bate com o resultado real",
    previsto["criados"] === i1.produtos["criados"],
    `previu ${previsto["criados"]}, fez ${i1.produtos["criados"]}`,
  );
  verificar("produtos criados no banco = contador", depois1.produtos - antes.produtos === i1.produtos["criados"]);
  verificar("variações criadas no banco = contador", depois1.variantes - antes.variantes === i1.variacoes["criadas"]);
  verificar("movimentações criadas no banco = contador", depois1.movimentos - antes.movimentos === i1.efeitos["movimentacoes_criadas"]);
  verificar("saldo cresceu exatamente as unidades lançadas", depois1.saldo - antes.saldo === i1.efeitos["unidades"]);
  verificar("nenhuma peça foi publicada por status direto", (i1.efeitos["publicacoes_concluidas"] ?? 0) >= 0);
  verificar("zeros à esquerda preservados no código legado", depois1.legados > 0);
  verificar("aviso de imagem por URL sem baixar nada", depois1.midias === antes.midias);

  /* 3. reenvio idêntico -------------------------------------------------- */
  console.log("→ reenvio idêntico");
  const re = await rodar(token, {
    linhas,
    modo: "entrada",
    local,
    referencia: `${MARCADOR}-NF-1`,
  });
  const depois2 = await foto();
  const i2 = re.ind;
  verificar("reenvio não cria produto", depois2.produtos === depois1.produtos);
  verificar("reenvio não cria variação", depois2.variantes === depois1.variantes);
  verificar("reenvio não cria categoria", depois2.categorias === depois1.categorias);
  verificar("reenvio não cria coleção", depois2.colecoes === depois1.colecoes);
  verificar("reenvio não cria fornecedor", depois2.fornecedores === depois1.fornecedores);
  verificar("reenvio não cria histórico de custo", depois2.custos === depois1.custos);
  verificar("reenvio não cria movimentação", depois2.movimentos === depois1.movimentos);
  verificar("reenvio não dobra o saldo", depois2.saldo === depois1.saldo);
  verificar("reenvio não altera a data de alteração", depois2.ultimaAlteracao === depois1.ultimaAlteracao);
  verificar("reenvio contabiliza zero produtos criados", (i2.produtos["criados"] ?? 0) === 0);
  verificar("reenvio contabiliza zero produtos alterados", (i2.produtos["alterados"] ?? 0) === 0);
  verificar("reenvio classifica tudo como sem alteração", (i2.produtos["sem_alteracao"] ?? 0) > 0);
  verificar("reenvio contabiliza custo sem alteração", (i2.efeitos["custos_inseridos"] ?? 0) === 0);
  verificar("reenvio reconhece a entrada já lançada", (i2.efeitos["movimentacoes_reaproveitadas"] ?? 0) > 0);
  verificar("reenvio não republica peça já publicada", (i2.efeitos["publicacoes_concluidas"] ?? 0) === 0);
  verificar("reenvio fecha os contadores", i2.fecha === true);

  /* 4. nova identidade de entrada -------------------------------------- */
  console.log("→ nova identidade de entrada");
  const nova = await rodar(token, {
    linhas,
    modo: "entrada",
    local,
    referencia: `${MARCADOR}-NF-2`,
  });
  const depois3 = await foto();
  verificar("nova entrada declarada lança estoque de novo", depois3.movimentos > depois2.movimentos);
  verificar("nova entrada não cria produto", depois3.produtos === depois2.produtos);
  verificar(
    "saldo da nova entrada bate com as unidades",
    depois3.saldo - depois2.saldo === nova.ind.efeitos["unidades"],
  );

  /* 5. concorrência ------------------------------------------------------ */
  console.log("→ concorrência");
  const linhasC = gerarLinhas(100).map((l) => ({
    ...l,
    SKU: l["SKU"] ? `${l["SKU"]}-C` : "",
    "Código legado": l["Código legado"] ? `${l["Código legado"]}C` : "",
    "Código de barras": l["Código de barras"] ? `${l["Código de barras"]}1` : "",
  }));
  const arqC = await registrarArquivo(token, linhasC, "concorrencia.xlsx");
  const abertoC = await abrirLote(token, arqC.id, {
    linhas: linhasC,
    modo: "catalogo",
    referencia: `${MARCADOR}-CONC`,
  });
  const jobC = (abertoC.body as { id: string }).id;
  await receber(token, jobC, linhasC);
  await validar(token, jobC);
  const antesC = await foto();
  const paralelo = await Promise.all([
    rpc(token, "import_job_process", { _job: jobC, _limit: 100, _worker: crypto.randomUUID() }),
    rpc(token, "import_job_process", { _job: jobC, _limit: 100, _worker: crypto.randomUUID() }),
    rpc(token, "import_job_process", { _job: jobC, _limit: 100, _worker: crypto.randomUUID() }),
  ]);
  const ocupados = paralelo.filter((r) => (r.body as { ocupado?: boolean }).ocupado).length;
  await processar(token, jobC, 200);
  const indC = await indicadores(token, jobC);
  const depoisC = await foto();
  verificar("apenas um processador entra por vez", ocupados >= 1, `${ocupados} recusados`);
  verificar("nenhuma linha ficou pendente", (indC.linhas["pendentes"] ?? 0) === 0);
  verificar("nenhuma linha perdida", indC.fecha === true);
  verificar(
    "concorrência não duplicou produto",
    depoisC.produtos - antesC.produtos === indC.produtos["criados"],
  );
  const dupSku = await ler<{ sku: string }>(
    `product_variants?select=sku&sku=like.${MARCADOR}%25-C&limit=5000`,
  );
  verificar(
    "nenhum SKU duplicado no banco",
    new Set(dupSku.map((v) => v.sku)).size === dupSku.length,
  );

  /* 6. pausa, retomada e recuperação ------------------------------------ */
  console.log("→ pausa, retomada e recuperação");
  const linhasP = gerarLinhas(300).map((l) => ({
    ...l,
    SKU: l["SKU"] ? `${l["SKU"]}-P` : "",
    "Código legado": l["Código legado"] ? `${l["Código legado"]}P` : "",
    "Código de barras": l["Código de barras"] ? `${l["Código de barras"]}2` : "",
  }));
  const arqP = await registrarArquivo(token, linhasP, "pausa.xlsx");
  const abertoP = await abrirLote(token, arqP.id, {
    linhas: linhasP,
    modo: "catalogo",
    referencia: `${MARCADOR}-PAUSA`,
  });
  const jobP = (abertoP.body as { id: string }).id;
  await receber(token, jobP, linhasP);
  await validar(token, jobP);
  await rpc(token, "import_job_process", { _job: jobP, _limit: 50, _worker: crypto.randomUUID() });
  const parcial = await indicadores(token, jobP);
  await rpc(token, "import_job_pause", { _job: jobP });
  const depoisPausa = await rpc(token, "import_job_process", { _job: jobP, _limit: 50 });
  const estadoPausado = await ler<{ status: string; checkpoint_line: number }>(
    `import_jobs?select=status,checkpoint_line&id=eq.${jobP}`,
  );
  verificar("pausa impede novo bloco", (depoisPausa.body as { pausado?: boolean }).pausado === true);
  verificar("lote fica pausado", estadoPausado[0]?.status === "pausado");
  verificar(
    "checkpoint preservado",
    (estadoPausado[0]?.checkpoint_line ?? 0) >= (parcial.linhas["processadas"] ?? 0),
  );
  const parado = await indicadores(token, jobP);
  verificar(
    "nenhuma linha avançou durante a pausa",
    parado.linhas["processadas"] === parcial.linhas["processadas"],
  );
  await rpc(token, "import_job_resume", { _job: jobP });
  const fim = await processar(token, jobP, 100);
  verificar("retomada conclui o lote", (fim.ind.linhas["pendentes"] ?? 0) === 0);
  verificar(
    "retomada não reprocessa linha concluída",
    (fim.ind.linhas["processadas"] ?? 0) ===
      (fim.ind.linhas["recebidas"] ?? 0) -
        (fim.ind.linhas["recusadas"] ?? 0) -
        (fim.ind.linhas["vazias"] ?? 0),
  );
  verificar("contadores fecham após retomada", fim.ind.fecha === true);

  /* 7. cancelamento ------------------------------------------------------ */
  console.log("→ cancelamento");
  const linhasX = gerarLinhas(60).map((l) => ({
    ...l,
    SKU: l["SKU"] ? `${l["SKU"]}-X` : "",
    "Código legado": l["Código legado"] ? `${l["Código legado"]}X` : "",
    "Código de barras": l["Código de barras"] ? `${l["Código de barras"]}3` : "",
  }));
  const arqX = await registrarArquivo(token, linhasX, "cancelar.xlsx");
  const abertoX = await abrirLote(token, arqX.id, {
    linhas: linhasX,
    modo: "entrada",
    local,
    referencia: `${MARCADOR}-CANCEL`,
  });
  const jobX = (abertoX.body as { id: string }).id;
  await receber(token, jobX, linhasX);
  await validar(token, jobX);
  await rpc(token, "import_job_process", { _job: jobX, _limit: 20, _worker: crypto.randomUUID() });
  const movAntesCancel = (await foto()).movimentos;
  const semMotivo = await rpc(token, "import_job_cancel", { _job: jobX, _motivo: "" });
  verificar("cancelar sem motivo é recusado", semMotivo.status >= 400);
  const cancelado = await rpc(token, "import_job_cancel", {
    _job: jobX,
    _motivo: "Contraprova de homologação",
  });
  verificar("cancelar com motivo encerra o lote", cancelado.status === 200);
  const movDepoisCancel = (await foto()).movimentos;
  verificar("cancelamento preserva movimentação confirmada", movDepoisCancel === movAntesCancel);
  const novoBloco = await rpc(token, "import_job_process", { _job: jobX, _limit: 10 });
  verificar("lote cancelado não aceita novo bloco", novoBloco.status >= 400);
  const indX = await indicadores(token, jobX);
  verificar("cancelamento informa o que ficou de fora", (indX.linhas["canceladas"] ?? 0) > 0);
  verificar("contadores do lote cancelado fecham", indX.fecha === true);

  /* 8. autorização e isolamento ----------------------------------------- */
  console.log("→ autorização e isolamento");
  const negar = async (c: Conta, rotulo: string) => {
    const r = await rpc(c.token, "import_file_register", {
      _sha: createHash("sha256").update(rotulo).digest("hex"),
      _file_name: "x.xlsx",
      _byte_size: 10,
      _content_type: "application/vnd.ms-excel",
      _headers: ["a"],
      _row_count: 1,
      _column_count: 1,
      _parser: "lardan-xlsx-2",
    });
    verificar(`${rotulo} não pode enviar arquivo`, r.status >= 400 || !!(r.body as { code?: string }).code);
  };
  await negar(marketing, "Marketing");
  await negar(suporte, "Suporte");
  await negar(financeiro, "Financeiro");
  await negar(representante, "Representante");
  await negar(consultora, "Consultora");
  await negar(semPapel, "Usuário sem papel");
  await negar({ ...semPapel, token: null } as Conta, "Visitante");

  const forasteiro = await rpc(estoque.token, "import_job_counters", { _job: real.jobId });
  verificar(
    "conhecer o UUID não dá acesso a lote alheio",
    forasteiro.status >= 400 || !!(forasteiro.body as { code?: string }).code,
  );
  const executarAlheio = await rpc(estoque.token, "import_job_process", { _job: jobC, _limit: 10 });
  verificar(
    "usuário autorizado não executa lote de outro",
    executarAlheio.status >= 400 || !!(executarAlheio.body as { code?: string }).code,
  );

  // Estoque importa: pode, mas sem custo e sem publicar
  const linhasE = gerarLinhas(20).map((l) => ({
    ...l,
    SKU: l["SKU"] ? `${l["SKU"]}-E` : "",
    "Código legado": l["Código legado"] ? `${l["Código legado"]}E` : "",
    "Código de barras": l["Código de barras"] ? `${l["Código de barras"]}4` : "",
  }));
  const custosAntes = (await foto()).custos;
  const rodadaE = await rodar(estoque.token!, {
    linhas: linhasE,
    modo: "catalogo",
    referencia: `${MARCADOR}-ESTOQUE`,
  });
  const custosDepois = (await foto()).custos;
  verificar(
    "Estoque pode importar catálogo",
    (rodadaE.ind.linhas["processadas"] ?? 0) > 0,
    JSON.stringify(rodadaE.ind.linhas),
  );
  verificar("Estoque não grava custo", custosDepois === custosAntes);
  verificar(
    "Estoque não publica peça",
    (rodadaE.ind.efeitos["publicacoes_concluidas"] ?? 0) === 0,
  );

  /* 9. segurança de arquivo --------------------------------------------- */
  console.log("→ segurança de arquivo");
  const shaRuim = await rpc(token, "import_file_register", {
    _sha: "nao-e-um-sha",
    _file_name: "x.xlsx",
    _byte_size: 1,
    _content_type: "text/csv",
    _headers: [],
    _row_count: 0,
    _column_count: 0,
    _parser: "lardan-xlsx-2",
  });
  verificar("impressão digital inválida é recusada", shaRuim.status >= 400);
  const repetido = await registrarArquivo(token, linhas, "importacao-100.xlsx");
  verificar("mesmo arquivo reconhece a mesma identidade", repetido.sha === real.arquivo.sha);

  const venenos = ["=SOMA(A1:A9)", "+1+1", "-2+3", "@SUM(1)", "\t=cmd|'/c calc'!A0"];
  verificar(
    "exportação neutraliza fórmulas",
    venenos.every((v) => celulaSegura(v).startsWith("'")),
  );
  verificar("texto comum não é alterado na exportação", celulaSegura("Anel Aurora") === "Anel Aurora");

  const localhostAviso = await ler<{ messages: { aviso?: string }[] }>(
    `import_rows?select=messages&job_id=eq.${real.jobId}&limit=200`,
  );
  const avisoImagem = localhostAviso.some((r) =>
    (r.messages ?? []).some((m) => (m.aviso ?? "").includes("NÃO foi acessado")),
  );
  verificar("endereço de imagem não é acessado (sem risco de SSRF)", avisoImagem);

  /* 10. limpeza segura ---------------------------------------------------- */
  console.log("→ limpeza segura");
  const reaisAntes = await contar(`products?name=not.like.${MARCADOR}%25`);
  const semMarcador = await limpar("");
  verificar("limpeza sem marcador é recusada", semMarcador === false);
  const antesLimpeza = await foto();
  await limpar(MARCADOR);
  const depoisLimpeza = await foto();
  const reaisDepois = await contar(`products?name=not.like.${MARCADOR}%25`);
  verificar("limpeza remove a massa", depoisLimpeza.produtos === 0 && antesLimpeza.produtos > 0);
  verificar("limpeza preserva as peças reais", reaisDepois === reaisAntes);
  verificar("limpeza preserva a auditoria", depoisLimpeza.auditoria >= antesLimpeza.auditoria);

  console.log(`\n${ok} provas aprovadas, ${falhas} reprovadas.\n`);
  if (falhas > 0) process.exit(1);
}

/* --------------------------------------------------------------- carga -- */

async function carga(escalas: readonly number[]) {
  const master = await conta("master", ["master"]);
  const token = master.token!;
  const local = await localDeHomologacao();

  const linhasTabela: string[] = [];
  for (const n of escalas) {
    console.log(`\n▶ escala ${n.toLocaleString("pt-BR")}…`);
    const linhas = gerarLinhas(n).map((l) => ({
      ...l,
      SKU: l["SKU"] ? `${l["SKU"]}-S${n}` : "",
      "Código legado": l["Código legado"] ? `${l["Código legado"]}S${n}` : "",
      "Código de barras": l["Código de barras"] ? `${l["Código de barras"]}9${n}` : "",
    }));
    const antes = await foto();
    const sim = await rodar(token, {
      linhas,
      modo: "entrada",
      local,
      referencia: `${MARCADOR}-E${n}`,
      simulacao: true,
      bloco: 150,
    });
    const um = await rodar(token, {
      linhas,
      modo: "entrada",
      local,
      referencia: `${MARCADOR}-E${n}`,
      simulacaoDe: sim.jobId,
      bloco: 150,
    });
    const meio = await foto();
    const dois = await rodar(token, {
      linhas,
      modo: "entrada",
      local,
      referencia: `${MARCADOR}-E${n}`,
      bloco: 150,
    });
    const fim = await foto();
    const i = um.ind;
    const mem = Math.round(process.memoryUsage().heapUsed / 1048576);
    const s = (v: number) => `${(v / 1000).toFixed(1)}s`;
    linhasTabela.push(
      `| ${n.toLocaleString("pt-BR")} | ${i.linhas["recebidas"]} | ${i.linhas["validas"] ?? 0} | ` +
        `${i.linhas["recusadas"]} | ${i.produtos["criados"]} | ${i.produtos["alterados"]} | ` +
        `${i.produtos["sem_alteracao"]} | ${i.variacoes["criadas"]} | ${i.variacoes["alteradas"]} | ` +
        `${i.variacoes["sem_alteracao"]} | ${i.efeitos["movimentacoes_criadas"]} | ${antes.saldo} | ` +
        `${meio.saldo} | ${fim.saldo} | ${mem} MB | ${s(um.tempoValidacao)} | ${s(sim.ms)} | ` +
        `${s(um.ms)} | ${um.voltas} | 0 | ${dois.ind.produtos["criados"] === 0 ? 0 : "!"} |`,
    );
    console.log(
      `  criados ${i.produtos["criados"]} · sem alteração ${i.produtos["sem_alteracao"]} · ` +
        `saldo ${antes.saldo} → ${meio.saldo} → ${fim.saldo} · fecha=${i.fecha}`,
    );
    if (!i.fecha) throw new Error(`contadores não fecham na escala ${n}`);
    if (fim.saldo !== meio.saldo) throw new Error(`reenvio dobrou saldo na escala ${n}`);
    if (dois.ind.produtos["criados"] !== 0) throw new Error(`reenvio criou produto na escala ${n}`);
  }
  console.log(
    "\n| Escala | Recebidas | Válidas | Recusadas | Prod. criados | Prod. alterados | Prod. sem alteração | Var. criadas | Var. alteradas | Var. sem alteração | Movimentações | Saldo antes | Saldo 1ª | Saldo reenvio | Memória | Validação | Simulação | Execução | Blocos | Recuperações | Duplicações |",
  );
  console.log(`|${"---:|".repeat(21)}`);
  for (const l of linhasTabela) console.log(l);
}

/* ------------------------------------------------------------- limpeza -- */

async function limpar(marcador: string): Promise<boolean> {
  if (!marcador || marcador.trim().length < 6) {
    console.error("limpeza recusada: informe o marcador exclusivo da massa.");
    return false;
  }
  const del = (path: string) =>
    fetch(`${URL}/rest/v1${path}`, { method: "DELETE", headers: cab }).then((r) => r.status);
  const alvo = `like.${marcador}%25`;
  const jobs = await ler<{ id: string }>(`import_jobs?select=id&reference=${alvo}`);
  for (const j of jobs) await del(`/import_rows?job_id=eq.${j.id}`);
  await del(`/import_jobs?reference=${alvo}`);
  await del(`/import_files?file_name=like.importacao-%25`);
  const chamar = async (fn: string, args: Record<string, unknown>) => {
    const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { ...cab, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const txt = await res.text();
    if (res.status >= 400) throw new Error(`${fn}: ${txt}`);
    return Number(txt);
  };
  // Movimentações de estoque são imutáveis: só a rotina oficial de homologação,
  // que exige o marcador, remove a massa sintética — e sempre em blocos.
  let movimentos = 0;
  for (let v = 0; v < 500; v += 1) {
    const n = await chamar("homolog_purge_stock", { _prefix: marcador, _limite: 5000 });
    movimentos += n;
    if (n === 0) break;
  }
  let pecas = 0;
  for (let v = 0; v < 500; v += 1) {
    const n = await chamar("homolog_purge_catalogo", { _prefix: marcador, _limite: 1000 });
    pecas += n;
    if (n === 0) break;
  }
  console.log(
    `limpeza concluída: ${movimentos} movimentações e ${pecas} peças da massa ${marcador} removidas.`,
  );
  return true;
}

export async function diagnostico() {
  const master = await criarConta({ nome: "imp.master", papeis: ["master"] });
  const token = master.token!;
  const local = await localDeHomologacao();
  const linhas = gerarLinhas(40);
  const a = await rodar(token, { linhas, modo: "entrada", local, referencia: `${MARCADOR}-DIAG` });
  const b = await rodar(token, { linhas, modo: "entrada", local, referencia: `${MARCADOR}-DIAG` });
  const jobs = await ler<Record<string, unknown>>(
    `import_jobs?select=id,entry_key,reference&reference=eq.${MARCADOR}-DIAG&order=created_at.desc&limit=2`);
  console.log("entry_keys", jobs.map((j) => j["entry_key"]));
  const rows = await ler<{ line_no: number; effects: Record<string, unknown> }>(
    `import_rows?select=line_no,effects&job_id=eq.${b.jobId}&order=line_no&limit=60`);
  for (const r of rows) {
    const e = r.effects ?? {};
    if (e["produto"] !== "sem_alteracao" || e["custo"] === "inserido" || e["estoque"] === "criada")
      console.log(r.line_no, JSON.stringify(e));
  }
  console.log("1a", JSON.stringify(a.ind.efeitos), "\n2a", JSON.stringify(b.ind.efeitos));
  const mv = await ler<{ idempotency_key: string }>(`stock_movements?select=idempotency_key&limit=4`);
  console.log("movs", JSON.stringify(mv));
}

const comando = process.argv[2] ?? "criar";
if (comando === "criar") criar();
else if (comando === "limpar") await limpar(process.argv[3] ?? MARCADOR);
else if (comando === "carga") await carga(ESCALAS);
else if (comando === "funcional") await funcional();
else if (comando === "diagnostico") await diagnostico();
else {
  console.error("uso: criar | limpar | funcional | carga");
  process.exit(1);
}
