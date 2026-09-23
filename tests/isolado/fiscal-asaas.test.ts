/**
 * Bateria ISOLADA — fiscal e Asaas continuam inertes, e o financeiro existente
 * é o que receberá os recebíveis (sem estrutura paralela e sem duplicar nada
 * numa importação repetida).
 *
 * Roda no Postgres local criado por `tests/isolado/subir.sh`, com dados
 * exclusivamente sintéticos. Nenhuma credencial e nenhuma linha da base
 * compartilhada são usadas. Tudo aqui é simulação declarada: as linhas de
 * Asaas nascem de INSERTs locais, nunca de chamada externa.
 *
 *   bash tests/isolado/subir.sh && bun test tests/isolado
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { adm, Conta, criarConta, criarVariante } from "./base";

const um = async <T,>(sql: string, params: unknown[] = []) => ((await adm.unsafe(sql, params)) as T[])[0]!;
const conta = async (sql: string, params: unknown[] = []) =>
  (await um<{ n: number }>(sql, params)).n;

let pessoa: Conta;
let entidade = "";
let contaFin = "";
let contaAsaas = "";
let variante = "";
let origemItem = "";
const marca = `ISO-FA-${Date.now().toString(36)}`;

beforeAll(async () => {
  pessoa = await criarConta({ nome: "cliente-fiscal", papeis: ["consultora"], comParty: true });
  variante = await criarVariante("fiscal");

  entidade = (
    await um<{ id: string }>(
      `insert into public.business_entities (legal_name, trade_name, is_active)
       values ($1, $1, true) returning id`,
      [`${marca} entidade`],
    )
  ).id;

  contaFin = (
    await um<{ id: string }>(
      `insert into public.financial_accounts (business_entity_id, nome, kind)
       values ($1, $2, 'provedor') returning id`,
      [entidade, `${marca} conta`],
    )
  ).id;

  contaAsaas = (
    await um<{ id: string }>(
      `insert into public.asaas_accounts (label, environment) values ($1, 'sandbox') returning id`,
      [`${marca} asaas`],
    )
  ).id;

  // origem sintética para os itens fiscais: maleta, ciclo e composição
  const kit = await um<{ id: string }>(`insert into public.kits (label) values ($1) returning id`, [
    `${marca} maleta`,
  ]);
  const ciclo = await um<{ id: string }>(
    `insert into public.kit_cycles (kit_id, cycle_no, consultora_party_id) values ($1, 1, $2) returning id`,
    [kit.id, pessoa.partyId],
  );
  const comp = await um<{ id: string }>(
    `insert into public.kit_compositions (cycle_id, version) values ($1, 1) returning id`,
    [ciclo.id],
  );
  origemItem = (
    await um<{ id: string }>(
      `insert into public.kit_composition_items (composition_id, variant_id, quantity)
       values ($1, $2, 50) returning id`,
      [comp.id, variante],
    )
  ).id;
});

afterAll(() => {
  // a conexão é compartilhada pelas baterias do mesmo processo: não é encerrada aqui
});

/* ------------------------------------------------------------------ fiscal */
describe("Fiscal inerte", () => {
  it("1. a emissão nasce desligada, sem provedor, emissor nem ambiente", async () => {
    const s = await um<{
      emission_active: boolean;
      provider: string | null;
      emitter_entity_id: string | null;
      environment: string;
    }>(`select emission_active, provider, emitter_entity_id, environment from public.fiscal_settings`);
    expect(s.emission_active).toBe(false);
    expect(s.provider).toBeNull();
    expect(s.emitter_entity_id).toBeNull();
    expect(s.environment).toBe("nenhum");
  });

  it("2. nenhum documento sai da preparação enquanto a emissão estiver desligada", async () => {
    const d = await um<{ id: string; status: string }>(
      `insert into public.fiscal_documents (kind, recipient_party_id) values ('remessa', $1)
       returning id, status`,
      [pessoa.partyId],
    );
    expect(d.status).toBe("preparacao");

    for (const alvo of ["enviado", "autorizado", "cancelado"]) {
      let recusado = false;
      try {
        await adm.unsafe(`update public.fiscal_documents set status = $2 where id = $1`, [d.id, alvo]);
      } catch {
        recusado = true;
      }
      expect(recusado).toBe(true);
    }

    const depois = await um<{ status: string }>(`select status from public.fiscal_documents where id = $1`, [d.id]);
    expect(depois.status).toBe("preparacao");
  });

  it("3. devolução simbólica não movimenta estoque físico", async () => {
    const antes = await conta(`select count(*)::int as n from public.stock_movements`);
    const d = await um<{ id: string; moves_physical_stock: boolean }>(
      `insert into public.fiscal_documents (kind, recipient_party_id, moves_physical_stock)
       values ('devolucao_simbolica', $1, true) returning id, moves_physical_stock`,
      [pessoa.partyId],
    );
    expect(d.moves_physical_stock).toBe(false);

    await adm.unsafe(
      `insert into public.fiscal_document_items (document_id, variant_id, quantity, composition_item_id)
       values ($1, $2, 7, $3)`,
      [d.id, variante, origemItem],
    );
    expect(await conta(`select count(*)::int as n from public.stock_movements`)).toBe(antes);
    expect(await conta(`select count(*)::int as n from public.stock_balances where variant_id = $1`, [variante])).toBe(
      0,
    );
  });

  it("4. documento fiscal não gera título, parcela nem liquidação", async () => {
    const t = await conta(`select count(*)::int as n from public.financial_titles`);
    const p = await conta(`select count(*)::int as n from public.financial_installments`);
    const l = await conta(`select count(*)::int as n from public.financial_settlements`);

    const d = await um<{ id: string }>(
      `insert into public.fiscal_documents (kind, recipient_party_id, debtor_party_id, total_cents)
       values ('venda', $1, $1, 123456) returning id`,
      [pessoa.partyId],
    );
    await adm.unsafe(
      `insert into public.fiscal_document_items (document_id, variant_id, quantity, unit_value_cents, composition_item_id)
       values ($1, $2, 2, 61728, $3)`,
      [d.id, variante, origemItem],
    );

    expect(await conta(`select count(*)::int as n from public.financial_titles`)).toBe(t);
    expect(await conta(`select count(*)::int as n from public.financial_installments`)).toBe(p);
    expect(await conta(`select count(*)::int as n from public.financial_settlements`)).toBe(l);
  });

  it("5. documento autorizado não volta atrás — o caminho é o cancelamento", async () => {
    // simulação declarada: a emissão é ligada só dentro deste teste e desligada ao fim
    await adm.unsafe(`update public.fiscal_settings set emission_active = true`);
    try {
      const d = await um<{ id: string }>(
        `insert into public.fiscal_documents (kind, recipient_party_id) values ('remessa', $1) returning id`,
        [pessoa.partyId],
      );
      await adm.unsafe(`update public.fiscal_documents set status = 'autorizado' where id = $1`, [d.id]);

      for (const alvo of ["preparacao", "enviado", "rejeitado"]) {
        let recusado = false;
        try {
          await adm.unsafe(`update public.fiscal_documents set status = $2 where id = $1`, [d.id, alvo]);
        } catch {
          recusado = true;
        }
        expect(recusado).toBe(true);
      }
      await adm.unsafe(`update public.fiscal_documents set status = 'cancelado' where id = $1`, [d.id]);
      expect((await um<{ status: string }>(`select status from public.fiscal_documents where id = $1`, [d.id])).status)
        .toBe("cancelado");
    } finally {
      await adm.unsafe(`update public.fiscal_settings set emission_active = false`);
    }
    expect(
      (await um<{ emission_active: boolean }>(`select emission_active from public.fiscal_settings`)).emission_active,
    ).toBe(false);
  });

  it("6. não existe caminho para chamada externa: sem extensão de rede, sem agendador, sem endereço em rotina", async () => {
    const rede = await conta(
      `select count(*)::int as n from pg_extension where extname in ('http','pg_net','pg_cron')`,
    );
    expect(rede).toBe(0);

    const rotinas = (await adm.unsafe(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and (p.prosrc ilike '%asaas.com%' or p.prosrc ilike '%net.http%' or p.prosrc ilike '%http_post%'
               or p.prosrc ilike '%http_get%' or p.prosrc ilike '%https://%')`,
    )) as { proname: string }[];
    expect(rotinas.map((r) => r.proname)).toEqual([]);
  });
});

/* ------------------------------------------------------------------- asaas */
describe("Asaas inerte e financeiro reaproveitado", () => {
  it("7. nenhuma conta Asaas nasce ativa e nada é importado sozinho", async () => {
    const c = await um<{ is_active: boolean; cutover_date: string | null; opening_balance_handled: boolean }>(
      `select is_active, cutover_date, opening_balance_handled from public.asaas_accounts where id = $1`,
      [contaAsaas],
    );
    expect(c.is_active).toBe(false);
    expect(c.cutover_date).toBeNull();
    expect(c.opening_balance_handled).toBe(false);

    expect(await conta(`select count(*)::int as n from public.asaas_charges where account_id = $1`, [contaAsaas])).toBe(
      0,
    );
    expect(await conta(`select count(*)::int as n from public.asaas_events where account_id = $1`, [contaAsaas])).toBe(
      0,
    );
    expect(
      await conta(`select count(*)::int as n from public.asaas_import_runs where account_id = $1`, [contaAsaas]),
    ).toBe(0);
  });

  it("8. cobrança não vira 'vinculada' sem título ou parcela comprovada", async () => {
    let recusado = false;
    try {
      await adm.unsafe(
        `insert into public.asaas_charges (account_id, external_id, value_cents, reconcile_status)
         values ($1, $2, 1000, 'vinculado')`,
        [contaAsaas, `${marca}-sem-vinculo`],
      );
    } catch {
      recusado = true;
    }
    expect(recusado).toBe(true);
  });

  it("9. cobrança importada não cria título, parcela nem liquidação por si", async () => {
    const t = await conta(`select count(*)::int as n from public.financial_titles`);
    const l = await conta(`select count(*)::int as n from public.financial_settlements`);

    await adm.unsafe(
      `insert into public.asaas_charges
         (account_id, external_id, value_cents, received_cents, fee_cents, payment_date, external_status)
       values ($1, $2, 25000, 24500, 500, current_date, 'RECEIVED')`,
      [contaAsaas, `${marca}-pay-1`],
    );

    expect(await conta(`select count(*)::int as n from public.financial_titles`)).toBe(t);
    expect(await conta(`select count(*)::int as n from public.financial_settlements`)).toBe(l);
    expect(
      (
        await um<{ reconcile_status: string; title_id: string | null }>(
          `select reconcile_status, title_id from public.asaas_charges where account_id = $1 and external_id = $2`,
          [contaAsaas, `${marca}-pay-1`],
        )
      ).reconcile_status,
    ).toBe("pendente");
  });

  it("10. importação repetida não duplica cobrança, título, parcela nem liquidação", async () => {
    const externo = `${marca}-rep-1`;

    /** Simulação local de uma rodada de importação, repetível por construção. */
    async function importar() {
      await adm.unsafe(
        `insert into public.asaas_charges (account_id, external_id, value_cents, received_cents, payment_date)
         values ($1, $2, 50000, 50000, current_date)
         on conflict (account_id, external_id) do update
            set value_cents = excluded.value_cents,
                received_cents = excluded.received_cents,
                payment_date = excluded.payment_date`,
        [contaAsaas, externo],
      );
      const titulo = await um<{ id: string }>(
        `insert into public.financial_titles
           (direction, business_entity_id, party_id, descricao, valor_cents, origem, sistema_origem, id_externo)
         values ('receivable', $1, $2, $3, 50000, 'importacao', 'asaas', $4)
         on conflict (sistema_origem, id_externo) where sistema_origem is not null and id_externo is not null
         do update set valor_cents = excluded.valor_cents
         returning id`,
        [entidade, pessoa.partyId, `${marca} recebível simulado`, externo],
      );
      await adm.unsafe(
        `insert into public.financial_installments (title_id, numero, total_parcelas, vencimento, valor_cents)
         select $1, 1, 1, current_date, 50000
          where not exists (select 1 from public.financial_installments where title_id = $1 and numero = 1)`,
        [titulo.id],
      );
      await adm.unsafe(
        `insert into public.financial_settlements
           (direction, financial_account_id, valor_cents, referencia, idempotency_key)
         values ('receivable', $1, 50000, $2, $3)
         on conflict (idempotency_key) where idempotency_key is not null do nothing`,
        [contaFin, externo, `asaas:${contaAsaas}:${externo}`],
      );
      return titulo.id;
    }

    const primeiro = await importar();
    const segundo = await importar();
    const terceiro = await importar();
    expect(segundo).toBe(primeiro);
    expect(terceiro).toBe(primeiro);

    expect(
      await conta(`select count(*)::int as n from public.asaas_charges where account_id = $1 and external_id = $2`, [
        contaAsaas,
        externo,
      ]),
    ).toBe(1);
    expect(
      await conta(`select count(*)::int as n from public.financial_titles where sistema_origem = 'asaas' and id_externo = $1`, [
        externo,
      ]),
    ).toBe(1);
    expect(await conta(`select count(*)::int as n from public.financial_installments where title_id = $1`, [primeiro])).toBe(
      1,
    );
    expect(
      await conta(`select count(*)::int as n from public.financial_settlements where idempotency_key = $1`, [
        `asaas:${contaAsaas}:${externo}`,
      ]),
    ).toBe(1);
  });

  it("11. evento repetido do provedor entra uma única vez na fila e não é processado sozinho", async () => {
    const ev = `${marca}-evt-1`;
    for (let i = 0; i < 3; i++) {
      await adm.unsafe(
        `insert into public.asaas_events (account_id, external_id, event, charge_external_id, payload)
         values ($1, $2, 'PAYMENT_RECEIVED', $3, '{}'::jsonb)
         on conflict (account_id, external_id) do nothing`,
        [contaAsaas, ev, `${marca}-pay-1`],
      );
    }
    const linha = await um<{ n: number; status: string; processed_at: string | null; attempts: number }>(
      `select count(*)::int as n, min(status) as status, min(processed_at) as processed_at, min(attempts) as attempts
         from public.asaas_events where external_id = $1`,
      [ev],
    );
    expect(linha.n).toBe(1);
    expect(linha.status).toBe("na_fila");
    expect(linha.processed_at).toBeNull();
    expect(linha.attempts).toBe(0);
  });

  it("12. cobrança não se liga a maleta por suposição: não existe vínculo automático", async () => {
    const colunas = (await adm.unsafe(
      `select column_name from information_schema.columns
        where table_name = 'asaas_charges' and column_name in ('cycle_id','kit_id')`,
    )) as { column_name: string }[];
    expect(colunas).toEqual([]);

    const pendentes = await conta(
      `select count(*)::int as n from public.asaas_charges
        where account_id = $1 and reconcile_status = 'pendente' and title_id is null and installment_id is null`,
      [contaAsaas],
    );
    expect(pendentes).toBeGreaterThan(0);
  });

  it("13. cliente Asaas não é unido a pessoa por nome", async () => {
    const c = await um<{ party_id: string | null; match_status: string }>(
      `insert into public.asaas_customers (account_id, external_id, name)
       values ($1, $2, $3) returning party_id, match_status`,
      [contaAsaas, `${marca}-cli-1`, pessoa.nome],
    );
    expect(c.party_id).toBeNull();
    expect(c.match_status).toBe("pendente");
  });
});
