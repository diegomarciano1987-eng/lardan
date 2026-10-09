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
  const vend = await criarConta({ nome: "pdv-vend", papeis: [], comParty: true });
  const sup = await criarConta({ nome: "pdv-sup", papeis: [], comParty: true });
  const consultoraExt = await criarConta({ nome: "pdv-consultora", papeis: ["consultora"], comParty: true });
  const virarVendedora = async (uid: string) =>
    adm.unsafe("insert into public.party_roles(party_id, role, status) select party_id, 'vendedora_interna', 'ativo' from public.profiles where id=$1", [uid]);
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

  test("só vendedora interna entra na equipe da loja", async () => {
    // sem papel de vendedora interna: recusado (financeiro e consultora externa)
    const semPapel = await adm.unsafe("insert into public.pdv_membros(unidade_id,user_id,papel) values ($1,$2,'operadora')", [unidade, intruso.uid]).then(() => null, (e) => String(e));
    expect(semPapel).toContain("vendedoras internas");
    await adm.unsafe("insert into public.party_roles(party_id, role, status) select party_id, 'consultora', 'ativo' from public.profiles where id=$1", [consultoraExt.uid]);
    const consult = await adm.unsafe("insert into public.pdv_membros(unidade_id,user_id,papel) values ($1,$2,'operadora')", [unidade, consultoraExt.uid]).then(() => null, (e) => String(e));
    expect(consult).toContain("vendedoras internas");
    // seletor da equipe só lista vendedoras internas
    await virarVendedora(vend.uid); await virarVendedora(sup.uid);
    const disp = async () => (await ler<{ user_id: string }>(master, "select user_id from public.pdv_usuarios_disponiveis()")).linhas.map((x) => x.user_id);
    const ids = await disp();
    expect(ids).toContain(vend.uid); expect(ids).toContain(sup.uid);
    expect(ids).not.toContain(consultoraExt.uid); expect(ids).not.toContain(intruso.uid);
    // ficha completa gravada; desligada sai do seletor
    const [pv] = (await adm.unsafe("select party_id from public.profiles where id=$1", [sup.uid])) as { party_id: string }[];
    await adm.unsafe("insert into public.vendedora_profiles(party_id, situacao, comissao_padrao_pct, pix_key_type, pix_key) values ($1,'desligada',5,'cpf','00000000000')", [pv!.party_id]);
    expect(await disp()).not.toContain(sup.uid);
    await adm.unsafe("update public.vendedora_profiles set situacao='ativa' where party_id=$1", [pv!.party_id]);
    // fora da gestão: não lê nem escreve a ficha
    const curioso = await criarConta({ nome: "pdv-curioso", papeis: [] });
    expect((await ler(curioso, "select pix_key from public.vendedora_profiles")).linhas.length).toBe(0);
    expect((await ler(curioso, "update public.vendedora_profiles set pix_key='x' returning 1")).linhas.length).toBe(0);
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
    const r = await rpc(vend, "pdv_entrar_iniciar", { _numero: numero, _senha: "segredo123", _email: "x@y.z" });
    expect(r.ok).toBe(false);
  });

  test("entrada exige número, senha, e-mail da equipe e código por e-mail", async () => {
    const [e] = (await adm.unsafe("select email from auth.users where id=$1", [vend.uid])) as { email: string }[];
    const [ei] = (await adm.unsafe("select email from auth.users where id=$1", [intruso.uid])) as { email: string }[];
    expect((await rpcServico("pdv_entrar", { _numero: numero, _senha: "segredo123", _token_hash: h("old"), _ua: "" })).ok).toBe(false);
    expect((await rpcServico("pdv_entrar_iniciar", { _numero: numero, _senha: "errada", _email: e!.email })).erro).toContain("incorretos");
    expect((await rpcServico("pdv_entrar_iniciar", { _numero: numero, _senha: "segredo123", _email: ei!.email })).erro).toContain("não faz parte");
    const d = await rpcServico<{ desafio: string; codigo: string; email: string }>("pdv_entrar_iniciar", { _numero: numero, _senha: "segredo123", _email: e!.email.toUpperCase() });
    expect(d.erro).toBeNull(); expect(d.dados.codigo).toMatch(/^\d{6}$/); expect(d.dados.email).toBe(e!.email);
    const [hc] = (await adm.unsafe("select codigo_hash from public.pdv_login_codigos where id=$1", [d.dados.desafio])) as { codigo_hash: string }[];
    expect(hc!.codigo_hash).not.toContain(d.dados.codigo);
    expect((await ler(master, "select codigo_hash from public.pdv_login_codigos limit 1")).ok).toBe(false);
    const errado = d.dados.codigo === "000000" ? "111111" : "000000";
    const r1 = await rpcServico<{ ok: boolean; erro: string }>("pdv_entrar_confirmar", { _desafio: d.dados.desafio, _codigo: errado, _token_hash: h("x"), _ua: "t" });
    expect(r1.dados.ok).toBe(false); expect(r1.dados.erro).toContain("incorreto");
    tok = h("ok");
    const r2 = await rpcServico<{ ok: boolean }>("pdv_entrar_confirmar", { _desafio: d.dados.desafio, _codigo: d.dados.codigo, _token_hash: tok, _ua: "t" });
    expect(r2.dados.ok).toBe(true);
    expect((await rpcServico("pdv_entrar_confirmar", { _desafio: d.dados.desafio, _codigo: d.dados.codigo, _token_hash: h("y"), _ua: "t" })).erro).toContain("expirado");
    const d2 = await rpcServico<{ desafio: string; codigo: string }>("pdv_entrar_iniciar", { _numero: numero, _senha: "segredo123", _email: e!.email });
    for (let i = 0; i < 5; i++) await rpcServico("pdv_entrar_confirmar", { _desafio: d2.dados.desafio, _codigo: errado, _token_hash: h("z"), _ua: "t" });
    expect((await rpcServico("pdv_entrar_confirmar", { _desafio: d2.dados.desafio, _codigo: d2.dados.codigo, _token_hash: h("z"), _ua: "t" })).erro).toContain("bloqueado");
    const [s] = (await adm.unsafe("select membro_id, login_membro_id from public.pdv_sessoes where token_hash=$1", [tok])) as { membro_id: string; login_membro_id: string }[];
    expect(s!.login_membro_id).toBe(mV); expect(s!.membro_id).toBe(mV);
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

  test("loja sem empresa herda a única empresa; com responsável, Pix e link de cartão ficam liberados", async () => {
    const ents = (await adm.unsafe("select count(*)::int n from public.business_entities where is_active")) as { n: number }[];
    if (ents[0]!.n === 0) await adm.unsafe("insert into public.business_entities(legal_name, trade_name, is_active) values ('LARDAN PROVA','LARDAN',true)");
    await adm.unsafe("update public.business_entities set is_active = (id = (select id from public.business_entities order by created_at limit 1))");
    await adm.unsafe("update public.pdv_unidades set business_entity_id=null, pix_responsavel_user_id=$2 where id=$1", [unidade, master.uid]);
    const [u] = (await adm.unsafe("select business_entity_id from public.pdv_unidades where id=$1", [unidade])) as { business_entity_id: string | null }[];
    expect(u!.business_entity_id).not.toBeNull();
    const est = await rpcServico<{ unidade: { pix: boolean } }>("pdv_estado", { _token_hash: tok });
    expect(est.dados.unidade.pix).toBe(true);
    const semCpf = await rpcServico("pdv_venda_concluir", { _token_hash: tok, _p: { idem: `lc0-${numero}`, itens: [{ variant_id: variante, qtd: 1 }], desconto_cents: 0, cliente: { nome: "Ana" }, pagamentos: [{ forma: "link_cartao", valor_cents: 20000 }] } });
    expect(semCpf.erro).toContain("CPF");
    const dois = await rpcServico("pdv_venda_concluir", { _token_hash: tok, _p: { idem: `lc1-${numero}`, itens: [{ variant_id: variante, qtd: 1 }], desconto_cents: 0, cliente: { nome: "Ana", doc: "52998224725" }, pagamentos: [{ forma: "pix", valor_cents: 10000 }, { forma: "link_cartao", valor_cents: 10000 }] } });
    expect(dois.erro).toContain("único");
    const r = await rpcServico<{ venda: string; status: string }>("pdv_venda_concluir", { _token_hash: tok, _p: { idem: `lc2-${numero}`, itens: [{ variant_id: variante, qtd: 1 }], desconto_cents: 0, cliente: { nome: "Ana Cartão", doc: "52998224725" }, pagamentos: [{ forma: "link_cartao", valor_cents: 20000 }] } });
    expect(r.erro).toBeNull(); expect(r.dados.status).toBe("aguardando_pix");
    const [pg] = (await adm.unsafe("select forma, status from public.pdv_pagamentos where venda_id=$1", [r.dados.venda])) as { forma: string; status: string }[];
    expect(pg!.forma).toBe("link_cartao"); expect(pg!.status).toBe("pendente");
    const t = await rpcServico<{ installment_id: string; forma: string }>("pdv_pix_titulo", { _token_hash: tok, _venda: r.dados.venda });
    expect(t.erro).toBeNull(); expect(t.dados.forma).toBe("link_cartao");
    const [ti] = (await adm.unsafe("select t.business_entity_id, t.direction::text d, t.descricao from public.financial_installments i join public.financial_titles t on t.id=i.title_id where i.id=$1", [t.dados.installment_id])) as { business_entity_id: string; d: string; descricao: string }[];
    expect(ti!.business_entity_id).toBe(u!.business_entity_id); expect(ti!.d).toBe("receivable"); expect(ti!.descricao).toContain("link cartão");
    const s = await rpcServico<{ status: string }>("pdv_pix_situacao", { _token_hash: tok, _venda: r.dados.venda });
    expect(s.dados.status).toBe("aguardando_pix");
    expect((await rpcServico("pdv_venda_cancelar", { _token_hash: tok, _venda: r.dados.venda, _motivo: "prova link" })).erro).toBeNull();
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

  test("cliente da loja: grava, valida dígitos, não duplica e aparece em clientes e vendas", async () => {
    expect((await rpcServico("pdv_cliente_salvar", { _token_hash: tok, _c: { nome: "Ana Prova", doc: "123" } })).erro).toContain("11 dígitos");
    expect((await rpcServico("pdv_cliente_salvar", { _token_hash: tok, _c: { nome: "Ana Prova", telefone: "4499" } })).erro).toContain("WhatsApp");
    const b = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
    const dv = (a: number[]) => { const r = (a.reduce((s, n, i) => s + n * (a.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
    b.push(dv(b)); b.push(dv(b)); const cpf = b.join("");
    const g = await rpcServico<{ party_id: string }>("pdv_cliente_salvar", { _token_hash: tok, _c: { nome: "Ana Prova", doc: cpf, telefone: "44991165911", instagram: "@ana.prova", email: "ana@prova.com", nascimento: "1990-05-10", cep: "87000000", cidade: "Maringá", uf: "PR" } });
    expect(g.erro).toBeNull();
    const g2 = await rpcServico<{ party_id: string }>("pdv_cliente_salvar", { _token_hash: tok, _c: { nome: "Outro Nome", telefone: "(44) 99116-5911" } });
    expect(g2.dados.party_id).toBe(g.dados.party_id);
    const [papel] = (await adm.unsafe("select count(*)::int n from public.party_roles where party_id=$1 and role='cliente'", [g.dados.party_id])) as { n: number }[];
    expect(papel!.n).toBe(1);
    const cl = await rpcServico<any[]>("pdv_clientes_listar", { _token_hash: tok, _q: "ana.pro" });
    expect(cl.dados.length).toBe(1); expect(cl.dados[0].instagram).toBe("ana.prova"); expect(cl.dados[0].doc).not.toContain(cpf);
    await rpcServico("pdv_caixa_abrir", { _token_hash: tok, _fundo: 0 });
    const v = await rpcServico<{ venda: string }>("pdv_venda_concluir", { _token_hash: tok, _p: { idem: `cli-${numero}`, itens: [{ variant_id: variante, qtd: 1 }], desconto_cents: 0, cliente: { nome: "Ana Prova" }, pagamentos: [{ forma: "dinheiro", valor_cents: 20000 }] } });
    expect((await rpcServico("pdv_venda_vincular_cliente", { _token_hash: tok, _venda: v.dados.venda, _party: g.dados.party_id })).erro).toBeNull();
    const cl2 = await rpcServico<any[]>("pdv_clientes_listar", { _token_hash: tok, _q: "" });
    expect(cl2.dados.find((x) => x.party_id === g.dados.party_id).compras).toBe(1);
    const vs = await rpcServico<any[]>("pdv_vendas_listar", { _token_hash: tok, _dias: 1 });
    const card = vs.dados.find((x) => x.id === v.dados.venda);
    expect(card.vendedora).toBeTruthy(); expect(card.itens.length).toBe(1); expect(card.pagamentos[0].forma).toBe("dinheiro");
    expect((await rpc(vend, "pdv_clientes_listar", { _token_hash: tok, _q: "" })).ok).toBe(false);
  });

  test("trocar a senha desliga aparelhos conectados", async () => {
    expect((await rpc(master, "pdv_unidade_acesso", { _unidade: unidade, _numero: numero, _senha: "novaSenha9" })).erro).toBeNull();
    expect((await rpcServico("pdv_estado", { _token_hash: tok })).erro).toContain("PDV_SESSAO_INVALIDA");
  });
});
