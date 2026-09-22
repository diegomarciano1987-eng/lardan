/**
 * Bateria ISOLADA — integridade das movimentações de maleta.
 *
 * Roda no Postgres local criado por `tests/isolado/subir.sh`, com dados
 * exclusivamente sintéticos. Nenhuma linha vem da base compartilhada.
 *
 *   bash tests/isolado/subir.sh && bun test tests/isolado
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  adm,
  Conta,
  criarConta,
  criarDeposito,
  criarVariante,
  escritaDireta,
  ler,
  localBloqueado,
  porEstoque,
  rpc,
  saldo,
  VISITANTE,
} from "./base";

interface Linha {
  variant_id: string;
  enviado: number;
  acrescido: number;
  saiu: number;
  retornado: number;
  retorno_em_transito: number;
  garantia: number;
  divergencia: number;
  perda: number;
  mantida: number;
  vendido: number;
  sob_responsabilidade: number;
  a_explicar: number;
}
interface Conciliacao {
  linhas: Linha[];
  totais: Record<string, number>;
  vendas_disponiveis: boolean;
}

let matriz: Conta, rep: Conta, repOutro: Conta, cons: Conta, outra: Conta;
let desativada: Conta, semPessoa: Conta, qualidade: Conta;
let depA = "", depB = "", bloqueado = "";
let vPrincipal = "", vParcial = "", vDisputa = "";
let ciclo1 = "", ciclo2 = "";
let acrescimo1 = "";

/** Cada execução usa chaves próprias: a bateria pode rodar várias vezes seguidas. */
const execucao = `${Date.now().toString(36)}`;
const chave = (s: string) => `iso-${execucao}-${s}`;

async function conciliar(conta: Conta, ciclo: string) {
  const r = await rpc<Conciliacao>(conta, "kit_conciliacao", { _cycle: ciclo });
  return r;
}

async function primeiraTransferencia(ciclo: string) {
  const r = (await adm.unsafe(`select id from public.kit_transfers where cycle_id = $1 order by seq asc limit 1`, [
    ciclo,
  ])) as { id: string }[];
  return r[0]!.id;
}

async function abrirCiclo(consultora: Conta, representante: Conta, origem: string) {
  const r = await rpc<{ cycle_id: string }>(matriz, "kit_cycle_create", {
    _payload: {
      origin_location_id: origem,
      consultora_party_id: consultora.partyId,
      representante_party_id: representante.partyId,
    },
  });
  if (!r.ok) throw new Error(`falha ao abrir ciclo: ${r.erro}`);
  return r.dados.cycle_id;
}

/** Expede, entrega e aceita — deixa a maleta em operação com a consultora. */
async function expedirEAceitar(ciclo: string, consultora: Conta, variante: string, qtd: number) {
  await rpc(matriz, "kit_item_upsert", { _cycle: ciclo, _variant: variante, _qty: qtd });
  await rpc(matriz, "kit_conferir", { _cycle: ciclo, _note: null });
  const exp = await rpc(matriz, "kit_expedir", { _cycle: ciclo, _payload: { rota: "direta" } });
  if (!exp.ok) throw new Error(`falha ao expedir: ${exp.erro}`);
  const transfer = await primeiraTransferencia(ciclo);
  const ent = await rpc(consultora, "kit_transfer_confirm", { _transfer: transfer, _payload: {} });
  if (!ent.ok) throw new Error(`falha na entrega: ${ent.erro}`);
  const ace = await rpc(consultora, "kit_aceitar", {
    _cycle: ciclo,
    _itens: [{ variant_id: variante, qty_accepted: qtd, qty_divergent: 0 }],
    _idempotency_key: chave(`aceite-${ciclo}`),
  });
  if (!ace.ok) throw new Error(`falha no aceite: ${ace.erro}`);
}

