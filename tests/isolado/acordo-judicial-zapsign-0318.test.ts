import { beforeAll, expect, test } from "bun:test";
import { adm, criarConta, rpc, rpcServico as rpcServicoBase, type Conta } from "./base";

// rotinas "somente servidor" (fiscal_focus_exigir_servidor) leem lardan.test_role na bancada
async function servidor<T = unknown>(fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; dados: T; erro: string | null }> {
  const c = await adm.reserve();
  try {
    await c.unsafe(`set role service_role`);
    await c.unsafe(`select set_config('lardan.test_role','service_role',false), set_config('lardan.test_uid','',false), set_config('request.jwt.claims','',false)`);
    const nomes = Object.keys(args);
    const r = (await c.unsafe(`select public.${fn}(${nomes.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, nomes.map((n) => { const v = args[n]; return v !== null && typeof v === "object" ? JSON.stringify(v) : v; }))) as { r: T }[];
    return { ok: true, dados: r[0]!.r, erro: null };
  } catch (e) {
    return { ok: false, dados: null as T, erro: (e as Error).message };
  } finally {
    try { await c.unsafe(`reset role`); await c.unsafe(`select set_config('lardan.test_role','',false)`); } catch { /* */ }
    c.release();
  }
}

// 0318 — acordo judicial vai para assinatura pela ZapSign a partir do PDF da minuta anexada.
let master: Conta, larissa: Conta, consultora: Conta, outraPessoa: Conta;
let acordo: string, pdf: string, foto: string, pdfOutra: string;
const um = async <T>(sql: string, params: unknown[] = []) => {
  const rows = await adm.unsafe(sql, params) as T[];
  if (!rows[0]) throw new Error("Cenário não criado");
  return rows[0];
};
const registrar = (extra: Record<string, unknown>) => servidor<{ id: string }>("assinatura_registrar", { _d: {
  ambiente: "sandbox", tipo: "acordo_judicial", party_id: larissa.partyId, cycle_id: "", rep: "", simulacao_id: "",
  judicial_acordo_id: acordo, judicial_doc_id: pdf, signer_token: "s", sign_url: "https://app.zapsign.com.br/verificar/x",
  status: "pendente", titulo: "Acordo judicial ISO", texto_hash: "h", valor_cents: "469545", whatsapp: true, ator: larissa.uid,
  assinantes: [{ papel: "devedora", nome: "ISO", whatsapp: true, email: true }], ...extra,
} });

beforeAll(async () => {
  master = await criarConta({ nome: "master-acjud", papeis: ["master"], comParty: true });
  larissa = await criarConta({ nome: "larissa-acjud", papeis: ["financeiro", "cobranca"], comParty: true });
  consultora = await criarConta({ nome: "cons-acjud", papeis: ["consultora"] });
  outraPessoa = await criarConta({ nome: "outra-acjud", papeis: ["consultora"], comParty: true });
  expect((await rpcServicoBase("access_financial_full_set", { _user: larissa.uid, _enabled: true, _actor: master.uid, _reason: "Autorização de acesso completo" })).ok).toBe(true);
  await adm.unsafe("update parties set doc='529.982.247-25' where id=$1", [larissa.partyId]);
  await adm.unsafe("insert into contact_points(party_id,kind,value,is_primary) values($1,'whatsapp','+5543996087837',true)", [larissa.partyId]);
  const t = await rpc<string>(larissa, "fin_title_create", { _payload: { direction: "receivable", party_id: larissa.partyId, descricao: "ISO dívida judicial", valor_cents: 395133, parcelas: [{ vencimento: "2026-01-10", valor_cents: 395133 }] } });
  expect(t.ok).toBe(true);
  const parcela = (await um<{ id: string }>("select id from financial_installments where title_id=$1", [t.dados])).id;
  expect((await rpc(larissa, "cob_judicial_encaminhar", { _party: larissa.partyId, _d: { processo: "0004034-47.2025.8.16.0090" } })).ok).toBe(true);
  // Plano da Érica: alvará R$ 795,45 + entrada R$ 500 + 10x R$ 340 = R$ 4.695,45
  const plano = [{ numero: 1, data: "2026-11-13", valor_cents: 79545, asaas: false, alvara: true }, { numero: 2, data: "2026-12-17", valor_cents: 50000, asaas: true, alvara: false },
    ...Array.from({ length: 10 }, (_, i) => ({ numero: i + 3, data: `2027-${String(i + 1).padStart(2, "0")}-17`, valor_cents: 34000, asaas: true, alvara: false }))];
  const ac = await rpc<string>(larissa, "cob_judicial_acordo_salvar", { _party: larissa.partyId, _d: { data_acordo: "2026-11-13", installment_ids: [parcela], total_cents: 469545, plano } });
  expect(ac.ok).toBe(true); acordo = ac.dados;
  const doc = (tipo: string, party: string, ct: string, n: string) => rpc<string>(larissa, "cob_judicial_doc_registrar", { _d: { party_id: party, tipo, titulo: n, storage_path: `judicial/${party}/${acordo}-${n}`, file_name: n, content_type: ct } });
  pdf = (await doc("minuta_acordo", larissa.partyId, "application/pdf", "minuta.pdf")).dados;
  foto = (await doc("outro", larissa.partyId, "image/jpeg", "foto.jpg")).dados;
  pdfOutra = (await doc("minuta_acordo", outraPessoa.partyId, "application/pdf", "outra.pdf")).dados;
});

test("Asaas recebe só entrada + 10 parcelas (R$ 3.900), sem o alvará de R$ 795,45", async () => {
  const s = await um<{ plano: unknown[]; total_cents: string }>("select s.plano,s.total_cents from cob_simulacoes s join cob_judicial_acordos a on a.simulacao_id=s.id where a.id=$1", [acordo]);
  expect(s.plano.length).toBe(11); expect(Number(s.total_cents)).toBe(390000);
});

test("quem cobra recebe os dados do PDF; consultora, foto e PDF de outra pessoa são negados", async () => {
  const d = await rpc<{ pendencias: string[]; doc: { id: string }; signer: { whatsapp: string }; processo: string; total_cents: number }>(larissa, "cob_judicial_assinatura_dados", { _acordo: acordo, _doc: pdf });
  expect(d.ok).toBe(true);
  expect(d.dados.pendencias).toEqual([]);
  expect(d.dados.doc.id).toBe(pdf);
  expect(d.dados.signer.whatsapp).toBe("5543996087837");
  expect(d.dados.processo).toBe("0004034-47.2025.8.16.0090");
  expect(Number(d.dados.total_cents)).toBe(469545);
  expect((await rpc(consultora, "cob_judicial_assinatura_dados", { _acordo: acordo, _doc: pdf })).ok).toBe(false);
  expect((await rpc(larissa, "cob_judicial_assinatura_dados", { _acordo: acordo, _doc: foto })).ok).toBe(false);
  expect((await rpc(larissa, "cob_judicial_assinatura_dados", { _acordo: acordo, _doc: pdfOutra })).ok).toBe(false);
});

test("registro só pelo servidor, um link pendente por acordo e reenvio recusa o link antigo na ZapSign", async () => {
  expect((await rpc(larissa, "assinatura_registrar", { _d: { tipo: "acordo_judicial" } })).ok).toBe(false);
  const a = await registrar({ doc_token: `iso-acjud-1-${acordo}` });
  expect(a.ok).toBe(true);
  expect((await registrar({ doc_token: `iso-acjud-dup-${acordo}` })).ok).toBe(false);
  const b = await registrar({ doc_token: `iso-acjud-2-${acordo}`, substitui: a.dados.id });
  expect(b.ok).toBe(true);
  const velho = await um<{ status: string; cancelar: boolean; invalidada: boolean }>("select status, zapsign_cancelar_em is not null cancelar, invalidada_em is not null invalidada from assinaturas_digitais where id=$1", [a.dados.id]);
  expect(velho).toEqual({ status: "cancelado", cancelar: true, invalidada: true });
  const lista = await rpc<{ id: string; status: string; sign_url: string | null }[]>(larissa, "cob_judicial_assinaturas", { _party: larissa.partyId });
  expect(lista.dados.filter((x) => x.status === "pendente").map((x) => x.id)).toEqual([b.dados.id]);
  expect((await rpc(consultora, "cob_judicial_assinaturas", { _party: larissa.partyId })).ok).toBe(false);
  expect((await servidor("assinatura_registrar", { _d: { ambiente: "sandbox", tipo: "acordo_judicial", party_id: larissa.partyId, doc_token: `iso-sem-vinculo-${acordo}`, titulo: "x", texto_hash: "h" } })).ok).toBe(false);
});

test("assinatura que volta da ZapSign vira 'assinado' e entra no histórico da cobrança; nunca regride", async () => {
  const tk = `iso-acjud-2-${acordo}`;
  expect((await servidor("assinatura_retorno", { _doc_token: tk, _status: "signed", _assinado_em: "2026-11-14T10:00:00Z" })).ok).toBe(true);
  expect((await servidor("assinatura_retorno", { _doc_token: tk, _status: "refused", _assinado_em: null })).ok).toBe(true);
  expect((await um<{ status: string }>("select status from assinaturas_digitais where doc_token=$1", [tk])).status).toBe("assinado");
  const n = await um<{ n: string }>("select count(*) n from cob_interacoes where party_id=$1 and observacao like 'Acordo judicial assinado na ZapSign%'", [larissa.partyId]);
  expect(Number(n.n)).toBe(1);
  // com o acordo assinado, um novo envio só é possível pedindo reenvio — nada pendente sobra
  expect((await registrar({ doc_token: `iso-acjud-3-${acordo}` })).ok).toBe(true);
});

test("cancelar o acordo judicial cancela o link pendente e manda recusar na ZapSign", async () => {
  expect((await rpc(larissa, "cob_judicial_acordo_status", { _id: acordo, _status: "cancelado", _motivo: "Teste isolado" })).ok).toBe(true);
  const p = await um<{ status: string; cancelar: boolean }>("select status, zapsign_cancelar_em is not null cancelar from assinaturas_digitais where doc_token=$1", [`iso-acjud-3-${acordo}`]);
  expect(p).toEqual({ status: "cancelado", cancelar: true });
  expect((await um<{ status: string }>("select status from assinaturas_digitais where doc_token=$1", [`iso-acjud-2-${acordo}`])).status).toBe("assinado");
  expect((await rpc(larissa, "cob_judicial_assinatura_dados", { _acordo: acordo, _doc: pdf })).ok).toBe(false);
});
