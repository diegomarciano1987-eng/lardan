/**
 * 0369 (Diego, 23/11/2026) — transferência entre contas próprias a partir do extrato. Banco ISOLADO, dados sintéticos.
 *  - Mesa: "Transferência entre contas" cria a transferência oficial (sem título, sem receita/despesa) e confere as duas linhas;
 *  - rotina: pareia sozinha só quando os DOIS extratos citam o CNPJ/razão social da empresa e o par é único;
 *  - valor igual sozinho nunca pareia; par desfeito por uma pessoa nunca é refeito sozinho; desfazer estorna a transferência.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

let financeiro: Conta, estoque: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
let cnpj = "", razao = "", asaas = "", santander = "", itau = "";
const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const dia = (d: number) => new Date(Date.now() - 3 * 3600_000 + d * 86400_000).toISOString().slice(0, 10);

async function conta(nome: string, kind: string) {
  return (await um<{ id: string }>(`insert into public.financial_accounts (nome, kind) values ($1,$2) returning id`, [`${nome} ${marca()}`, kind])).id;
}
const arquivos = new Map<string, { file: string; imp: string }>();
let linhaNo = 0;
async function linha(acc: string, kind: "entrada" | "saida", valor: number, historico: string, data = hoje()) {
  let a = arquivos.get(acc);
  if (!a) {
    const file = (await um<{ id: string }>(`insert into public.financial_statement_files (financial_account_id, storage_path, original_name, format, sha256) values ($1,$2,'ISO','ofx',$2) returning id`, [acc, `iso-0369-${marca()}`])).id;
    const imp = (await um<{ id: string }>(`insert into public.financial_statement_imports (file_id, financial_account_id) values ($1,$2) returning id`, [file, acc])).id;
    a = { file, imp }; arquivos.set(acc, a);
  }
  return (await um<{ id: string }>(`insert into public.financial_statement_lines (financial_account_id, file_id, import_id, line_no, data, valor_cents, kind, historico, documento, bank_id, raw, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'0',$9,'{}'::jsonb,'pendente') returning id`, [acc, a.file, a.imp, ++linhaNo, data, valor, kind, historico, `bk_${marca()}`])).id;
}
const status = async (id: string) => (await um<{ s: string }>(`select status::text s from public.financial_statement_lines where id=$1`, [id])).s;
const saldoTransf = async (acc: string, transfer: string) =>
  Number((await um<{ s: string }>(`select coalesce(sum(valor_cents),0) s from public.financial_account_movements where financial_account_id=$1 and transfer_id=$2`, [acc, transfer])).s);
const parear = async () => (await um<{ r: Record<string, number> }>(`select public.fin_transferencias_parear_nucleo($1, 1000) r`, [financeiro.uid])).r;
const registroDaLinha = (id: string) => um<{ id: string; transfer_id: string; modo: string; origem: string } | undefined>(
  `select id, transfer_id, modo, origem from public.fin_transferencias_extrato where (line_saida=$1 or line_entrada=$1) and desfeito_em is null`, [id]);

beforeAll(async () => {
  financeiro = await criarConta({ nome: "fin-0369", papeis: ["financeiro"], comParty: true });
  estoque = await criarConta({ nome: "estoque-0369", papeis: ["estoque"], comParty: true });
  await adm.unsafe(`insert into public.user_financial_access (user_id, nivel) values ($1,'completo') on conflict do nothing`, [financeiro.uid]).catch(() => undefined);
  cnpj = gerarCnpj();
  razao = `ISOX${marca().toUpperCase()} COMERCIO DE TESTE LTDA`;
  await adm.unsafe(`insert into public.business_entities (legal_name, trade_name, tax_id) values ($1,$1,$2)`, [razao, cnpj]);
  asaas = await conta("ISO Asaas 0369", "provedor");
  santander = await conta("ISO Santander 0369", "conta_corrente");
  itau = await conta("ISO Itau 0369", "conta_corrente");
});

function gerarCnpj(): string {
  const b = [...String(Date.now()).slice(-8).padStart(8, "1")].map(Number).concat([0, 0, 0, 1]);
  const dv = (x: number[]) => { const pesos = x.length === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    const r = x.reduce((a, d, i) => a + d * pesos[i]!, 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(b); return [...b, d1, dv([...b, d1])].join("");
}
const nomeCurto = () => razao.split(" ").slice(0, 4).join(" ");

describe("0369 — Mesa: Transferência entre contas", () => {
  test("R$ 30.000 Asaas → Santander: cria a transferência, confere as duas linhas, sem título, clique duplo idempotente", async () => {
    const valor = 3_000_000 + Math.floor(Math.random() * 999);
    const sai = await linha(asaas, "saida", valor, `Transação via Pix com chave para ${razao}`);
    const ent = await linha(santander, "entrada", valor, `PIX RECEBIDO     ${cnpj}`);
    const titulosAntes = Number((await um<{ c: string }>(`select count(*) c from public.financial_titles`)).c);

    const sug = await rpc<{ propria: boolean; contras: { line_id: string }[]; contas: { id: string }[] }>(financeiro, "fin_mesa_transferencia_sugestao", { _line_id: sai });
    expect(sug.ok).toBe(true);
    expect(sug.dados.propria).toBe(true);
    expect(sug.dados.contras.map((c) => c.line_id)).toContain(ent);
    expect(sug.dados.contas.map((c) => c.id)).toContain(santander);

    const r = await rpc<{ transfer_id: string; contra_ligada: boolean; repetido: boolean }>(financeiro, "fin_mesa_nova_transferencia",
      { _line_id: sai, _outra_conta: santander, _contra_line_id: ent, _observacao: null });
    expect(r.ok).toBe(true);
    expect(r.dados.contra_ligada).toBe(true);
    expect(await status(sai)).toBe("ignorada");
    expect(await status(ent)).toBe("ignorada");
    expect(await saldoTransf(asaas, r.dados.transfer_id)).toBe(-valor);
    expect(await saldoTransf(santander, r.dados.transfer_id)).toBe(valor);
    expect(Number((await um<{ c: string }>(`select count(*) c from public.financial_titles`)).c)).toBe(titulosAntes);

    const de2 = await rpc<{ transfer_id: string; repetido: boolean }>(financeiro, "fin_mesa_nova_transferencia",
      { _line_id: sai, _outra_conta: santander, _contra_line_id: ent, _observacao: null });
    expect(de2.ok).toBe(true);
    expect(de2.dados.repetido).toBe(true);
    expect(de2.dados.transfer_id).toBe(r.dados.transfer_id);
    const pernas = Number((await um<{ c: string }>(`select count(*) c from public.financial_account_movements where transfer_id=$1`, [r.dados.transfer_id])).c);
    expect(pernas).toBe(2);
  });

  test("desfazer exige motivo, devolve as linhas para pendente, estorna e a rotina não refaz", async () => {
    const valor = 1_900_000 + Math.floor(Math.random() * 999);
    const sai = await linha(asaas, "saida", valor, `Transação via Pix com chave para ${razao}`);
    const ent = await linha(santander, "entrada", valor, `PIX RECEBIDO ${cnpj}`);
    const r = await rpc<{ id: string; transfer_id: string }>(financeiro, "fin_mesa_nova_transferencia", { _line_id: ent, _outra_conta: asaas, _contra_line_id: sai, _observacao: "Resgate Asaas" });
    expect(r.ok).toBe(true);
    const curto = await rpc(financeiro, "fin_transferencia_extrato_desfazer", { _id: r.dados.id, _motivo: "x" });
    expect(curto.ok).toBe(false);
    const d = await rpc<{ estorno_transfer_id: string }>(financeiro, "fin_transferencia_extrato_desfazer", { _id: r.dados.id, _motivo: "Lançada na conta errada" });
    expect(d.ok).toBe(true);
    expect(d.dados.estorno_transfer_id).toBeTruthy();
    expect(await status(sai)).toBe("pendente");
    expect(await status(ent)).toBe("pendente");
    const liquido = Number((await um<{ s: string }>(`select coalesce(sum(valor_cents),0) s from public.financial_account_movements where transfer_id in ($1,$2) and financial_account_id=$3`,
      [r.dados.transfer_id, d.dados.estorno_transfer_id, asaas])).s);
    expect(liquido).toBe(0);
    await parear();
    expect(await status(sai)).toBe("pendente");
    expect(await registroDaLinha(sai)).toBeUndefined();
    // pessoa pode refazer na Mesa: nova transferência com nova chave
    const de3 = await rpc<{ transfer_id: string; repetido: boolean }>(financeiro, "fin_mesa_nova_transferencia", { _line_id: sai, _outra_conta: santander, _contra_line_id: ent, _observacao: null });
    expect(de3.ok).toBe(true);
    expect(de3.dados.repetido).toBe(false);
    expect(de3.dados.transfer_id).not.toBe(r.dados.transfer_id);
  });

  test("sem permissão: estoque não lança, não pareia, não desfaz; linha da outra conta precisa ser oposta e de mesmo valor", async () => {
    const valor = 500_000 + Math.floor(Math.random() * 999);
    const sai = await linha(itau, "saida", valor, `PIX ENVIADO ${nomeCurto()}`);
    const outraSaida = await linha(santander, "saida", valor, `PIX ENVIADO ${nomeCurto()}`);
    const valorDif = await linha(santander, "entrada", valor + 1, `PIX RECEBIDO ${cnpj}`);
    expect((await rpc(estoque, "fin_mesa_nova_transferencia", { _line_id: sai, _outra_conta: santander, _contra_line_id: null, _observacao: null })).ok).toBe(false);
    expect((await rpc(estoque, "fin_transferencias_parear_agora", {})).ok).toBe(false);
    expect((await rpc(estoque, "fin_mesa_transferencia_sugestao", { _line_id: sai })).ok).toBe(false);
    expect((await rpc(financeiro, "fin_mesa_nova_transferencia", { _line_id: sai, _outra_conta: santander, _contra_line_id: outraSaida, _observacao: null })).ok).toBe(false);
    expect((await rpc(financeiro, "fin_mesa_nova_transferencia", { _line_id: sai, _outra_conta: santander, _contra_line_id: valorDif, _observacao: null })).ok).toBe(false);
    expect((await rpc(financeiro, "fin_mesa_nova_transferencia", { _line_id: sai, _outra_conta: itau, _contra_line_id: null, _observacao: null })).ok).toBe(false);
    expect(await status(sai)).toBe("pendente");
  });
});

describe("0369 — rotina pareia sozinha só com prova dos dois lados", () => {
  test("dois lados citam a empresa e par único → transferência criada e as duas linhas conferidas", async () => {
    const valor = 400_000 + Math.floor(Math.random() * 999);
    const sai = await linha(itau, "saida", valor, `PIX ENVIADO ${nomeCurto()} ${cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}`, dia(-1));
    const ent = await linha(santander, "entrada", valor, `PIX RECEBIDO     ${cnpj}`);
    const r = await parear();
    expect(r.novas).toBeGreaterThanOrEqual(1);
    const reg = await registroDaLinha(sai);
    expect(reg?.origem).toBe("automatico");
    expect(reg?.modo).toBe("nova");
    expect(await status(sai)).toBe("ignorada");
    expect(await status(ent)).toBe("ignorada");
    expect(await saldoTransf(itau, reg!.transfer_id)).toBe(-valor);
    expect(await saldoTransf(santander, reg!.transfer_id)).toBe(valor);
    const data = (await um<{ d: string }>(`select data::text d from public.financial_transfers where id=$1`, [reg!.transfer_id])).d;
    expect(data).toBe(dia(-1)); // data em que o dinheiro saiu
  });

  test("só valor igual (outra ponta sem CNPJ/razão social) nunca pareia", async () => {
    const valor = 333_300 + Math.floor(Math.random() * 99);
    const sai = await linha(asaas, "saida", valor, `Transação via Pix com chave para ${razao}`);
    const ent = await linha(santander, "entrada", valor, "PIX RECEBIDO MARIA DA SILVA");
    await parear();
    expect(await status(sai)).toBe("pendente");
    expect(await status(ent)).toBe("pendente");
    expect(await registroDaLinha(sai)).toBeUndefined();
  });

  test("duas entradas possíveis do mesmo valor → ambíguo, nada é feito", async () => {
    const valor = 777_700 + Math.floor(Math.random() * 99);
    const sai = await linha(asaas, "saida", valor, `Transação via Pix com chave para ${razao}`);
    const e1 = await linha(santander, "entrada", valor, `PIX RECEBIDO ${cnpj}`);
    const e2 = await linha(itau, "entrada", valor, `PIX RECEBIDO ${cnpj}`);
    await parear();
    expect([await status(sai), await status(e1), await status(e2)]).toEqual(["pendente", "pendente", "pendente"]);
  });

  test("transferência já lançada no Lardan (Mesa sem a outra ponta) → extrato da outra conta chega e é conferido sem lançar de novo", async () => {
    const valor = 950_000 + Math.floor(Math.random() * 999);
    const sai = await linha(itau, "saida", valor, `PIX ENVIADO ${nomeCurto()}`);
    const r = await rpc<{ transfer_id: string; contra_ligada: boolean }>(financeiro, "fin_mesa_nova_transferencia", { _line_id: sai, _outra_conta: santander, _contra_line_id: null, _observacao: null });
    expect(r.ok).toBe(true);
    expect(r.dados.contra_ligada).toBe(false);
    const ent = await linha(santander, "entrada", valor, `PIX RECEBIDO ${cnpj}`, dia(1));
    const res = await parear();
    expect(res.existentes).toBeGreaterThanOrEqual(1);
    const reg = await registroDaLinha(ent);
    expect(reg?.modo).toBe("existente");
    expect(reg?.transfer_id).toBe(r.dados.transfer_id);
    expect(await status(ent)).toBe("ignorada");
    const transfDaConta = Number((await um<{ c: string }>(`select count(*) c from public.financial_transfers where idempotency_key like $1`, [`%${ent}%`])).c);
    expect(transfDaConta).toBe(0);
  });
});