beforeAll(async () => {
  matriz = await criarConta({ nome: "matriz", papeis: ["master"] });
  rep = await criarConta({ nome: "representante", papeis: ["representante"], comParty: true });
  repOutro = await criarConta({ nome: "representante-outro", papeis: ["representante"], comParty: true });
  cons = await criarConta({ nome: "consultora", papeis: ["consultora"], comParty: true });
  outra = await criarConta({ nome: "consultora-outra", papeis: ["consultora"], comParty: true });
  desativada = await criarConta({ nome: "desativada", papeis: ["consultora"], comParty: true, ativo: false });
  semPessoa = await criarConta({ nome: "sem-pessoa", papeis: ["consultora"] });
  qualidade = await criarConta({ nome: "qualidade", papeis: ["qualidade"] });

  depA = await criarDeposito("A");
  depB = await criarDeposito("B");
  bloqueado = await localBloqueado();
  // o representante responde pelo depósito A e por nenhum outro
  await adm.unsafe(`update public.locations set responsible_user_id = $1 where id = $2`, [rep.uid, depA]);

  vPrincipal = await criarVariante("principal");
  vParcial = await criarVariante("parcial");
  vDisputa = await criarVariante("disputa");
  await porEstoque(vPrincipal, depA, 500);
  await porEstoque(vPrincipal, depB, 500);
  await porEstoque(vParcial, depA, 200);
  await porEstoque(vDisputa, depA, 5);

  ciclo1 = await abrirCiclo(cons, rep, depA);
  ciclo2 = await abrirCiclo(outra, repOutro, depA);
});

afterAll(() => {
  // a conexão é compartilhada pelas baterias do mesmo processo: não é encerrada aqui
});

