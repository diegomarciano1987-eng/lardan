/**
 * Matriz de homologação de permissões — roda contra o banco real com contas
 * sintéticas (@lardan.test). Cada perfil é testado individualmente em cada
 * cenário; a saída nomeia perfil e cenário, e não apenas o total aprovado.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarConta, criarPartySintetica, limpar, rpc, type Conta } from "./harness";

const T = 90_000;

/** Perfis testados individualmente, além de sem-papel, inativo e visitante. */
const PERFIS = [
  "master",
  "diretoria",
  "financeiro",
  "estoque",
  "marketing",
  "suporte",
  "representante",
  "consultora",
] as const;

const contas: Record<string, Conta> = {};

/** Verdade única de permissões sensíveis (espelha role_capabilities). */
const VERDADE = {
  custo: ["master", "diretoria", "financeiro"],
  documento: ["master", "diretoria", "financeiro"],
  redeIdentidade: ["master", "diretoria"],
  /** Escopo esperado na Inteligência da Rede; ausente = acesso negado. */
  redeEscopo: {
    master: "nacional",
    diretoria: "nacional",
    marketing: "agregado",
    representante: "representante",
    consultora: "proprio",
  } as Record<string, string | undefined>,

  estoqueVer: ["master", "diretoria", "financeiro", "estoque", "suporte"],
  publicar: ["master", "diretoria", "marketing"],
  importar: ["master", "diretoria", "estoque"],
  auditoria: ["master", "diretoria"],
  exportarRede: ["master", "diretoria"],
  financeiroDados: ["master", "diretoria", "financeiro"],
} as const;

/** Relatório legível: perfil × cenário × resultado. */
const relatorio: { perfil: string; cenario: string; esperado: string; obtido: string }[] = [];
function registrar(perfil: string, cenario: string, esperado: string, obtido: string) {
  relatorio.push({ perfil, cenario, esperado, obtido });
}

const capsDe = new Map<string, string[]>();

beforeAll(async () => {
  for (const papel of PERFIS) {
    contas[papel] = await criarConta({
      nome: papel,
      papeis: [papel],
      comParty: papel === "representante" || papel === "consultora",
    });
  }
  contas["representante_sem_party"] = await criarConta({
    nome: "rep-sem-party",
    papeis: ["representante"],
  });
  contas["sem_papel"] = await criarConta({ nome: "sem-papel", papeis: [] });
  contas["inativo"] = await criarConta({ nome: "inativo", papeis: ["master"], ativo: false });
  contas["duplo"] = await criarConta({ nome: "duplo", papeis: ["marketing", "financeiro"] });

  for (const [nome, conta] of Object.entries(contas)) {
    const r = await rpc(conta.token, "my_capabilities", {});
    const caps = Array.isArray(r.body)
      ? (r.body as unknown[]).map((c) =>
          typeof c === "string" ? c : String((c as Record<string, unknown>)["capability"] ?? c),
        )
      : [];
    capsDe.set(nome, caps);
  }
}, 300_000);

afterAll(async () => {
  const linhas = relatorio.map(
    (l) => `  ${l.perfil.padEnd(22)} | ${l.cenario.padEnd(34)} | ${l.obtido}`,
  );
  console.log(
    `\nMATRIZ DE SEGURANÇA — ${relatorio.length} cenários\n  ${"PERFIL".padEnd(22)} | ${"CENÁRIO".padEnd(34)} | RESULTADO\n${linhas.join("\n")}\n`,
  );
  await limpar();
}, 180_000);

/* ------------------------------------------------------- leitura direta --- */

