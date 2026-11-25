/**
 * 0371 — Jurídico (Dr. Danilo) vê a Cobrança inteira e não altera nada. Banco ISOLADO, dados sintéticos.
 *  1. Lê carteira, indicadores, ficha da devedora, lembretes e tabelas da cobrança.
 *  2. Não move etapa, não registra contato, não cria promessa, não salva simulação nem acordo judicial.
 *  3. Não ganha outro módulo: sem financeiro, sem cadastro, sem estoque.
 *  4. Só o Master concede o papel jurídico.
 *  5. Quem não tem papel nenhum continua sem ler a Cobrança.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, ler, rpc, type Conta } from "./base";

const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let jur: Conta, cob: Conta, master: Conta, nada: Conta, gestor: Conta;
let devedora: string;

beforeAll(async () => {
  jur = await criarConta({ nome: `jur-${marca}`, papeis: ["juridico"], comParty: true });
  cob = await criarConta({ nome: `jcob-${marca}`, papeis: ["cobranca"], comParty: true });
  master = await criarConta({ nome: `jmaster-${marca}`, papeis: ["master"], comParty: true });
  gestor = await criarConta({ nome: `jgest-${marca}`, papeis: ["suporte"], comParty: true });
  nada = await criarConta({ nome: `jnada-${marca}`, papeis: [], comParty: true });
  const r = (await adm.unsafe(`insert into parties(kind, display_name, legal_name, code) values ('pessoa',$1,$1,$2) returning id`,
    [`Devedora Jur ${marca}`, `JUR${marca}`])) as { id: string }[];
  devedora = r[0]!.id;
  // caso aberto pela equipe de cobrança (quem pode escrever)
  const m = await rpc(cob, "cob_mover_etapa", { _party: devedora, _etapa: "em_contato" });
  if (!m.ok) throw new Error(m.erro ?? "não criou o caso");
});

describe("Jurídico somente leitura (0371)", () => {
  test("1. lê carteira, indicadores, ficha, lembretes e tabelas da cobrança", async () => {
    for (const fn of ["cob_carteira2", "cob_kpis", "cob_lembretes", "cob_acordos_situacao", "cob_acordos_atrasados_lista"]) {
      const r = await ler(jur, `select count(*)::int n from public.${fn}()`);
      expect({ fn, erro: r.erro }).toEqual({ fn, erro: null });
      // sem papel: recusa ou devolve vazio (nunca linhas de devedoras)
      const negado = await ler<{ n: number }>(nada, `select count(*)::int n from public.${fn}()`);
      expect({ fn, viu: negado.ok && (negado.linhas[0]?.n ?? 0) > 0 && fn !== "cob_kpis" }).toEqual({ fn, viu: false });
    }
    const ficha = await rpc<{ caso: { etapa: string } | null }>(jur, "cob_devedor", { _party: devedora });
    expect(ficha.erro).toBeNull();
    expect(ficha.dados.caso?.etapa).toBe("em_contato");
    const casos = await ler<{ etapa: string }>(jur, "select etapa from cob_casos where party_id = $1", [devedora]);
    expect(casos.linhas.map((c) => c.etapa)).toEqual(["em_contato"]);
    const inter = await ler(jur, "select 1 from cob_interacoes where party_id = $1", [devedora]);
    expect(inter.linhas.length).toBe(1);
  });

  test("2. não move, não registra, não promete, não simula, não lança acordo judicial", async () => {
    const tentativas: [string, Record<string, unknown>][] = [
      ["cob_mover_etapa", { _party: devedora, _etapa: "pausado" }],
      ["cob_mover_etapa", { _party: devedora, _etapa: "acompanhamento", _responsavel: devedora }],
      ["cob_registrar", { _party: devedora, _tipo: "ligacao", _resultado: "sucesso", _obs: "x", _parcelas: [] }],
      ["cob_promessa_criar", { _party: devedora, _valor: 1000, _data: "2030-01-01", _parcelas: [], _obs: "x" }],
      ["cob_tarefa_criar", { _party: devedora, _titulo: "x", _vence: "2030-01-01" }],
      ["cob_suspender", { _party: devedora, _suspensa: true, _motivo: "x" }],
      ["cob_simulacao_salvar", { _party: devedora, _dados: {} }],
      ["cob_judicial_encaminhar", { _party: devedora, _d: { processo: "1" } }],
      ["cob_judicial_acordo_salvar", { _party: devedora, _d: {} }],
      ["cob_config_salvar", { _multa: 9, _juros: 9, _carencia: 9 }],
    ];
    for (const [fn, args] of tentativas) {
      const r = await rpc(jur, fn, args);
      expect({ fn, ok: r.ok }).toEqual({ fn, ok: false });
    }
    const casos = (await adm.unsafe("select etapa, suspensa from cob_casos where party_id = $1", [devedora])) as { etapa: string; suspensa: boolean }[];
    expect(casos[0]).toMatchObject({ etapa: "em_contato", suspensa: false });
    const inter = (await adm.unsafe("select count(*)::int n from cob_interacoes where party_id = $1", [devedora])) as { n: number }[];
    expect(inter[0]!.n).toBe(1);
  });

  test("2b. (0387) move o card do Kanban, com histórico e auditoria, e vê a lista de ações atrasadas", async () => {
    const m = await rpc(jur, "cob_mover_etapa", { _party: devedora, _etapa: "acompanhamento" });
    expect(m.erro).toBeNull();
    const c = (await adm.unsafe("select etapa from cob_casos where party_id = $1", [devedora])) as { etapa: string }[];
    expect(c[0]!.etapa).toBe("acompanhamento");
    const au = (await adm.unsafe("select count(*)::int n from audit_logs where action='cob_mover_etapa_juridico' and entity_id = $1", [devedora])) as { n: number }[];
    expect(au[0]!.n).toBe(1);
    await rpc(jur, "cob_mover_etapa", { _party: devedora, _etapa: "em_contato" });
    const l = await ler(jur, "select count(*)::int n from public.cob_acoes_atrasadas_lista()");
    expect(l.erro).toBeNull();
    const negado = await ler(nada, "select count(*)::int n from public.cob_acoes_atrasadas_lista()");
    expect(negado.ok).toBe(false);
  });

  test("3. não ganha nenhum outro módulo", async () => {
    const caps = await ler<{ capability: string }>(jur, "select capability from public.my_capabilities() as capability");
    expect(caps.ok).toBe(true);
    expect(caps.linhas.map((c) => Object.values(c)[0])).toEqual(["collection.view"]);
    const pode = await rpc<boolean>(jur, "cob_pode", { _u: jur.uid });
    expect(pode.dados).toBe(false);
  });

  test("4. só o Master concede o papel jurídico", async () => {
    const m = await rpc<boolean>(master, "access_pode_conceder", { _uid: master.uid, _role: "juridico" });
    expect(m.dados).toBe(true);
    const g = await rpc<boolean>(gestor, "access_pode_conceder", { _uid: gestor.uid, _role: "juridico" });
    expect(g.dados).toBe(false);
    const c = await rpc<boolean>(cob, "access_pode_conceder", { _uid: cob.uid, _role: "juridico" });
    expect(c.dados).toBe(false);
  });

  test("5. quem não tem papel continua sem ler a Cobrança", async () => {
    const r = await ler(nada, "select * from public.cob_carteira2()");
    expect(r.ok).toBe(false);
    const casos = await ler(nada, "select 1 from cob_casos where party_id = $1", [devedora]);
    expect(casos.linhas.length).toBe(0);
  });
});