describe("Cenário obrigatório 50 + 5 − 20", () => {
  it("1. remessa inicial de 50 baixa o depósito e entra no histórico", async () => {
    const antes = await saldo(vPrincipal, depA);
    await expedirEAceitar(ciclo1, cons, vPrincipal, 50);
    expect(antes - (await saldo(vPrincipal, depA))).toBe(50);

    const h = await rpc<{ movimentos: { tipo: string; situacao: string; itens: { quantidade: number }[] }[] }>(
      matriz,
      "kit_historico",
      { _cycle: ciclo1 },
    );
    const remessa = h.dados.movimentos.find((m) => m.tipo === "remessa_inicial")!;
    expect(remessa.situacao).toBe("confirmado");
    expect(remessa.itens.reduce((s, i) => s + i.quantidade, 0)).toBe(50);
  });

  it("2. acréscimo de 5 pelo representante da maleta, com origem sob sua responsabilidade", async () => {
    const antes = await saldo(vPrincipal, depA);
    const r = await rpc<{ movement_id: string }>(rep, "kit_acrescimo", {
      _cycle: ciclo1,
      _payload: {
        origem_location_id: depA,
        itens: [{ variant_id: vPrincipal, quantity: 5 }],
        idempotency_key: chave("acr-1"),
      },
    });
    expect(r.ok).toBe(true);
    acrescimo1 = r.dados.movement_id;
    expect(antes - (await saldo(vPrincipal, depA))).toBe(5);

    // ainda a caminho: não conta como saído
    const c = await conciliar(matriz, ciclo1);
    expect(c.dados.totais["saiu"]).toBe(50);
  });

  it("3. quem recebe é quem está com a maleta: aqui a consultora, e sem aceite novo", async () => {
    const antes = (await adm.unsafe(`select count(*)::int as n from public.kit_acceptances where cycle_id = $1`, [
      ciclo1,
    ])) as { n: number }[];

    // a custódia é da consultora: o representante não confirma por ela
    const negado = await rpc(rep, "kit_acrescimo_confirmar", { _movement: acrescimo1, _payload: {} });
    expect(negado.ok).toBe(false);

    const r = await rpc<{ recebido_por: string }>(cons, "kit_acrescimo_confirmar", {
      _movement: acrescimo1,
      _payload: {},
    });
    expect(r.ok).toBe(true);
    expect(r.dados.recebido_por).toBe("consultora");

    const depois = (await adm.unsafe(`select count(*)::int as n from public.kit_acceptances where cycle_id = $1`, [
      ciclo1,
    ])) as { n: number }[];
    expect(depois[0]!.n).toBe(antes[0]!.n);

    const c = await conciliar(matriz, ciclo1);
    expect(c.dados.totais["saiu"]).toBe(55);
  });

  it("3b. maleta em poder do representante: ele confirma como representante, sem aceite da consultora", async () => {
    const ciclo = await abrirCiclo(cons, rep, depA);
    await rpc(matriz, "kit_item_upsert", { _cycle: ciclo, _variant: vPrincipal, _qty: 10 });
    await rpc(matriz, "kit_conferir", { _cycle: ciclo, _note: null });
    const exp = await rpc(matriz, "kit_expedir", { _cycle: ciclo, _payload: { rota: "representante" } });
    expect(exp.ok).toBe(true);
    const entrega = await rpc(rep, "kit_transfer_confirm", { _transfer: await primeiraTransferencia(ciclo), _payload: {} });
    expect(entrega.ok).toBe(true);

    const acr = await rpc<{ movement_id: string }>(matriz, "kit_acrescimo", {
      _cycle: ciclo,
      _payload: {
        origem_location_id: depA,
        itens: [{ variant_id: vPrincipal, quantity: 3 }],
        idempotency_key: chave(`acr-rep-${ciclo}`),
      },
    });
    expect(acr.ok).toBe(true);

    const conf = await rpc<{ recebido_por: string }>(rep, "kit_acrescimo_confirmar", {
      _movement: acr.dados.movement_id,
      _payload: {},
    });
    expect(conf.ok).toBe(true);
    expect(conf.dados.recebido_por).toBe("representante");

    const aceites = (await adm.unsafe(`select count(*)::int as n from public.kit_acceptances where cycle_id = $1`, [
      ciclo,
    ])) as { n: number }[];
    expect(aceites[0]!.n).toBe(0);
  });

  it("4. retorno de 20 fica em trânsito e só baixa no depósito após conferência da Matriz", async () => {
    const antes = await saldo(vPrincipal, depA);
    const r = await rpc<{ movement_id: string }>(cons, "kit_retorno", {
      _cycle: ciclo1,
      _payload: {
        itens: [{ variant_id: vPrincipal, quantity: 20, destino: "retorno" }],
        idempotency_key: chave("ret-1"),
      },
    });
    expect(r.ok).toBe(true);
    expect(await saldo(vPrincipal, depA)).toBe(antes);

    const emTransito = await conciliar(matriz, ciclo1);
    expect(emTransito.dados.linhas[0]!.retorno_em_transito).toBe(20);

    const itens = (await adm.unsafe(`select id from public.kit_movement_items where movement_id = $1`, [
      r.dados.movement_id,
    ])) as { id: string }[];
    const conf = await rpc(matriz, "kit_retorno_confirmar", {
      _movement: r.dados.movement_id,
      _payload: {
        destino_location_id: depA,
        itens: [{ item_id: itens[0]!.id, qty_recebida: 20, qty_aprovada: 20, qty_divergente: 0 }],
      },
    });
    expect(conf.ok).toBe(true);
    expect(await saldo(vPrincipal, depA)).toBe(antes + 20);
  });

  it("5. restam 35 sob responsabilidade, sem venda e sem dívida", async () => {
    const c = await conciliar(matriz, ciclo1);
    const l = c.dados.linhas[0]!;
    expect(l.enviado).toBe(50);
    expect(l.acrescido).toBe(5);
    expect(l.retornado).toBe(20);
    expect(l.a_explicar).toBe(35);
    expect(l.vendido).toBe(0);
    expect(c.dados.vendas_disponiveis).toBe(false);

    // cada peça em uma única categoria
    const categorias =
      l.retornado + l.retorno_em_transito + l.garantia + l.divergencia + l.perda + l.mantida + l.vendido;
    expect(categorias + l.a_explicar).toBe(l.saiu);

    // nenhuma obrigação financeira nasceu da diferença física
    const titulos = (await adm.unsafe(
      `select count(*)::int as n from public.financial_titles where coalesce(descricao,'') ilike '%' || $1 || '%'`,
      [ciclo1],
    )) as { n: number }[];
    expect(titulos[0]!.n).toBe(0);
  });

  it("6. a composição expedida continua intacta (50)", async () => {
    const r = (await adm.unsafe(
      `select coalesce(sum(i.quantity),0)::int as q
         from public.kit_composition_items i
         join public.kit_compositions c on c.id = i.composition_id
        where c.cycle_id = $1`,
      [ciclo1],
    )) as { q: number }[];
    expect(r[0]!.q).toBe(50);
  });
});

