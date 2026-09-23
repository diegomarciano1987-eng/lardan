/**
 * Bateria ISOLADA — cadeia fiscal preparada e desligada.
 *
 * Nenhuma nota é emitida, nenhum provedor é escolhido e nenhuma tributação é
 * adivinhada. A bateria prova que o caminho existe e que ele PARA onde falta
 * definição.
 *
 *   bash tests/isolado/subir.sh && bun test tests/isolado
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { adm, Conta, criarConta, criarVariante, rpc } from "./base";

const um = async <T,>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const recusa = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

let fiscal: Conta, comum: Conta, pessoa: Conta;
let entidade = "", variante = "", origemItem = "", doc = "";
const marca = `ISO-FC-${Date.now().toString(36)}`;

beforeAll(async () => {
  fiscal = await criarConta({ nome: "fiscal-gestor", papeis: ["master"] });
  comum = await criarConta({ nome: "fiscal-consultora", papeis: ["consultora"], comParty: true });
  pessoa = await criarConta({ nome: "fiscal-destinatario", papeis: ["consultora"], comParty: true });
  variante = await criarVariante("fiscal-cadeia");

  entidade = (
    await um<{ id: string }>(
      `insert into public.business_entities (legal_name, trade_name, is_active) values ($1,$1,true) returning id`,
      [`${marca} emissor`],
    )
  ).id;

  const kit = await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [`${marca} maleta`]);
  const ciclo = await um<{ id: string }>(
    `insert into public.kit_cycles (kit_id, cycle_no, consultora_party_id) values ($1,1,$2) returning id`,
    [kit.id, pessoa.partyId],
  );
  const comp = await um<{ id: string }>(
    `insert into public.kit_compositions (cycle_id, version) values ($1,1) returning id`,
    [ciclo.id],
  );
  origemItem = (
    await um<{ id: string }>(
      `insert into public.kit_composition_items (composition_id, variant_id, quantity) values ($1,$2,10) returning id`,
      [comp.id, variante],
    )
  ).id;
});

describe("Preparação e travas", () => {
  it("1. a emissão continua desligada, sem provedor e fora de produção", async () => {
    const s = await um<{ emission_active: boolean; provider: string | null; environment: string }>(
      `select emission_active, provider, environment from public.fiscal_settings`,
    );
    expect(s.emission_active).toBe(false);
    expect(s.provider).toBeNull();
    expect(s.environment).not.toBe("producao");
  });

  it("2. preparar documento exige permissão e devolve as pendências abertas", async () => {
    expect((await rpc(comum, "fiscal_doc_preparar", { _payload: { kind: "remessa" } })).ok).toBe(false);

    const r = await rpc<{ id: string; status: string; pendencias: string[]; aviso: string }>(
      fiscal,
      "fiscal_doc_preparar",
      {
        _payload: {
          kind: "remessa",
          emitter_entity_id: entidade,
          recipient_party_id: pessoa.partyId,
          idempotency_key: `${marca}-doc-1`,
        },
      },
    );
    expect(r.ok).toBe(true);
    expect(r.dados.status).toBe("rascunho");
    expect(r.dados.pendencias.join(" ")).toContain("CFOP");
    expect(r.dados.aviso).toContain("NÃO emitido");
    doc = r.dados.id;
  });

  it("3. a mesma chave devolve o mesmo rascunho, sem duplicar", async () => {
    const r = await rpc<{ id: string; repetida: boolean }>(fiscal, "fiscal_doc_preparar", {
      _payload: {
        kind: "remessa",
        emitter_entity_id: entidade,
        recipient_party_id: pessoa.partyId,
        idempotency_key: `${marca}-doc-1`,
      },
    });
    expect(r.dados.repetida).toBe(true);
    expect(r.dados.id).toBe(doc);
  });

  it("4. item sem origem comprovada é recusado; com origem é aceito", async () => {
    expect(
      await recusa(() =>
        adm.unsafe(`insert into public.fiscal_document_items (document_id, variant_id, quantity) values ($1,$2,1)`, [
          doc,
          variante,
        ]),
      ),
    ).toBe(true);

    await adm.unsafe(
      `insert into public.fiscal_document_items (document_id, variant_id, quantity, composition_item_id)
       values ($1,$2,4,$3)`,
      [doc, variante, origemItem],
    );
    expect(
      (await um<{ n: number }>(`select count(*)::int n from public.fiscal_document_items where document_id = $1`, [doc]))
        .n,
    ).toBe(1);
  });

  it("5. o documento não fatura mais do que a origem comprova", async () => {
    expect(
      await recusa(() =>
        adm.unsafe(
          `insert into public.fiscal_document_items (document_id, variant_id, quantity, composition_item_id)
           values ($1,$2,50,$3)`,
          [doc, variante, origemItem],
        ),
      ),
    ).toBe(true);
  });

  it("6. validar não aprova tributação por suposição", async () => {
    const r = await rpc<{ status: string; pendencias: string[] }>(fiscal, "fiscal_doc_validar", { _doc: doc });
    expect(r.ok).toBe(true);
    expect(r.dados.status).toBe("bloqueado_pendencia");
    expect(r.dados.pendencias.join(" ")).toContain("CFOP");
  });

  it("7. sem validação e com emissão desligada nada entra na fila", async () => {
    const r = await rpc(fiscal, "fiscal_doc_enfileirar", { _doc: doc });
    expect(r.ok).toBe(false);
  });

  it("8. resposta simulada nunca vira autorização", async () => {
    const t = await rpc<{ simulado: boolean }>(fiscal, "fiscal_doc_registrar_retorno", {
      _doc: doc,
      _status: "erro",
      _payload: { motivo: "simulação local" },
    });
    if (!t.ok) console.log("ERRO8:", t.erro);
    expect(t.ok).toBe(true);
    expect(t.dados.simulado).toBe(true);

    const a = await rpc(fiscal, "fiscal_doc_autorizar", {
      _doc: doc,
      _access_key: "0".repeat(44),
      _protocol: "simulado",
    });
    expect(a.ok).toBe(false);
    expect(String(a.erro)).toContain("simulada");

    expect(
      (await um<{ status: string }>(`select status from public.fiscal_documents where id = $1`, [doc])).status,
    ).not.toBe("autorizado");
  });

  it("9. escrita direta em documento e em histórico é recusada", async () => {
    expect(
      await recusa(() => adm.unsafe(`insert into public.fiscal_documents (kind) values ('venda')`)),
    ).toBe(true);
    expect(
      await recusa(() => adm.unsafe(`delete from public.fiscal_document_events where document_id = $1`, [doc])),
    ).toBe(true);
  });

  it("10. a cadeia fiscal não gera título, parcela, liquidação nem cobrança", async () => {
    const n = await um<Record<string, string>>(
      `select (select count(*) from public.financial_titles) t,
              (select count(*) from public.financial_installments) p,
              (select count(*) from public.financial_settlements) l,
              (select count(*) from public.asaas_charges) c`,
    );
    await rpc(fiscal, "fiscal_doc_validar", { _doc: doc });
    const d = await um<Record<string, string>>(
      `select (select count(*) from public.financial_titles) t,
              (select count(*) from public.financial_installments) p,
              (select count(*) from public.financial_settlements) l,
              (select count(*) from public.asaas_charges) c`,
    );
    expect(d).toEqual(n);
  });

  it("11. o histórico registra cada passo e é legível pela rotina oficial", async () => {
    const h = await rpc<{ eventos: unknown[] }>(fiscal, "fiscal_doc_historico", { _doc: doc });
    expect(h.ok).toBe(true);
    expect(h.dados.eventos.length).toBeGreaterThan(2);
  });

  it("12. nenhuma rotina do banco conhece endereço de provedor fiscal", async () => {
    const r = (await adm.unsafe(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'fiscal%'
          and (p.prosrc ilike '%https://%' or p.prosrc ilike '%net.http%' or p.prosrc ilike '%http_post%')`,
    )) as { proname: string }[];
    expect(r).toEqual([]);
  });
});
