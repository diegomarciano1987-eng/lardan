/**
 * Bateria ISOLADA — Asaas preparado e inerte.
 *
 * Nenhuma chamada externa acontece aqui: as cobranças e eventos nascem de
 * INSERT locais, declaradamente simulados. O objetivo é provar as travas.
 *
 *   bash tests/isolado/subir.sh && bun test tests/isolado
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { adm, Conta, criarConta, rpc } from "./base";

const um = async <T,>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const recusa = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

let financeiro: Conta, semPermissao: Conta;
let contaSandbox = "", contaProducao = "", entidade = "", titulo = "";
let pessoa: Conta;
const marca = `ISO-AS-${Date.now().toString(36)}`;

beforeAll(async () => {
  financeiro = await criarConta({ nome: "asaas-financeiro", papeis: ["master"] });
  semPermissao = await criarConta({ nome: "asaas-consultora", papeis: ["consultora"], comParty: true });
  pessoa = await criarConta({ nome: "asaas-pagador", papeis: ["consultora"], comParty: true });

  entidade = (
    await um<{ id: string }>(
      `insert into public.business_entities (legal_name, trade_name, is_active) values ($1,$1,true) returning id`,
      [`${marca} entidade`],
    )
  ).id;
  contaSandbox = (
    await um<{ id: string }>(
      `insert into public.asaas_accounts (label, environment, secret_ref) values ($1,'sandbox','ASAAS_SANDBOX_TOKEN') returning id`,
      [`${marca} sandbox`],
    )
  ).id;
  contaProducao = (
    await um<{ id: string }>(
      `insert into public.asaas_accounts (label, environment) values ($1,'producao') returning id`,
      [`${marca} produção`],
    )
  ).id;
  titulo = (
    await um<{ id: string }>(
      `insert into public.financial_titles (direction, business_entity_id, party_id, descricao, valor_cents, origem)
       values ('receivable', $1, $2, $3, 50000, 'manual') returning id`,
      [entidade, pessoa.partyId, `${marca} recebível`],
    )
  ).id;
});

describe("Conta, credencial e ambiente", () => {
  it("1. o cadastro guarda o NOME da variável, nunca o segredo", async () => {
    expect(
      await recusa(() =>
        adm.unsafe(`update public.asaas_accounts set secret_ref = $2 where id = $1`, [
          contaSandbox,
          "$aact_prod_000abc",
        ]),
      ),
    ).toBe(true);
  });

  it("2. conta de produção não pode ser ativada nesta preparação", async () => {
    expect(
      await recusa(() => adm.unsafe(`update public.asaas_accounts set is_active = true where id = $1`, [contaProducao])),
    ).toBe(true);
  });

  it("3. o ambiente da conta não muda depois de criada", async () => {
    expect(
      await recusa(() =>
        adm.unsafe(`update public.asaas_accounts set environment = 'producao' where id = $1`, [contaSandbox]),
      ),
    ).toBe(true);
  });
});

describe("Cobranças e eventos", () => {
  it("4. o mesmo identificador externo em contas diferentes não colide, e repete na mesma conta", async () => {
    const ext = `${marca}-ch-1`;
    for (const c of [contaSandbox, contaProducao]) {
      await adm.unsafe(
        `insert into public.asaas_charges (account_id, external_id, value_cents) values ($1,$2,1000)
         on conflict (account_id, external_id) do nothing`,
        [c, ext],
      );
    }
    const n = await um<{ n: number }>(`select count(*)::int n from public.asaas_charges where external_id = $1`, [ext]);
    expect(n.n).toBe(2);

    await adm.unsafe(
      `insert into public.asaas_charges (account_id, external_id, value_cents) values ($1,$2,1000)
       on conflict (account_id, external_id) do nothing`,
      [contaSandbox, ext],
    );
    expect(
      (await um<{ n: number }>(`select count(*)::int n from public.asaas_charges where external_id = $1`, [ext])).n,
    ).toBe(2);
  });

  it("5. o identificador externo de uma cobrança não muda", async () => {
    expect(
      await recusa(() =>
        adm.unsafe(`update public.asaas_charges set external_id = 'outro' where account_id = $1 and external_id = $2`, [
          contaSandbox,
          `${marca}-ch-1`,
        ]),
      ),
    ).toBe(true);
  });

  it("6. valores incoerentes entre recebido, líquido e tarifa são recusados", async () => {
    expect(
      await recusa(() =>
        adm.unsafe(
          `insert into public.asaas_charges (account_id, external_id, value_cents, received_cents, net_value_cents, fee_cents, payment_date)
           values ($1,$2, 10000, 10000, 9900, 500, current_date)`,
          [contaSandbox, `${marca}-incoerente`],
        ),
      ),
    ).toBe(true);
  });

  it("7. vincular cobrança a título é só pela rotina oficial e com permissão", async () => {
    const c = await um<{ id: string }>(
      `insert into public.asaas_charges (account_id, external_id, value_cents, party_id)
       values ($1,$2,50000,$3) returning id`,
      [contaSandbox, `${marca}-vinc`, pessoa.partyId],
    );

    expect(
      await recusa(() =>
        adm.unsafe(`update public.asaas_charges set title_id = $2, reconcile_status = 'vinculado' where id = $1`, [
          c.id,
          titulo,
        ]),
      ),
    ).toBe(true);

    const negado = await rpc(semPermissao, "asaas_charge_vincular", { _charge: c.id, _title: titulo });
    expect(negado.ok).toBe(false);

    const ok = await rpc<{ repetida: boolean }>(financeiro, "asaas_charge_vincular", {
      _charge: c.id,
      _title: titulo,
      _motivo: "conferido no extrato simulado",
    });
    expect(ok.ok).toBe(true);
    const repetida = await rpc<{ repetida: boolean }>(financeiro, "asaas_charge_vincular", {
      _charge: c.id,
      _title: titulo,
    });
    expect(repetida.dados.repetida).toBe(true);
  });

  it("8. vincular não cria título, parcela nem liquidação", async () => {
    const n = await um<{ t: string; p: string; l: string }>(
      `select (select count(*) from public.financial_titles) t,
              (select count(*) from public.financial_installments) p,
              (select count(*) from public.financial_settlements) l`,
    );
    await rpc(financeiro, "asaas_charge_vincular", {
      _charge: (
        await um<{ id: string }>(`select id from public.asaas_charges where account_id=$1 and external_id=$2`, [
          contaSandbox,
          `${marca}-vinc`,
        ])
      ).id,
      _title: titulo,
    });
    const d = await um<{ t: string; p: string; l: string }>(
      `select (select count(*) from public.financial_titles) t,
              (select count(*) from public.financial_installments) p,
              (select count(*) from public.financial_settlements) l`,
    );
    expect(d).toEqual(n);
  });

  it("9. payload com aparência de credencial não é armazenado", async () => {
    expect(
      await recusa(() =>
        adm.unsafe(
          `insert into public.asaas_charges (account_id, external_id, value_cents, raw)
           values ($1,$2,100,'{"apiKey":"$aact_teste"}'::jsonb)`,
          [contaSandbox, `${marca}-raw`],
        ),
      ),
    ).toBe(true);
  });

  it("10. efetivar importação exige aprovação registrada", async () => {
    expect(
      await recusa(() =>
        adm.unsafe(`insert into public.asaas_import_runs (account_id, mode) values ($1,'efetivar')`, [contaSandbox]),
      ),
    ).toBe(true);

    await adm.unsafe(`insert into public.asaas_import_runs (account_id, mode) values ($1,'previa')`, [contaSandbox]);
  });
});

describe("Dados pessoais", () => {
  it("11. quem só vê recebíveis não enxerga documento nem e-mail", async () => {
    const podeColuna = await um<{ ok: boolean }>(
      `select has_column_privilege('authenticated','public.asaas_customers','doc','select') as ok`,
    );
    expect(podeColuna.ok).toBe(false);
  });

  it("12. leitura de dado pessoal exige permissão e fica registrada", async () => {
    const cli = await um<{ id: string }>(
      `insert into public.asaas_customers (account_id, external_id, name, doc, email)
       values ($1,$2,'Cliente Simulado','00000000000','simulado@exemplo.invalid') returning id`,
      [contaSandbox, `${marca}-cli`],
    );
    expect((await rpc(semPermissao, "asaas_customer_sensivel", { _customer: cli.id })).ok).toBe(false);

    const r = await rpc<{ doc: string }>(financeiro, "asaas_customer_sensivel", { _customer: cli.id });
    expect(r.ok).toBe(true);
    const log = await um<{ n: number }>(
      `select count(*)::int n from public.audit_logs where action = 'asaas.customer.sensivel' and entity_id = $1`,
      [cli.id],
    );
    expect(log.n).toBe(1);
  });
});