describe("Chave de repetição", () => {
  it("7. repetir a mesma operação com a mesma chave não duplica nada", async () => {
    const antes = await saldo(vPrincipal, depA);
    const r = await rpc<{ repetida?: boolean }>(rep, "kit_acrescimo", {
      _cycle: ciclo1,
      _payload: {
        origem_location_id: depA,
        itens: [{ variant_id: vPrincipal, quantity: 5 }],
        idempotency_key: chave("acr-1"),
      },
    });
    expect(r.ok).toBe(true);
    expect(r.dados.repetida).toBe(true);
    expect(await saldo(vPrincipal, depA)).toBe(antes);
  });

  it("8. mesma chave com itens diferentes é recusada", async () => {
    const r = await rpc(rep, "kit_acrescimo", {
      _cycle: ciclo1,
      _payload: {
        origem_location_id: depA,
        itens: [{ variant_id: vPrincipal, quantity: 9 }],
        idempotency_key: chave("acr-1"),
      },
    });
    expect(r.ok).toBe(false);
  });

  it("9. mesma chave com origem diferente é recusada", async () => {
    const r = await rpc(matriz, "kit_acrescimo", {
      _cycle: ciclo1,
      _payload: {
        origem_location_id: depB,
        itens: [{ variant_id: vPrincipal, quantity: 5 }],
        idempotency_key: chave("acr-1"),
      },
    });
    expect(r.ok).toBe(false);
  });

  it("10. mesma chave em outra maleta é recusada e não devolve o movimento alheio", async () => {
    await expedirEAceitar(ciclo2, outra, vParcial, 30);
    const r = await rpc<{ movement_id?: string }>(matriz, "kit_acrescimo", {
      _cycle: ciclo2,
      _payload: {
        origem_location_id: depA,
        itens: [{ variant_id: vPrincipal, quantity: 5 }],
        idempotency_key: chave("acr-1"),
      },
    });
    expect(r.ok).toBe(false);
    expect(r.dados?.movement_id).toBeUndefined();
  });

  it("11. acesso cruzado por chave: outra consultora não obtém o movimento da maleta alheia", async () => {
    const r = await rpc<{ movement_id?: string }>(outra, "kit_retorno", {
      _cycle: ciclo1,
      _payload: {
        itens: [{ variant_id: vPrincipal, quantity: 20, destino: "retorno" }],
        idempotency_key: chave("ret-1"),
      },
    });
    expect(r.ok).toBe(false);
    expect(r.dados?.movement_id).toBeUndefined();
  });
});

describe("Simultaneidade", () => {
  it("12. duas chamadas simultâneas da mesma operação produzem um único efeito", async () => {
    const antes = await saldo(vPrincipal, depA);
    const payload = {
      origem_location_id: depA,
      itens: [{ variant_id: vPrincipal, quantity: 3 }],
      idempotency_key: chave("acr-simultaneo"),
    };
    const [a, b] = await Promise.all([
      rpc<{ movement_id: string }>(matriz, "kit_acrescimo", { _cycle: ciclo1, _payload: payload }),
      rpc<{ movement_id: string }>(matriz, "kit_acrescimo", { _cycle: ciclo1, _payload: payload }),
    ]);
    const ids = new Set([a.dados?.movement_id, b.dados?.movement_id].filter(Boolean));
    expect(ids.size).toBe(1);
    expect(antes - (await saldo(vPrincipal, depA))).toBe(3);
  });

  it("13. duas operações simultâneas disputando o mesmo estoque não deixam saldo negativo", async () => {
    // 5 unidades no depósito, duas saídas de 4 ao mesmo tempo
    const [a, b] = await Promise.all([
      rpc(matriz, "kit_acrescimo", {
        _cycle: ciclo1,
        _payload: {
          origem_location_id: depA,
          itens: [{ variant_id: vDisputa, quantity: 4 }],
          idempotency_key: chave("disputa-a"),
        },
      }),
      rpc(matriz, "kit_acrescimo", {
        _cycle: ciclo1,
        _payload: {
          origem_location_id: depA,
          itens: [{ variant_id: vDisputa, quantity: 4 }],
          idempotency_key: chave("disputa-b"),
        },
      }),
    ]);
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
    expect(await saldo(vDisputa, depA)).toBe(1);
  });
});