describe("leitura direta pela Data API", () => {
  for (const tabela of ["stock_movements", "variant_costs"] as const) {
    it(
      `${tabela} fechada para todos os perfis, sem papel, inativo e visitante`,
      async () => {
        const alvos: [string, string | null][] = [
          ...Object.entries(contas).map(([n, c]) => [n, c.token] as [string, string | null]),
          ["visitante", null],
        ];
        for (const [nome, token] of alvos) {
          const r = await comoUsuario(token, `/${tabela}?select=id&limit=1`);
          const vazio = Array.isArray(r.body) && r.body.length === 0;
          const ok = r.status >= 400 || vazio;
          registrar(nome, `leitura direta ${tabela}`, "bloqueada/vazia", ok ? "OK" : `VAZOU ${r.status}`);
          expect(ok, `${nome} leu ${tabela} (${r.status})`).toBe(true);
        }
      },
      T,
    );
  }

  it(
    "parties/suppliers/business_entities: nenhum perfil lê o documento completo direto da tabela",
    async () => {
      const alvos: [string, string | null][] = [
        ...Object.entries(contas).map(([n, c]) => [n, c.token] as [string, string | null]),
        ["visitante", null],
      ];
      const colunas: [string, string][] = [
        ["parties", "doc"],
        ["parties", "doc_canon"],
        ["parties", "doc_digits"],
        ["suppliers", "tax_id"],
        ["business_entities", "tax_id"],
      ];
      for (const [nome, token] of alvos) {
        for (const [tabela, coluna] of colunas) {
          const r = await comoUsuario(token, `/${tabela}?select=${coluna}&limit=1`);
          const vazio = Array.isArray(r.body) && r.body.length === 0;
          const ok = r.status >= 400 || vazio;
          registrar(nome, `${tabela}.${coluna} direto`, "negada", ok ? "OK" : `VAZOU ${r.status}`);
          expect(ok, `${nome} leu ${tabela}.${coluna} (${r.status})`).toBe(true);
        }
      }
    },
    T,
  );
});


/* ---------------------------------------------------------------- custo --- */

describe("custo unitário", () => {
  for (const papel of PERFIS) {
    it(
      `${papel}: custo ${VERDADE.custo.includes(papel as never) ? "presente" : "ausente"}`,
      async () => {
        const podeEstoque = VERDADE.estoqueVer.includes(papel as never);
        const podeCusto = VERDADE.custo.includes(papel as never);
        const r = await rpc(contas[papel]!.token, "stock_movements_list", { _size: 5 });
        if (!podeEstoque) {
          registrar(papel, "custo em stock_movements_list", "sem acesso ao estoque", `HTTP ${r.status}`);
          expect(r.status).toBeGreaterThanOrEqual(400);
          return;
        }
        expect(r.status, papel).toBe(200);
        const payload = r.body as { pode_ver_custo: boolean; rows: Record<string, unknown>[] };
        expect(payload.pode_ver_custo, papel).toBe(podeCusto);
        for (const linha of payload.rows) {
          const tem = Object.keys(linha).includes("unit_cost_cents");
          expect(tem, papel).toBe(podeCusto);
        }
        registrar(
          papel,
          "custo em stock_movements_list",
          podeCusto ? "presente" : "ausente",
          `pode_ver_custo=${payload.pode_ver_custo}`,
        );
      },
      T,
    );
  }

  it(
    "capacidade de custo existe apenas para Master, Diretoria e Financeiro",
    async () => {
      for (const [nome, caps] of capsDe) {
        const conta = contas[nome]!;
        const temCusto = caps.some((c) => c.endsWith("cost.view"));
        const esperado =
          conta.ativo && conta.papeis.some((p) => VERDADE.custo.includes(p as never));
        registrar(nome, "capacidade *.cost.view", String(esperado), String(temCusto));
        expect(temCusto, nome).toBe(esperado);
      }
    },
    T,
  );
});

/* ------------------------------------------------------------ documento --- */

describe("documento (CPF/CNPJ)", () => {
  let partyAlvo: string | null = null;

  beforeAll(async () => {
    partyAlvo = await criarPartySintetica("alvo-documento");
  }, 60_000);

  for (const papel of PERFIS) {
    it(
      `${papel}: documento ${VERDADE.documento.includes(papel as never) ? "revelável" : "mascarado e sem revelação"}`,
      async () => {
        const pode = VERDADE.documento.includes(papel as never);
        const lista = await rpc(contas[papel]!.token, "list_parties", { _limit: 5 });
        if (lista.status === 200) {
          const corpo = lista.body as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];
          const rows = Array.isArray(corpo) ? corpo : (corpo.rows ?? []);
          for (const linha of rows) {
            if (!pode) expect(linha["doc"] ?? null).toBeNull();
          }
        }
        const reveal = await rpc(contas[papel]!.token, "party_doc_reveal", { _id: partyAlvo });
        if (pode) {
          expect(reveal.status, `${papel} deveria poder revelar`).toBe(200);
        } else {
          expect(reveal.status, `${papel} não deveria revelar`).toBeGreaterThanOrEqual(400);
        }
        registrar(
          papel,
          "revelação de documento",
          pode ? "permitida" : "negada",
          `HTTP ${reveal.status}`,
        );
      },
      T,
    );
  }
});

