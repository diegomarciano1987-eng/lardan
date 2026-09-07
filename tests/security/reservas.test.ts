/**
 * Homologação do motor de reservas — roda contra o banco real com contas
 * sintéticas (@lardan.test) e uma peça já existente. As unidades usadas são
 * devolvidas ao final por lançamentos inversos; nada é apagado.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarConta, limpar, rpc, type Conta } from "./harness";

const T = 90_000;
const URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!;
const SERVICE = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;

const contas: Record<string, Conta> = {};
let variantId = "";
let localA = "";
let base = 0;

const relatorio: { perfil: string; cenario: string; esperado: string; obtido: string }[] = [];
const registrar = (perfil: string, cenario: string, esperado: string, obtido: string) =>
  relatorio.push({ perfil, cenario, esperado, obtido });

const chave = () => `homolog-res-${crypto.randomUUID()}`;
const master = () => contas["master"]!.token;

/** Escrita privilegiada, só para montar cenário de vencimento. */
async function admin(path: string, init: RequestInit) {
  const res = await fetch(`${URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return res.status;
}

async function saldo(): Promise<{ fisico: number; reservado: number }> {
  const r = await comoUsuario(
    master(),
    `/stock_balances?variant_id=eq.${variantId}&location_id=eq.${localA}&select=quantity,reserved`,
  );
  const l = Array.isArray(r.body) ? (r.body as { quantity: number; reserved: number }[]) : [];
  return { fisico: l[0]?.quantity ?? 0, reservado: l[0]?.reserved ?? 0 };
}

async function disponivel(): Promise<number> {
  const s = await saldo();
  return s.fisico - s.reservado;
}

const amanha = (dias = 3) => new Date(Date.now() + dias * 86_400_000).toISOString();

async function reservar(token: string | null, qtd: number, extra: Record<string, unknown> = {}) {
  return rpc(token, "create_stock_reservation", {
    _variant_id: variantId,
    _location_id: localA,
    _quantity: qtd,
    _expires_at: amanha(),
    _origin: "manual",
    _idempotency_key: chave(),
    ...extra,
  });
}

const idDaReserva = (body: unknown) => (body as { id: string }).id;

beforeAll(async () => {
  for (const papel of ["master", "financeiro", "estoque", "consultora"] as const) {
    contas[papel] = await criarConta({
      nome: papel,
      papeis: [papel],
      comParty: papel === "consultora",
    });
  }

  const v = await comoUsuario(
    master(),
    "/product_variants?select=id&is_active=eq.true&order=created_at&limit=1",
  );
  variantId = (v.body as { id: string }[])[0]?.id ?? "";
  const l = await comoUsuario(master(), "/locations?select=id&is_active=eq.true&order=code&limit=1");
  localA = (l.body as { id: string }[])[0]?.id ?? "";

  expect(variantId, "peça de teste").toBeTruthy();
  expect(localA, "local de teste").toBeTruthy();

  // garante uma base física conhecida
  await rpc(master(), "register_stock_movement", {
    _kind: "entrada",
    _variant_id: variantId,
    _quantity: 10,
    _to_location_id: localA,
    _idempotency_key: chave(),
  });
  base = (await saldo()).fisico;
}, 180_000);

afterAll(async () => {
  // eslint-disable-next-line no-console
  console.table(relatorio);
  await limpar();
}, 120_000);

describe("motor de reservas", () => {
  it(
    "reservar compromete o disponível sem mexer no físico",
    async () => {
      const antes = await saldo();
      const r = await reservar(master(), 2);
      expect(r.status).toBe(200);
      const depois = await saldo();
      expect(depois.fisico).toBe(antes.fisico);
      expect(depois.reservado).toBe(antes.reservado + 2);
      expect(depois.fisico - depois.reservado).toBe(antes.fisico - antes.reservado - 2);
      registrar(
        "master",
        "criar reserva",
        "físico igual, reservado +2, disponível −2",
        `físico ${depois.fisico} reservado ${depois.reservado}`,
      );
      await rpc(master(), "release_stock_reservation", {
        _reservation_id: idDaReserva(r.body),
        _cancelar: false,
      });
    },
    T,
  );

  it(
    "reserva acima do disponível é recusada",
    async () => {
      const disp = await disponivel();
      const r = await reservar(master(), disp + 5);
      expect(r.status).toBe(400);
      registrar("master", "reserva acima do disponível", "recusada", `HTTP ${r.status}`);
    },
    T,
  );

  it(
    "duas reservas simultâneas não levam a mesma última unidade",
    async () => {
      const disp = await disponivel();
      // trava tudo menos uma unidade
      const bloqueio = await reservar(master(), disp - 1);
      expect(bloqueio.status).toBe(200);
      const [a, b] = await Promise.all([reservar(master(), 1), reservar(master(), 1)]);
      const ok = [a, b].filter((x) => x.status === 200);
      expect(ok.length).toBe(1);
      expect(await disponivel()).toBe(0);
      registrar(
        "master",
        "duas reservas na última unidade",
        "apenas uma aprovada, disponível 0",
        `aprovadas ${ok.length}, disponível 0`,
      );
      for (const x of [bloqueio, ...ok])
        await rpc(master(), "release_stock_reservation", {
          _reservation_id: idDaReserva(x.body),
          _cancelar: false,
        });
    },
    T,
  );

  it(
    "liberar devolve o disponível sem alterar o físico",
    async () => {
      const antes = await saldo();
      const r = await reservar(master(), 3);
      const lib = await rpc(master(), "release_stock_reservation", {
        _reservation_id: idDaReserva(r.body),
        _cancelar: false,
      });
      expect(lib.status).toBe(200);
      const depois = await saldo();
      expect(depois).toEqual(antes);
      const repetido = await rpc(master(), "release_stock_reservation", {
        _reservation_id: idDaReserva(r.body),
        _cancelar: false,
      });
      // liberar de novo não tem efeito nenhum: o saldo permanece igual
      expect((repetido.body as { repetida?: boolean }).repetida).toBe(true);
      expect(await saldo()).toEqual(antes);
      registrar(
        "master",
        "liberar reserva",
        "disponível volta e liberação repetida não tem efeito",
        "ok",
      );
    },
    T,
  );

  it(
    "cancelar exige motivo e fica registrado",
    async () => {
      const r = await reservar(master(), 1);
      const sem = await rpc(master(), "release_stock_reservation", {
        _reservation_id: idDaReserva(r.body),
        _cancelar: true,
      });
      expect(sem.status).toBe(400);
      const com = await rpc(master(), "release_stock_reservation", {
        _reservation_id: idDaReserva(r.body),
        _cancelar: true,
        _reason: "HOMOLOG cancelamento de teste",
      });
      expect(com.status).toBe(200);
      registrar("master", "cancelar reserva", "sem motivo recusado, com motivo aceito", "ok");
    },
    T,
  );

  it(
    "confirmar gera uma única saída, mesmo repetindo",
    async () => {
      const antes = await saldo();
      const r = await reservar(master(), 2);
      const c1 = await rpc(master(), "confirm_stock_reservation", {
        _reservation_id: idDaReserva(r.body),
        _idempotency_key: chave(),
      });
      expect(c1.status).toBe(200);
      const c2 = await rpc(master(), "confirm_stock_reservation", {
        _reservation_id: idDaReserva(r.body),
        _idempotency_key: chave(),
      });
      // segunda confirmação devolve a mesma reserva, sem gerar nova saída
      expect((c2.body as { repetida?: boolean }).repetida).toBe(true);
      expect((c2.body as { movimento_id?: string }).movimento_id).toBe(
        (c1.body as { movimento_id?: string }).movimento_id,
      );
      const depois = await saldo();
      expect(depois.fisico).toBe(antes.fisico - 2);
      expect(depois.reservado).toBe(antes.reservado);
      registrar(
        "master",
        "confirmar reserva",
        "uma saída física única",
        `físico ${antes.fisico}→${depois.fisico}, segunda confirmação HTTP ${c2.status}`,
      );
    },
    T,
  );

  it(
    "reserva vencida deixa de comprometer o disponível",
    async () => {
      const antes = await saldo();
      const r = await reservar(master(), 2);
      await admin(`/stock_reservations?id=eq.${idDaReserva(r.body)}`, {
        method: "PATCH",
        body: JSON.stringify({ expires_at: new Date(Date.now() - 3600_000).toISOString() }),
      });
      const e1 = await rpc(master(), "expire_stock_reservations");
      expect(e1.status).toBe(200);
      const depois = await saldo();
      expect(depois).toEqual(antes);
      const e2 = await rpc(master(), "expire_stock_reservations");
      expect(e2.status).toBe(200);
      expect(await saldo()).toEqual(antes);
      registrar(
        "master",
        "expirar reservas",
        "vencida libera disponível e repetição não tem efeito",
        "ok",
      );
    },
    T,
  );

  it(
    "saída comum não consome unidades reservadas",
    async () => {
      const disp = await disponivel();
      const r = await reservar(master(), disp);
      expect(r.status).toBe(200);
      const saida = await rpc(master(), "register_stock_movement", {
        _kind: "saida",
        _variant_id: variantId,
        _quantity: 1,
        _from_location_id: localA,
        _reason_code: "venda",
        _idempotency_key: chave(),
      });
      expect(saida.status).toBe(400);
      const inv = await rpc(master(), "register_stock_movement", {
        _kind: "inventario",
        _variant_id: variantId,
        _quantity: 0,
        _to_location_id: localA,
        _reason_code: "inventario",
        _note: "HOMOLOG contagem",
        _idempotency_key: chave(),
      });
      expect(inv.status).toBe(400);
      registrar(
        "master",
        "saída e contagem sobre reservado",
        "ambas recusadas",
        `saída HTTP ${saida.status} / contagem HTTP ${inv.status}`,
      );
      await rpc(master(), "release_stock_reservation", {
        _reservation_id: idDaReserva(r.body),
        _cancelar: false,
      });
    },
    T,
  );

  it(
    "histórico de reservas é imutável pela API",
    async () => {
      const r = await reservar(master(), 1);
      const id = idDaReserva(r.body);
      const patch = await comoUsuario(master(), `/stock_reservations?id=eq.${id}`, {
        method: "PATCH",
        body: JSON.stringify({ quantity: 99 }),
      });
      const del = await comoUsuario(master(), `/stock_reservations?id=eq.${id}`, {
        method: "DELETE",
      });
      // nem o PATCH nem o DELETE podem ter efeito: a reserva continua intacta
      const depois = await rpc(master(), "stock_reservation_detail", { _reservation_id: id });
      expect(depois.status).toBe(200);
      expect((depois.body as { quantidade: number }).quantidade).toBe(1);
      expect((depois.body as { situacao: string }).situacao).toBe("ativa");
      registrar(
        "master",
        "alterar/apagar reserva",
        "sem efeito: quantidade e situação intactas",
        `PATCH ${patch.status} / DELETE ${del.status} · reserva íntegra`,
      );
      await rpc(master(), "release_stock_reservation", {
        _reservation_id: id,
        _cancelar: false,
      });
    },
    T,
  );

  it(
    "Estoque reserva e confirma sem enxergar custo",
    async () => {
      const r = await reservar(contas["estoque"]!.token, 1);
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.body)).not.toMatch(/cost|custo/i);
      const lista = await rpc(contas["estoque"]!.token, "stock_reservations_list", {
        _page: 0,
        _size: 5,
      });
      expect(lista.status).toBe(200);
      expect(JSON.stringify(lista.body)).not.toMatch(/cost_cents/i);
      const conf = await rpc(contas["estoque"]!.token, "confirm_stock_reservation", {
        _reservation_id: idDaReserva(r.body),
        _idempotency_key: chave(),
      });
      expect(conf.status).toBe(200);
      registrar("estoque", "reservar e confirmar", "permitido e sem custo", "ok");
    },
    T,
  );

  it(
    "Financeiro só visualiza; Consultora e visitante não leem reservas",
    async () => {
      const ver = await rpc(contas["financeiro"]!.token, "stock_reservations_list", {
        _page: 0,
        _size: 5,
      });
      const criar = await reservar(contas["financeiro"]!.token, 1);
      const consultora = await rpc(contas["consultora"]!.token, "stock_reservations_list", {
        _page: 0,
        _size: 5,
      });
      const visitante = await rpc(null, "stock_reservations_list", { _page: 0, _size: 5 });
      const tabela = await comoUsuario(null, "/stock_reservations?select=id&limit=1");
      expect(ver.status).toBe(200);
      expect(criar.status).toBeGreaterThanOrEqual(400);
      expect(consultora.status).toBeGreaterThanOrEqual(400);
      expect(visitante.status).toBeGreaterThanOrEqual(400);
      expect(Array.isArray(tabela.body) ? (tabela.body as unknown[]).length : 0).toBe(0);
      registrar(
        "financeiro/consultora/visitante",
        "leitura e criação de reservas",
        "financeiro lê, demais negados",
        `ver ${ver.status} / criar ${criar.status} / consultora ${consultora.status} / visitante ${visitante.status}`,
      );
    },
    T,
  );

  it(
    "devolve as unidades usadas na bateria",
    async () => {
      const atual = await saldo();
      const diferenca = base - atual.fisico;
      if (diferenca > 0) {
        const r = await rpc(master(), "register_stock_movement", {
          _kind: "entrada",
          _variant_id: variantId,
          _quantity: diferenca,
          _to_location_id: localA,
          _reason_code: "devolucao",
          _idempotency_key: chave(),
        });
        expect(r.status).toBe(200);
      }
      registrar("master", "limpeza", "saldo físico devolvido", `${atual.fisico} → ${base}`);
    },
    T,
  );
});