describe("Retorno declarado diferente do recebido", () => {
  let movParcial = "";
  let itemParcial = "";

  it("14. declarar 20 e receber 18 coloca 18 no depósito, não 20", async () => {
    const antes = await saldo(vParcial, depA);
    const r = await rpc<{ movement_id: string }>(outra, "kit_retorno", {
      _cycle: ciclo2,
      _payload: {
        itens: [{ variant_id: vParcial, quantity: 20, destino: "retorno" }],
        idempotency_key: chave("ret-parcial"),
      },
    });
    expect(r.ok).toBe(true);
    movParcial = r.dados.movement_id;
    const itens = (await adm.unsafe(`select id from public.kit_movement_items where movement_id = $1`, [
      movParcial,
    ])) as { id: string }[];
    itemParcial = itens[0]!.id;

    const semMotivo = await rpc(matriz, "kit_retorno_confirmar", {
      _movement: movParcial,
      _payload: {
        destino_location_id: depA,
        itens: [{ item_id: itemParcial, qty_recebida: 18, qty_aprovada: 18, qty_divergente: 0 }],
      },
    });
    expect(semMotivo.ok).toBe(false); // diferença sem motivo é recusada

    const conf = await rpc<{ recebidas: number; aprovadas: number; faltantes: number }>(
      matriz,
      "kit_retorno_confirmar",
      {
        _movement: movParcial,
        _payload: {
          destino_location_id: depA,
          itens: [
            {
              item_id: itemParcial,
              qty_recebida: 18,
              qty_aprovada: 18,
              qty_divergente: 0,
              motivo: "Faltaram 2 peças na caixa",
            },
          ],
        },
      },
    );
    expect(conf.ok).toBe(true);
    expect(conf.dados.recebidas).toBe(18);
    expect(conf.dados.faltantes).toBe(2);
    expect(await saldo(vParcial, depA)).toBe(antes + 18);
  });

  it("15. as 2 faltantes continuam a explicar, sem virar venda nem dívida", async () => {
    const c = await conciliar(matriz, ciclo2);
    const l = c.dados.linhas.find((x) => x.variant_id === vParcial)!;
    expect(l.retornado).toBe(18);
    expect(l.vendido).toBe(0);
    expect(l.a_explicar).toBe(12); // 30 saíram, 18 voltaram
    expect(c.dados.vendas_disponiveis).toBe(false);
  });

  it("16. confirmação repetida e simultânea não duplica estoque", async () => {
    const antes = await saldo(vParcial, depA);
    const [a, b] = await Promise.all([
      rpc<{ repetida?: boolean }>(matriz, "kit_retorno_confirmar", {
        _movement: movParcial,
        _payload: { destino_location_id: depA, itens: [] },
      }),
      rpc<{ repetida?: boolean }>(matriz, "kit_retorno_confirmar", {
        _movement: movParcial,
        _payload: { destino_location_id: depA, itens: [] },
      }),
    ]);
    expect(a.dados?.repetida || b.dados?.repetida).toBe(true);
    expect(await saldo(vParcial, depA)).toBe(antes);
  });
});

