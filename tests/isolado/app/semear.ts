/**
 * Cenário SINTÉTICO da demonstração no navegador isolado.
 * Contas: demo.diretoria / demo.financeiro / demo.consultora @lardan.test (senha local iso-demo).
 * Nada daqui existe fora do Postgres descartável do isolado.
 */
import { adm, criarConta, rpc } from "../base";
import { writeFileSync } from "node:fs";

async function main() {
  const contas = {
    diretoria: await criarConta({ nome: "diretoria", papeis: ["diretoria"], comParty: true }),
    financeiro: await criarConta({ nome: "financeiro", papeis: ["financeiro"], comParty: true }),
    consultora: await criarConta({ nome: "consultora", papeis: ["consultora"], comParty: true }),
  };
  for (const [nome, c] of Object.entries(contas)) {
    await adm.unsafe(`update auth.users set email = $2 where id = $1`, [c.uid, `demo.${nome}@lardan.test`]);
    await adm.unsafe(`update public.profiles set email = $2, full_name = $3 where id = $1`, [c.uid, `demo.${nome}@lardan.test`, `Demo ${nome}`]);
  }
  const [e] = (await adm.unsafe(
    `insert into public.business_entities (legal_name, trade_name) values ('ISO Empresa Demonstração','ISO Demo') returning id`,
  )) as { id: string }[];
  const [a] = (await adm.unsafe(
    `insert into public.asaas_accounts (label, environment, state, owner_entity_id, opening_balance_strategy, external_account_id)
     values ('ISO Asaas simulado','sandbox','simulada',$1,'ignorar_anteriores','acc_demo') returning id`,
    [e!.id],
  )) as { id: string }[];
  const [p] = (await adm.unsafe(
    `insert into public.parties (kind, display_name, legal_name, status) values ('pessoa','ISO Cliente Vinculado','ISO Cliente Vinculado','ativo') returning id`,
  )) as { id: string }[];
  const [p2] = (await adm.unsafe(
    `insert into public.parties (kind, display_name, legal_name, status) values ('pessoa','ISO Cliente Revisado','ISO Cliente Revisado','ativo') returning id`,
  )) as { id: string }[];
  await adm.unsafe(
    `insert into public.asaas_customers (account_id, external_id, name, party_id, match_status)
     values ($1,$3,'ISO Cliente Vinculado',$2,'vinculado')`,
    // mesmo identificador que o simulador da conta usa (demo.functions.ts)
    [a!.id, p!.id, `sim_cus_${a!.id.slice(0, 8)}_vinc`],
  );
  const master = await criarConta({ nome: "semeador", papeis: ["master"], comParty: true });
  const titulo = async (valor: number, venc: string, desc: string) => {
    const r = await rpc<string>(master, "fin_title_create", {
      _payload: { direction: "receivable", business_entity_id: e!.id, party_id: p!.id, descricao: desc, valor_cents: valor, emissao: "2026-09-01", origem: "manual", status: "ativo", parcelas: [{ vencimento: venc, valor_cents: valor }] },
    });
    if (!r.ok) throw new Error(r.erro ?? "");
    const ap = await rpc(master, "fin_title_approve", { _title: r.dados, _motivo: "ISO demonstração" });
    if (!ap.ok && !/submetido/.test(ap.erro ?? "")) throw new Error(ap.erro ?? "");
    return r.dados;
  };
  const tDup = await titulo(12345, "2026-10-15", "ISO lançamento manual (possível duplicidade)");
  const tLink = await titulo(25000, "2026-10-30", "ISO título manual para cobrança");
  const tPerda = await titulo(18000, "2026-11-10", "ISO título manual resposta perdida");
  const [fa] = (await adm.unsafe(`select id from public.financial_accounts order by created_at limit 1`)) as { id: string }[];
  const saida = { empresa: e!.id, conta: a!.id, party: p!.id, partyRevisado: p2!.id, titulos: { tDup, tLink, tPerda }, contaFinanceira: fa?.id ?? null };
  writeFileSync("/tmp/lardan-app-iso/demo.json", JSON.stringify(saida, null, 2));
  console.log(JSON.stringify(saida, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
