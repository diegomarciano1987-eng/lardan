/**
 * PDV Loja — prova ponta a ponta no banco ISOLADO (dados sintéticos).
 * Loja por número+senha, PIN da vendedora, caixa, venda com preço do servidor,
 * baixa de estoque, desconto com limite, troco, comissão, idempotência,
 * cancelamento com devolução, fechamento de caixa e bloqueios de acesso.
 */
import { describe, expect, test } from "bun:test";
import { adm, criarConta, criarVariante, porEstoque, rpc, rpcServico, saldo, ler } from "./base";

const h = (s: string) => `hash-${s}-${Math.random()}`;

describe("PDV Loja", async () => {
  const master = await criarConta({ nome: "pdv-master", papeis: ["master"] });
  const vend = await criarConta({ nome: "pdv-vend", papeis: [] });
  const sup = await criarConta({ nome: "pdv-sup", papeis: [] });
  const intruso = await criarConta({ nome: "pdv-intruso", papeis: ["financeiro"] });
  const numero = String(10000 + Math.floor(Math.random() * 89999));
  let unidade = "", loc = "", mV = "", mS = "", tok = "", venda = "", variante = "";

  test("gestão cria loja com número e senha; senha nunca é legível", async () => {
    const r = await rpc<string>(master, "pdv_unidade_criar", { _nome: "Loja Prova", _numero: numero, _senha: "segredo123" });
    expect(r.erro).toBeNull(); unidade = r.dados;
    const dup = await rpc(master, "pdv_unidade_criar", { _nome: "X", _numero: numero, _senha: "segredo123" });
    expect(dup.erro).toContain("Já existe");
    const semPerm = await rpc(intruso, "pdv_unidade_criar", { _nome: "X", _numero: "99999", _senha: "segredo123" });
    expect(semPerm.erro).toContain("Sem permissão");
    const leitura = await ler(master, "select senha_hash from public.pdv_unidades limit 1");
    expect(leitura.ok).toBe(false);
    const [u] = (await adm.unsafe("select location_id from public.pdv_unidades where id=$1", [unidade])) as { location_id: string }[];
    loc = u!.location_id;
    await adm.unsafe("update public.pdv_unidades set desconto_max_operadora_pct=10, desconto_max_supervisora_pct=30 where id=$1", [unidade]);
    const ev = (await adm.unsafe("select count(*)::int n from public.pdv_config_eventos where dados ? 'senha_hash'")) as { n: number }[];
    expect(ev[0]!.n).toBe(0);
  });

  test("equipe vinculada à loja, PIN e comissão", async () => {
    const [a] = (await adm.unsafe("insert into public.pdv_membros(unidade_id,user_id,papel) values ($1,$2,'operadora') returning id", [unidade, vend.uid])) as { id: string }[];
    const [b] = (await adm.unsafe("insert into public.pdv_membros(unidade_id,user_id,papel) values ($1,$2,'supervisora') returning id", [unidade, sup.uid])) as { id: string }[];
    mV = a!.id; mS = b!.id;
    expect((await rpc(master, "pdv_membro_pin", { _membro: mV, _pin: "1234" })).erro).toBeNull();
    expect((await rpc(master, "pdv_membro_pin", { _membro: mS, _pin: "9999" })).erro).toBeNull();
    expect((await rpc(master, "pdv_membro_pin", { _membro: mV, _pin: "12" })).erro).toContain("PIN");
    await adm.unsafe("insert into public.pdv_comissoes(membro_id,percentual,vigente_de) values ($1,5,current_date-1)", [mV]);
  });

  test("navegador não executa rotinas do terminal", async () => {
    const r = await rpc(vend, "pdv_entrar", { _numero: numero, _senha: "segredo123", _token_hash: "x", _ua: "" });
    expect(r.ok).toBe(false);
  });

  test("entrada: senha errada recusa, certa abre sessão; PIN identifica a vendedora", async () => {
    expect((await rpcServico("pdv_entrar", { _numero: numero, _senha: "errada", _token_hash: h("e"), _ua: "t" })).erro).toContain("incorretos");
    tok = h("ok");
    expect((await rpcServico("pdv_entrar", { _numero: numero, _senha: "segredo123", _token_hash: tok, _ua: "t" })).erro).toBeNull();
    expect((await rpcServico("pdv_caixa_abrir", { _token_hash: tok, _fundo: 10000 })).erro).toContain("vendedora");
    expect((await rpcServico("pdv_operadora", { _token_hash: tok, _membro: mV, _pin: "0000" })).erro).toContain("PIN incorreto");
    expect((await rpcServico("pdv_operadora", { _token_hash: tok, _membro: mV, _pin: "1234" })).erro).toBeNull();
    expect((await rpcServico("pdv_estado", { _token_hash: "invalido" })).erro).toContain("PDV_SESSAO_INVALIDA");
  });

  test("caixa abre; venda sem estoque é recusada sem deixar rastro", async () => {
    expect((await rpcServico("pdv_caixa_abrir", { _token_hash: tok, _fundo: 10000 })).erro).toBeNull();
    variante = await criarVariante("pdv", 20000);
    const r = await rpcServico("pdv_venda_concluir", { _token_hash: tok, _p: { idem: "s1", itens: [{ variant_id: variante, qtd: 1 }], desconto_cents: 0, cliente: {}, pagamentos: [{ forma: "dinheiro", valor_cents: 20000 }] } });
    expect(r.erro).toContain("Sem estoque");
    const n = (await adm.unsafe("select count(*)::int n from public.pdv_vendas where idempotency_key='s1'")) as { n: number }[];
    expect(n[0]!.n).toBe(0);
  });

  test("venda: preço do servidor, desconto limitado, troco, comissão, baixa de estoque, idempotente", async () => {
    await porEstoque(variante, loc, 3);
    const base = { itens: [{ variant_id: variante, qtd: 2, preco: 1 }], cliente: { nome: "Cliente Prova" } };
    const acima = await rpcServico("pdv_venda_concluir", { _token_hash: tok, _p: { ...base, idem: "v0", desconto_cents: 8000, pagamentos: [{ forma: "dinheiro", valor_cents: 32000 }] } });
    expect(acima.erro).toContain("limite");
    const errado = await rpcServico("pdv_venda_concluir", { _token_hash: tok, _p: { ...base, idem: "v0b", desconto_cents: 0, pagamentos: [{ forma: "dinheiro", valor_cents: 2 }] } });
    expect(errado.erro).toContain("não fecham");
    const p = { ...base, idem: `v1-${numero}`, desconto_cents: 4000, pagamentos: [{ forma: "dinheiro", valor_cents: 36000, recebido_cents: 40000 }] };
    const r = await rpcServico<{ venda: string; status: string; total: number }>("pdv_venda_concluir", { _token_hash: tok, _p: p });
    expect(r.erro).toBeNull(); expect(r.dados.total).toBe(36000); expect(r.dados.status).toBe("concluida"); venda = r.dados.venda;
    expect(await saldo(variante, loc)).toBe(1);
    const rep = await rpcServico<{ repetida: boolean }>("pdv_venda_concluir", { _token_hash: tok, _p: p });
    expect(rep.dados.repetida).toBe(true);
    expect(await saldo(variante, loc)).toBe(1);
    const [v] = (await adm.unsafe("select comissao_cents::int c, (select troco_cents::int from public.pdv_pagamentos where venda_id=$1) t from public.pdv_vendas where id=$1", [venda])) as { c: number; t: number }[];
    expect(v!.c).toBe(1800); expect(v!.t).toBe(4000);
    const mov = (await adm.unsafe("select count(*)::int n from public.stock_movements where reference like 'PDV-%' and variant_id=$1 and kind='saida'", [variante])) as { n: number }[];
    expect(mov[0]!.n).toBe(1);
  });

  test("Pix exige configuração e CPF", async () => {
    const r = await rpcServico("pdv_venda_concluir", { _token_hash: tok, _p: { idem: "px", itens: [{ variant_id: variante, qtd: 1 }], desconto_cents: 0, cliente: {}, pagamentos: [{ forma: "pix", valor_cents: 20000 }] } });
    expect(r.erro).toContain("Pix");
    expect(await saldo(variante, loc)).toBe(1);
  });

  test("vendedora não cancela concluída; supervisora cancela e estoque volta", async () => {
    expect((await rpcServico("pdv_venda_cancelar", { _token_hash: tok, _venda: venda, _motivo: "teste" })).erro).toContain("supervisora");
    await rpcServico("pdv_operadora", { _token_hash: tok, _membro: mS, _pin: "9999" });
    expect((await rpcServico("pdv_venda_cancelar", { _token_hash: tok, _venda: venda, _motivo: "Cliente desistiu" })).erro).toBeNull();
    expect(await saldo(variante, loc)).toBe(3);
  });

  test("comprovante e fechamento de caixa com diferença justificada", async () => {
    const c = await rpcServico<{ itens: unknown[]; codigo: number }>("pdv_comprovante", { _token_hash: tok, _venda: venda });
    expect(c.dados.itens.length).toBe(1);
    expect((await rpcServico("pdv_caixa_mov", { _token_hash: tok, _tipo: "sangria", _valor: 3000, _motivo: "depósito" })).erro).toBeNull();
    // fundo 100,00 − sangria 30,00 (venda cancelada não conta) = 70,00
    expect((await rpcServico("pdv_caixa_fechar", { _token_hash: tok, _contado: 6900, _obs: "" })).erro).toContain("Explique");
    const f = await rpcServico<{ esperado: number; diferenca: number }>("pdv_caixa_fechar", { _token_hash: tok, _contado: 6900, _obs: "moeda faltando" });
    expect(f.dados.esperado).toBe(7000); expect(f.dados.diferenca).toBe(-100);
  });

  test("trocar a senha desliga aparelhos conectados", async () => {
    expect((await rpc(master, "pdv_unidade_acesso", { _unidade: unidade, _numero: numero, _senha: "novaSenha9" })).erro).toBeNull();
    expect((await rpcServico("pdv_estado", { _token_hash: tok })).erro).toContain("PDV_SESSAO_INVALIDA");
  });
});