/* ----------------------------------------------------------------- rede --- */

describe("Inteligência da Rede", () => {
  for (const papel of PERFIS) {
    it(
      `${papel}: visão agregada e identidade individual`,
      async () => {
        const podeAgregado = VERDADE.redeAgregada.includes(papel as never);
        const podeIdentidade = VERDADE.redeIdentidade.includes(papel as never);
        const overview = await rpc(contas[papel]!.token, "network_geo_overview", { _filtros: {} });
        if (podeAgregado) expect(overview.status, papel).toBe(200);
        else expect(overview.status, papel).toBeGreaterThanOrEqual(400);
        registrar(papel, "rede — visão agregada", podeAgregado ? "200" : "bloqueada", `HTTP ${overview.status}`);

        const caps = capsDe.get(papel) ?? [];
        expect(caps.includes("network.identity.view"), papel).toBe(podeIdentidade);
        expect(caps.includes("network.export"), papel).toBe(
          VERDADE.exportarRede.includes(papel as never),
        );
        registrar(
          papel,
          "rede — identidade/exportação",
          `${podeIdentidade}/${VERDADE.exportarRede.includes(papel as never)}`,
          "OK",
        );
      },
      T,
    );
  }

  it(
    "escopo territorial: representante com e sem pessoa vinculada",
    async () => {
      for (const nome of ["representante", "representante_sem_party"]) {
        const r = await rpc(contas[nome]!.token, "network_scope", {});
        registrar(nome, "escopo territorial (network_scope)", "sem erro de servidor", `HTTP ${r.status}`);
        expect(r.status, nome).toBeLessThan(500);
      }
    },
    T,
  );

  it(
    "representante não enxerga a carteira de outro representante",
    async () => {
      const outro = contas["consultora"]!.partyId!;
      const r = await rpc(contas["representante"]!.token, "network_geo_pontos", {
        _filtros: { representante: outro },
      });
      const vazio =
        r.status >= 400 ||
        !Array.isArray(r.body) ||
        (Array.isArray(r.body) && (r.body as unknown[]).length === 0);
      registrar("representante", "carteira de terceiro", "sem dados", vazio ? "OK" : "VAZOU");
      expect(vazio).toBe(true);
    },
    T,
  );

  it(
    "consultora não pesquisa outras consultoras",
    async () => {
      const r = await rpc(contas["consultora"]!.token, "search_registry", { _term: "HOMOLOG" });
      const vazio =
        r.status >= 400 || !Array.isArray(r.body) || (r.body as unknown[]).length === 0;
      registrar("consultora", "busca no cadastro geral", "sem resultados", vazio ? "OK" : "VAZOU");
      expect(vazio).toBe(true);
    },
    T,
  );
});

/* ------------------------------------ operações administrativas por papel -- */

describe("operações administrativas", () => {
  for (const papel of PERFIS) {
    it(
      `${papel}: publicação, importação, auditoria e dados financeiros`,
      async () => {
        const caps = capsDe.get(papel) ?? [];
        const esperaPublicar = VERDADE.publicar.includes(papel as never);
        const esperaImportar = VERDADE.importar.includes(papel as never);
        const esperaAuditoria = VERDADE.auditoria.includes(papel as never);
        const esperaFinanceiro = VERDADE.financeiroDados.includes(papel as never);

        expect(caps.includes("showcase.publish"), `${papel} publicar`).toBe(esperaPublicar);
        expect(caps.includes("imports.run"), `${papel} importar`).toBe(esperaImportar);
        expect(caps.includes("audit.view"), `${papel} auditoria`).toBe(esperaAuditoria);
        expect(caps.includes("registry.finance.view"), `${papel} financeiro`).toBe(esperaFinanceiro);

        const pub = await rpc(contas[papel]!.token, "publish_products", { _ids: [], _note: null });
        if (esperaPublicar) expect(pub.status, papel).toBeLessThan(400);
        else expect(pub.status, papel).toBeGreaterThanOrEqual(400);

        const audit = await comoUsuario(contas[papel]!.token, "/audit_logs?select=id&limit=1");
        const leuAuditoria = audit.status === 200 && (audit.body as unknown[]).length > 0;
        if (!esperaAuditoria) expect(leuAuditoria, `${papel} leu auditoria`).toBe(false);

        const pix = await comoUsuario(
          contas[papel]!.token,
          "/consultant_profiles?select=pix_key&limit=1",
        );
        const leuPix =
          pix.status === 200 &&
          (pix.body as { pix_key?: string | null }[]).some((l) => l.pix_key != null);
        if (!esperaFinanceiro) expect(leuPix, `${papel} leu PIX`).toBe(false);

        registrar(
          papel,
          "publicar/importar/auditar/PIX",
          `${esperaPublicar}/${esperaImportar}/${esperaAuditoria}/${esperaFinanceiro}`,
          `publish HTTP ${pub.status}`,
        );
      },
      T,
    );
  }
});

