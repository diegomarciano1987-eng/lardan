/**
 * Bateria ISOLADA — assinatura Clicksign do termo de recebimento da maleta.
 * Dados sintéticos; a Clicksign não é chamada (os avisos são simulados aqui, só na bancada).
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { adm, Conta, criarConta, criarDeposito, criarVariante, porEstoque, rpc, rpcServico } from "./base";

const ex = Date.now().toString(36);
const chave = (s: string) => `cs-${ex}-${s}`;
let matriz: Conta, rep: Conta, cons: Conta, outra: Conta;
let dep = "", v1 = "", v2 = "";

const modo = (m: string) => adm.unsafe(`update public.clicksign_settings set modo = $1 where id = 1`, [m]);

async function cicloRecebido(consultora: Conta) {
  const c = await rpc<{ cycle_id: string }>(matriz, "kit_cycle_create", {
    _payload: { origin_location_id: dep, consultora_party_id: consultora.partyId, representante_party_id: rep.partyId },
  });
  if (!c.ok) throw new Error(c.erro);
  const id = c.dados.cycle_id;
  await rpc(matriz, "kit_item_upsert", { _cycle: id, _variant: v1, _qty: 10 });
  await rpc(matriz, "kit_item_upsert", { _cycle: id, _variant: v2, _qty: 5 });
  await rpc(matriz, "kit_conferir", { _cycle: id, _note: null });
  const e = await rpc(matriz, "kit_expedir", { _cycle: id, _payload: { rota: "direta" } });
  if (!e.ok) throw new Error(e.erro);
  const t = (await adm.unsafe(`select id from public.kit_transfers where cycle_id=$1 order by seq limit 1`, [id])) as { id: string }[];
  const r = await rpc(consultora, "kit_transfer_confirm", { _transfer: t[0]!.id, _payload: {} });
  if (!r.ok) throw new Error(r.erro);
  return id;
}
const itens = () => [
  { variant_id: v1, qty_accepted: 10, qty_divergent: 0 },
  { variant_id: v2, qty_accepted: 4, qty_divergent: 1, tipo_divergencia: "defeito", motivo: "fecho quebrado" },
];
const aceitas = async (ciclo: string) =>
  ((await adm.unsafe(`select coalesce(sum(qty_accepted),0)::int n from public.kit_balances where cycle_id=$1`, [ciclo])) as { n: number }[])[0]!.n;
const situacao = async (ciclo: string) =>
  ((await adm.unsafe(`select status from public.kit_cycles where id=$1`, [ciclo])) as { status: string }[])[0]!.status;

beforeAll(async () => {
  matriz = await criarConta({ nome: "cs-matriz", papeis: ["master"] });
  rep = await criarConta({ nome: "cs-rep", papeis: ["representante"], comParty: true });
  cons = await criarConta({ nome: "cs-cons", papeis: ["consultora"], comParty: true });
  outra = await criarConta({ nome: "cs-outra", papeis: ["consultora"], comParty: true });
  dep = await criarDeposito("cs");
  v1 = await criarVariante("cs1");
  v2 = await criarVariante("cs2");
  await porEstoque(v1, dep, 200);
  await porEstoque(v2, dep, 200);
});
afterAll(async () => {
  await modo("desligado");
});

describe("Clicksign — termo de recebimento", () => {
  it("modo desligado: aceite atual segue igual e não dá para gerar termo", async () => {
    await modo("desligado");
    const c = await cicloRecebido(cons);
    const p = await rpc(cons, "kit_assinatura_preparar", { _cycle: c, _itens: itens(), _idempotency_key: chave("d") });
    expect(p.ok).toBe(false);
    const a = await rpc(cons, "kit_aceitar", { _cycle: c, _itens: itens(), _idempotency_key: chave("da") });
    expect(a.ok).toBe(true);
    expect(await situacao(c)).toBe("operacao");
  });

  let ciclo = "", req = "";
  it("modo sandbox: aceite direto é recusado pelo banco, inclusive para a gestão", async () => {
    await modo("sandbox");
    ciclo = await cicloRecebido(cons);
    const a = await rpc(cons, "kit_aceitar", { _cycle: ciclo, _itens: itens(), _idempotency_key: chave("sa") });
    expect(a.ok).toBe(false);
    expect(a.erro).toContain("termo de recebimento assinado");
    const g = await rpc(matriz, "kit_aceitar", { _cycle: ciclo, _itens: itens(), _idempotency_key: chave("ga") });
    expect(g.ok).toBe(false);
  });

  it("só a consultora destinatária gera o termo (gestão, representante e outra consultora recusados)", async () => {
    for (const quem of [matriz, rep, outra]) {
      const r = await rpc(quem, "kit_assinatura_preparar", { _cycle: ciclo, _itens: itens(), _idempotency_key: chave("x") });
      expect(r.ok).toBe(false);
    }
  });

  it("conferência guardada com impressão digital, sem liberar saldo; repetição devolve o mesmo", async () => {
    const r = await rpc<{ request_id: string; sha256: string; snapshot: { total_aceito: number; total_divergente: number } }>(
      cons, "kit_assinatura_preparar", { _cycle: ciclo, _itens: itens(), _idempotency_key: chave("p") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    req = r.dados.request_id;
    expect(r.dados.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.dados.snapshot.total_aceito).toBe(14);
    expect(r.dados.snapshot.total_divergente).toBe(1);
    expect(await aceitas(ciclo)).toBe(0);
    expect(await situacao(ciclo)).toBe("recebida");
    const rep2 = await rpc<{ request_id: string; repetida: boolean }>(cons, "kit_assinatura_preparar", { _cycle: ciclo, _itens: itens(), _idempotency_key: chave("p") });
    expect(rep2.ok && rep2.dados.request_id).toBe(req);
  });

  it("rotinas do servidor não podem ser chamadas pelo navegador", async () => {
    const r = await rpc(cons, "kit_assinatura_finalizar", { _request: req, _signed_path: "x", _signed_sha256: "a".repeat(64) });
    expect(r.ok).toBe(false);
    const e = await rpc(cons, "kit_assinatura_evento", { _dedupe: "z", _envelope: "z", _evento: "sign" });
    expect(e.ok).toBe(false);
  });

  it("envio registrado; aviso repetido não tem efeito duplo; não finaliza sem arquivo assinado", async () => {
    const env = await rpcServico(`kit_assinatura_registrar_envio`, {
      _request: req, _payload: { pdf_path: `${ciclo}/${req}/termo.pdf`, pdf_sha256: "b".repeat(64), envelope_id: `env-${ex}`, document_id: "doc", signer_id: "sig" },
    });
    expect(env.ok).toBe(true);
    const ev1 = await rpcServico<{ estado: string }>("kit_assinatura_evento", { _dedupe: `d-${ex}`, _envelope: `env-${ex}`, _evento: "sign" });
    expect(ev1.ok && ev1.dados.estado).toBe("assinado");
    const ev2 = await rpcServico<{ repetido: boolean }>("kit_assinatura_evento", { _dedupe: `d-${ex}`, _envelope: `env-${ex}`, _evento: "sign" });
    expect(ev2.ok && ev2.dados.repetido).toBe(true);
    expect(await situacao(ciclo)).toBe("recebida");
    const semArq = await rpcServico("kit_assinatura_finalizar", { _request: req, _signed_path: "", _signed_sha256: "" });
    expect(semArq.ok).toBe(false);
    expect(await aceitas(ciclo)).toBe(0);
  });

  it("com o arquivo assinado guardado, libera a maleta pelo aceite oficial, como a consultora", async () => {
    const f = await rpcServico<{ estado: string }>("kit_assinatura_finalizar", { _request: req, _signed_path: `${ciclo}/${req}/assinado.pdf`, _signed_sha256: "c".repeat(64) });
    expect(f.ok).toBe(true);
    expect(await situacao(ciclo)).toBe("operacao");
    expect(await aceitas(ciclo)).toBe(14);
    const ac = (await adm.unsafe(`select actor_user_id, kind from public.kit_acceptances where cycle_id=$1`, [ciclo])) as { actor_user_id: string; kind: string }[];
    expect(ac[0]!.actor_user_id).toBe(cons.uid!);
    expect(ac[0]!.kind).toBe("parcial");
    const again = await rpcServico<{ repetida: boolean }>("kit_assinatura_finalizar", { _request: req, _signed_path: "y", _signed_sha256: "d".repeat(64) });
    expect(again.ok && again.dados.repetida).toBe(true);
    const evs = (await adm.unsafe(`select kind from public.kit_events where cycle_id=$1 and kind like 'termo.%' order by created_at`, [ciclo])) as { kind: string }[];
    expect(evs.map((e) => e.kind)).toEqual(expect.arrayContaining(["termo.gerado", "termo.enviado", "termo.assinado", "termo.finalizado"]));
  });

  it("recusa deixa a maleta parada e permite novo termo; o antigo continua guardado", async () => {
    const c = await cicloRecebido(cons);
    const p = await rpc<{ request_id: string }>(cons, "kit_assinatura_preparar", { _cycle: c, _itens: itens(), _idempotency_key: chave("r1") });
    if (!p.ok) throw new Error(p.erro);
    await rpcServico("kit_assinatura_registrar_envio", { _request: p.dados.request_id, _payload: { envelope_id: `envr-${ex}`, pdf_path: "a", pdf_sha256: "e".repeat(64) } });
    const bloq = await rpc(cons, "kit_assinatura_preparar", { _cycle: c, _itens: itens(), _idempotency_key: chave("r1b") });
    expect(bloq.ok).toBe(false);
    await rpcServico("kit_assinatura_evento", { _dedupe: `r-${ex}`, _envelope: `envr-${ex}`, _evento: "refusal" });
    expect(await situacao(c)).toBe("recebida");
    const novo = await rpc(cons, "kit_assinatura_preparar", { _cycle: c, _itens: itens(), _idempotency_key: chave("r2") });
    expect(novo.ok).toBe(true);
    const n = (await adm.unsafe(`select count(*)::int n from public.kit_signature_requests where cycle_id=$1`, [c])) as { n: number }[];
    expect(n[0]!.n).toBe(2);
  });

  it("outra consultora não vê a situação do termo; produção bloqueada sem texto aprovado", async () => {
    const s = await rpc(outra, "kit_assinatura_situacao", { _cycle: ciclo });
    expect(s.ok).toBe(false);
    const ok = await rpc<{ termos: unknown[] }>(cons, "kit_assinatura_situacao", { _cycle: ciclo });
    expect(ok.ok && ok.dados.termos.length).toBe(1);
    const p = await rpc(matriz, "clicksign_modo_definir", { _modo: "producao" });
    expect(p.ok).toBe(false);
    const naoMaster = await rpc(cons, "clicksign_modo_definir", { _modo: "desligado" });
    expect(naoMaster.ok).toBe(false);
  });
});