describe("Garantia e defeito", () => {
  let movGarantia = "";

  it("17. peças em garantia vão para local bloqueado, fora do estoque disponível", async () => {
    const r = await rpc<{ movement_id: string }>(outra, "kit_retorno", {
      _cycle: ciclo2,
      _payload: {
        itens: [{ variant_id: vParcial, quantity: 3, destino: "garantia", reason: "Banho descascando" }],
        idempotency_key: chave("ret-garantia"),
      },
    });
    expect(r.ok).toBe(true);
    movGarantia = r.dados.movement_id;
    const itens = (await adm.unsafe(`select id from public.kit_movement_items where movement_id = $1`, [
      movGarantia,
    ])) as { id: string }[];

    const antesDeposito = await saldo(vParcial, depA);
    const conf = await rpc(matriz, "kit_retorno_confirmar", {
      _movement: movGarantia,
      _payload: {
        destino_location_id: depA,
        itens: [{ item_id: itens[0]!.id, qty_recebida: 3, qty_aprovada: 3, qty_divergente: 0 }],
      },
    });
    expect(conf.ok).toBe(true);
    expect(await saldo(vParcial, depA)).toBe(antesDeposito); // nada entrou no disponível
    expect(await saldo(vParcial, bloqueado)).toBe(3);

    const local = (await adm.unsafe(`select is_blocked from public.locations where id = $1`, [bloqueado])) as {
      is_blocked: boolean;
    }[];
    expect(local[0]!.is_blocked).toBe(true);
  });

  it("18. o local bloqueado não abastece maleta nenhuma", async () => {
    const r = await rpc(matriz, "kit_acrescimo", {
      _cycle: ciclo1,
      _payload: {
        origem_location_id: bloqueado,
        itens: [{ variant_id: vParcial, quantity: 1 }],
        idempotency_key: chave("acr-bloqueado"),
      },
    });
    expect(r.ok).toBe(false);
  });

  it("19. liberar garantia exige usuário autorizado e fica registrado", async () => {
    const semPermissao = await rpc(cons, "stock_liberar_bloqueio", {
      _variant_id: vParcial,
      _quantity: 1,
      _to_location_id: depA,
      _motivo: "tentativa indevida",
    });
    expect(semPermissao.ok).toBe(false);

    const antes = await saldo(vParcial, depA);
    const ok = await rpc(qualidade, "stock_liberar_bloqueio", {
      _variant_id: vParcial,
      _quantity: 2,
      _to_location_id: depA,
      _motivo: "Peças recuperadas na análise de qualidade",
    });
    expect(ok.ok).toBe(true);
    expect(await saldo(vParcial, depA)).toBe(antes + 2);
    expect(await saldo(vParcial, bloqueado)).toBe(1);

    const registro = (await adm.unsafe(
      `select count(*)::int as n from public.stock_movements
        where variant_id = $1 and to_location_id = $2 and note ilike '%qualidade%'`,
      [vParcial, depA],
    )) as { n: number }[];
    expect(registro[0]!.n).toBeGreaterThan(0);
  });
});

describe("Perfis e limites de acesso", () => {
  it("20. representante não acrescenta em maleta que não é dele", async () => {
    const r = await rpc(repOutro, "kit_acrescimo", {
      _cycle: ciclo1,
      _payload: {
        origem_location_id: depA,
        itens: [{ variant_id: vPrincipal, quantity: 1 }],
        idempotency_key: chave("acr-rep-alheio"),
      },
    });
    expect(r.ok).toBe(false);
  });

  it("21. representante não retira de depósito pelo qual não responde", async () => {
    const r = await rpc(rep, "kit_acrescimo", {
      _cycle: ciclo1,
      _payload: {
        origem_location_id: depB,
        itens: [{ variant_id: vPrincipal, quantity: 1 }],
        idempotency_key: chave("acr-rep-depb"),
      },
    });
    expect(r.ok).toBe(false);
  });

  it("22. consultora não confirma o próprio retorno na Matriz", async () => {
    const r = await rpc<{ movement_id: string }>(cons, "kit_retorno", {
      _cycle: ciclo1,
      _payload: {
        itens: [{ variant_id: vPrincipal, quantity: 1, destino: "retorno" }],
        idempotency_key: chave("ret-autoconf"),
      },
    });
    expect(r.ok).toBe(true);
    const invasao = await rpc(cons, "kit_retorno_confirmar", {
      _movement: r.dados.movement_id,
      _payload: { destino_location_id: depA, itens: [] },
    });
    expect(invasao.ok).toBe(false);
  });

  it("23. usuário desativado, visitante e usuário sem pessoa vinculada são recusados", async () => {
    for (const quem of [desativada, semPessoa, VISITANTE]) {
      const h = await rpc(quem, "kit_historico", { _cycle: ciclo1 });
      const c = await rpc(quem, "kit_conciliacao", { _cycle: ciclo1 });
      const r = await rpc(quem, "kit_retorno", {
        _cycle: ciclo1,
        _payload: { itens: [{ variant_id: vPrincipal, quantity: 1, destino: "retorno" }] },
      });
      expect({ quem: quem.nome, h: h.ok, c: c.ok, r: r.ok }).toEqual({
        quem: quem.nome,
        h: false,
        c: false,
        r: false,
      });
    }
  });

  it("24. outra consultora não enxerga o histórico da maleta alheia", async () => {
    const h = await rpc(outra, "kit_historico", { _cycle: ciclo1 });
    expect(h.ok).toBe(false);
    const linhas = await ler(outra, `select id from public.kit_movements where cycle_id = $1`, [ciclo1]);
    expect(linhas.linhas.length).toBe(0);
  });

  it("25. chamada direta fora da interface não escreve movimentação, saldo nem estoque", async () => {
    const mov = await escritaDireta(
      matriz,
      `insert into public.kit_movements (cycle_id, seq, kind, status) values ($1, 999, 'venda', 'confirmado')`,
      [ciclo1],
    );
    expect(mov.ok).toBe(false);

    const bal = await escritaDireta(
      matriz,
      `update public.kit_balances set qty_sold = qty_sold + 10 where cycle_id = $1`,
      [ciclo1],
    );
    expect(bal.ok).toBe(false);

    const est = await escritaDireta(
      matriz,
      `update public.stock_balances set quantity = quantity + 100 where variant_id = $1 and location_id = $2`,
      [vPrincipal, depA],
    );
    expect(est.ok).toBe(false);
    expect(await saldo(vPrincipal, depA)).toBeLessThan(500);
  });
});