/* ----------------------------------------------------------- casos limite -- */

describe("casos especiais", () => {
  it(
    "usuário autenticado sem papel não tem capacidade alguma",
    async () => {
      const caps = capsDe.get("sem_papel") ?? [];
      registrar("sem_papel", "capacidades", "0", String(caps.length));
      expect(caps.length).toBe(0);
    },
    T,
  );

  it(
    "Master desativado perde todas as capacidades",
    async () => {
      const caps = capsDe.get("inativo") ?? [];
      registrar("inativo (master)", "capacidades", "0", String(caps.length));
      expect(caps.length).toBe(0);
    },
    T,
  );

  it(
    "usuário com dois papéis recebe a união das capacidades",
    async () => {
      const caps = capsDe.get("duplo") ?? [];
      expect(caps).toContain("showcase.publish"); // marketing
      expect(caps).toContain("finance.view"); // financeiro
      expect(caps).toContain("stock.cost.view"); // financeiro vê custo
      registrar("marketing+financeiro", "união de capacidades", "união", `${caps.length} capacidades`);
    },
    T,
  );

  it(
    "ninguém consegue alterar o próprio papel",
    async () => {
      for (const nome of ["consultora", "marketing", "estoque", "sem_papel"]) {
        const conta = contas[nome]!;
        const direto = await comoUsuario(conta.token, "/user_roles", {
          method: "POST",
          body: JSON.stringify({ user_id: conta.userId, role: "master" }),
        });
        const viaFn = await rpc(conta.token, "grant_role", {
          _user_id: conta.userId,
          _role: "master",
        });
        registrar(
          nome,
          "autopromoção de papel",
          "negada",
          `direto ${direto.status} / fn ${viaFn.status}`,
        );
        expect(direto.status).toBeGreaterThanOrEqual(400);
        expect(viaFn.status).toBeGreaterThanOrEqual(400);
        const depois = await rpc(conta.token, "my_roles", {});
        const papeis = Array.isArray(depois.body)
          ? (depois.body as unknown[]).map((x) =>
              typeof x === "string" ? x : String((x as Record<string, unknown>)["role"] ?? x),
            )
          : [];
        expect(papeis).not.toContain("master");
      }
    },
    T,
  );

  it(
    "conta desativada não consegue se reativar",
    async () => {
      const conta = contas["inativo"]!;
      const r = await comoUsuario(conta.token, `/profiles?id=eq.${conta.userId}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: true }),
      });
      const depois = await rpc(conta.token, "my_capabilities", {});
      const caps = Array.isArray(depois.body) ? (depois.body as unknown[]).length : 0;
      registrar("inativo (master)", "autoreativação", "negada", `HTTP ${r.status}, caps=${caps}`);
      expect(caps).toBe(0);
    },
    T,
  );

  it(
    "visitante: funções internas fechadas e catálogo publicado aberto",
    async () => {
      for (const fn of ["stock_movements_list", "list_parties", "publish_products", "my_roles"]) {
        const r = await rpc(null, fn, {});
        registrar("visitante", `função ${fn}`, "bloqueada", `HTTP ${r.status}`);
        expect(r.status, fn).toBeGreaterThanOrEqual(400);
      }
      const cat = await rpc(null, "public_categories", {});
      registrar("visitante", "catálogo público", "200", `HTTP ${cat.status}`);
      expect(cat.status).toBe(200);
    },
    T,
  );
});