describe("Atomicidade", () => {
  it("26. falha no meio da operação não deixa movimentação, saldo nem histórico pela metade", async () => {
    const antesSaldo = await saldo(vPrincipal, depA);
    const antesMov = (await adm.unsafe(`select count(*)::int as n from public.kit_movements where cycle_id = $1`, [
      ciclo1,
    ])) as { n: number }[];
    const antesEventos = (await adm.unsafe(`select count(*)::int as n from public.kit_events where cycle_id = $1`, [
      ciclo1,
    ])) as { n: number }[];

    // segundo item excede o estoque: a operação inteira precisa cair
    const r = await rpc(matriz, "kit_acrescimo", {
      _cycle: ciclo1,
      _payload: {
        origem_location_id: depA,
        itens: [
          { variant_id: vPrincipal, quantity: 2 },
          { variant_id: vDisputa, quantity: 9999 },
        ],
        idempotency_key: chave("acr-atomico"),
      },
    });
    expect(r.ok).toBe(false);

    expect(await saldo(vPrincipal, depA)).toBe(antesSaldo);
    const depoisMov = (await adm.unsafe(`select count(*)::int as n from public.kit_movements where cycle_id = $1`, [
      ciclo1,
    ])) as { n: number }[];
    const depoisEventos = (await adm.unsafe(`select count(*)::int as n from public.kit_events where cycle_id = $1`, [
      ciclo1,
    ])) as { n: number }[];
    expect(depoisMov[0]!.n).toBe(antesMov[0]!.n);
    expect(depoisEventos[0]!.n).toBe(antesEventos[0]!.n);

    const orfaos = (await adm.unsafe(
      `select count(*)::int as n from public.kit_movements where idempotency_key = $1`,
      [chave("acr-atomico")],
    )) as { n: number }[];
    expect(orfaos[0]!.n).toBe(0);
  });

  it("27. saldo físico do depósito bate com o histórico da maleta", async () => {
    const mov = (await adm.unsafe(
      `select coalesce(sum(case when sm.kind = 'transferencia' and sm.to_location_id = l.id then sm.quantity
                                when sm.from_location_id = l.id then -sm.quantity else 0 end), 0)::int as delta
         from public.stock_movements sm
         join public.locations l on l.id = $1
        where sm.variant_id = $2 and (sm.from_location_id = l.id or sm.to_location_id = l.id)`,
      [depA, vPrincipal],
    )) as { delta: number }[];
    expect(500 + mov[0]!.delta).toBe(await saldo(vPrincipal, depA));
  });
});
