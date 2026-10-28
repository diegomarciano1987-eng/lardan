/**
 * 0157 — pedido de consignação novo, preço gravado na remessa e regra de preço nova. Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, criarDeposito, criarVariante, ler, porEstoque, rpc, type Conta } from "./base";
import { cartoesGanho, fone, ganho, montarLinhas, nomeCurto, paginar, textoFaixas, htmlPedidoConsignacao, type PedidoDados } from "../../src/lib/pedido-consignacao";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const FAIXAS = [{ min_cents: 0, percentual: 20 }, { min_cents: 20000, percentual: 25 }, { min_cents: 50000, percentual: 30 },
  { min_cents: 65000, percentual: 35 }, { min_cents: 120000, percentual: 40 }];

let master: Conta, montadora: Conta, cons: Conta, rep: Conta;
let deposito = "", praca = "", remessa = "", cicloRua = "", cicloMontagem = "", vAnel = "", vBrinco = "";

describe("regra de preço (sempre para cima)", () => {
  test("até R$ 99,99 termina em ,90; de R$ 100 em diante termina em 4,90 ou 9,90", async () => {
    const casos: [number, number][] = [[4500, 4590], [4590, 4590], [9990, 9990], [1, 90], [10000, 10490], [10490, 10490],
      [10491, 10990], [11200, 11490], [14990, 14990], [15000, 15490], [32990, 32990], [33000, 33490]];
    for (const [p, esperado] of casos)
      expect((await um<{ n: number }>(`select public.preco_regra_lardan($1)::int n`, [p])).n).toBe(esperado);
  });
});

describe("folha do pedido (função pura)", () => {
  test("ganho pelas faixas: kit de R$ 5.701,50 rende R$ 2.280,60; cartões 650 → 227,50, 1.200 → 480,00, metade → 1.140,30", () => {
    expect(ganho(570150, FAIXAS)).toEqual({ cents: 228060, pct: 40 });
    expect(cartoesGanho(570150, FAIXAS).map((c) => [c.titulo, c.cents])).toEqual([
      ["Vendendo R$ 650", 22750], ["Vendendo R$ 1.200", 48000], ["Vendendo metade do kit", 114030]]);
    expect(cartoesGanho(80000, FAIXAS).map((c) => c.titulo)).toEqual(["Vendendo R$ 500", "Vendendo R$ 650", "Vendendo metade do kit"]);
    expect(textoFaixas(FAIXAS)).toContain("20% até R$ 199,99 · 25% a partir de R$ 200");
    expect(nomeCurto("Beatriz Oliveira Alexandre da Silva")).toBe("Beatriz O. A. da Silva");
    expect(fone("+5544999176598")).toBe("(44) 99917-6598");
    expect(fone("4332345678")).toBe("(43) 3234-5678");
    expect(fone("abc")).toBe("abc");
  });

  test("agrupa por tipo com subtotal e pagina: 40 peças em 2 páginas; última página nunca só com o fechamento; 120 em 3+", () => {
    const it = (i: number, grupo: string, preco = 9990) => ({ variant_id: `v${i}`, sku: `S${i}`, referencia: `REF-${String(i).padStart(3, "0")}`, descricao: `PECA ${String(i).padStart(3, "0")}`, preco_cents: preco, quantidade: 1, grupo: grupo as never });
    const itens55 = [...Array.from({ length: 4 }, (_, i) => it(i, "aneis")), ...Array.from({ length: 35 }, (_, i) => it(100 + i, "brincos")),
      ...Array.from({ length: 9 }, (_, i) => it(200 + i, "colares")), ...Array.from({ length: 6 }, (_, i) => it(300 + i, "pulseiras")), it(400, "piercing")];
    const g = montarLinhas(itens55);
    expect(g.map((x) => [x.rotulo, x.qtd])).toEqual([["Anéis", 4], ["Brincos", 35], ["Colares e conjuntos", 9], ["Pulseiras", 6], ["Piercing", 1]]);
    const p55 = paginar(g);
    // romaneio A4 (28/10/2026): a folha final nunca sai só com o fechamento — leva peças junto
    expect(p55.at(-1)!.filter((l) => l.tipo === "item").length).toBeGreaterThanOrEqual(5);
    expect(p55.flat().filter((l) => l.tipo === "item")).toHaveLength(55);
    expect(paginar(montarLinhas(itens55.slice(0, 40)))).toHaveLength(2);
    const p120 = paginar(montarLinhas(Array.from({ length: 120 }, (_, i) => it(i, "brincos"))));
    expect(p120.length).toBeGreaterThanOrEqual(3);
    expect(p120[1]![0]).toMatchObject({ tipo: "grupo", continua: true });
  });

  test("'Postar a maleta até' só no correio; sem assinatura nem vendeu/devolveu", () => {
    const d = (tipo: "pessoal" | "correio"): PedidoDados => ({
      empresa: { endereco_linha: "End", pedidos_telefone: "1", pedidos_email: "e", pagamento_texto: "p", pix_tipo: "CNPJ", pix_chave: "x", pix_favorecido: "f",
        garantia_titulo: "G", garantia_texto: "**só vale com registro no app Lardan**", garantia_exclusoes: "n", montagem_texto: "m", rodape_texto: "r", prazo_correio_dias: 7 },
      remessa: { numero: 878, kit: 1, tipo_envio: tipo, data_acerto: "2026-10-26", postar_ate: tipo === "correio" ? "2026-10-19" : null },
      maleta: "M", cliente_codigo: "01884", consultora: { nome: "Ana <b>", endereco: null, cidade: null, whatsapp: null },
      representante: null, montado_por: "Saylla", faixas: FAIXAS, itens: [{ variant_id: "a", sku: "A1", referencia: "AN-REF-01", descricao: "AN DOU", preco_cents: 10990, quantidade: 2, grupo: "aneis" }],
    });
    const correio = htmlPedidoConsignacao(d("correio"), { logoUrl: "x", operador: "op", impressoEm: new Date() });
    const pessoal = htmlPedidoConsignacao(d("pessoal"), { logoUrl: "x", operador: "op", impressoEm: new Date() });
    expect(correio).toContain("Postar a maleta até");
    expect(correio).toContain("19/10/2026");
    expect(pessoal).not.toContain("Postar a maleta até");
    expect(pessoal).toContain("<strong>só vale com registro no app Lardan</strong>");
    expect(pessoal).toContain("Ana &lt;b&gt;");
    expect(pessoal.toLowerCase()).not.toContain("assinatura");
    expect(pessoal.toLowerCase()).not.toContain("devolv");
    expect(pessoal).toContain("R$ 219,80");
    expect(pessoal).toContain("Valor unit. R$");
    expect(pessoal).toContain("Anéis · 2 peças");
    expect(pessoal).toContain(">219,80</td>"); // total da linha = 2 × 109,90
    // Sem referência real, nunca substituir por código de barras.
    expect(pessoal).toContain("<th>Referência</th>");
    expect(pessoal).toContain("AN-REF-01");
    expect(pessoal).not.toContain("A1</td>");
    expect(htmlPedidoConsignacao({ ...d("pessoal"), itens: [{ variant_id: "b", sku: "BC-9", referencia: null, descricao: "BR DOU", preco_cents: 1000, quantidade: 1, grupo: "brincos" as never }] },
      { logoUrl: "x", operador: "op", impressoEm: new Date() })).not.toContain(">BC-9</td>");
  });
});

beforeAll(async () => {
  master = await criarConta({ nome: `ped-master-${marca}`, papeis: ["master"], comParty: true });
  montadora = await criarConta({ nome: `ped-mont-${marca}`, papeis: ["montagem"], comParty: true });
  cons = await criarConta({ nome: `ped-cons-${marca}`, papeis: ["consultora"], comParty: true });
  rep = await criarConta({ nome: `ped-rep-${marca}`, papeis: ["representante"], comParty: true });
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'consultora'),($2,'representante')`, [cons.partyId, rep.partyId]);
  await adm.unsafe(`insert into public.contact_points (party_id, kind, value, is_primary) values ($1,'whatsapp','43999990000',true),($2,'whatsapp','43988887777',true)`, [cons.partyId, rep.partyId]);
  deposito = await criarDeposito(`ped-${marca}`);
  praca = (await ler<{ id: string }>(master, `select (public.praca_criar($1)).id`, [`Praça Pedido ${marca}`])).linhas[0]!.id;
  await adm.unsafe(`insert into public.consultant_profiles (party_id, representative_party_id, praca_id) values ($1,$2,$3)
                    on conflict (party_id) do update set praca_id = excluded.praca_id, representative_party_id = excluded.representative_party_id`, [cons.partyId, rep.partyId, praca]);
  vAnel = await criarVariante(`ped-anel-${marca}`, 10500);   // novo: 10990
  vBrinco = await criarVariante(`ped-brinco-${marca}`, 4500); // novo: 4590
  await adm.unsafe(`update public.products set name = 'AN DOU TESTE ' || $2 where id = (select product_id from public.product_variants where id=$1)`, [vAnel, marca]);
  await adm.unsafe(`update public.products set name = 'BR DOU TESTE ' || $2 where id = (select product_id from public.product_variants where id=$1)`, [vBrinco, marca]);
  await adm.unsafe(`update public.product_variants set reference_code = 'AN-REF-' || $2 where id = $1`, [vAnel, marca]);
  await adm.unsafe(`update public.product_variants set reference_code = 'BR-REF-' || $2 where id = $1`, [vBrinco, marca]);
  await porEstoque(vAnel, deposito, 20);
  await porEstoque(vBrinco, deposito, 20);
});

describe("remessa, preço gravado e folha", () => {
  test("remessa pelo correio: 'postar até' = acerto − prazo do correio", async () => {
    const acerto = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    const r = await rpc<{ id: string }>(master, "remessa_criar", { _praca: praca, _representante: rep.partyId, _deposito: deposito, _data_acerto: acerto });
    expect(r.erro).toBeNull();
    remessa = r.dados.id;
    expect((await rpc(cons, "remessa_tipo_envio_definir", { _remessa: remessa, _tipo: "correio" })).ok).toBe(false);
    expect((await rpc(master, "remessa_tipo_envio_definir", { _remessa: remessa, _tipo: "aviao" })).erro).toContain("inválido");
    expect((await rpc(master, "remessa_tipo_envio_definir", { _remessa: remessa, _tipo: "correio" })).erro).toBeNull();
    const e = await rpc<{ tipo_envio: string; postar_ate: string; prazo_correio_dias: number }>(master, "remessa_envio_ler", { _remessa: remessa });
    const esperado = new Date(new Date(acerto).getTime() - e.dados.prazo_correio_dias * 864e5).toISOString().slice(0, 10);
    expect(e.dados).toMatchObject({ tipo_envio: "correio", postar_ate: esperado });
  });

  test("monta e expede uma maleta; a folha traz grupos, preço gravado, quem montou e o código do cliente", async () => {
    const m = await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: cons.partyId });
    expect(m.erro).toBeNull();
    cicloRua = m.dados.cycle_id;
    for (const [v, n] of [[vAnel, 2], [vBrinco, 3]] as const)
      for (let i = 0; i < n; i++)
        expect((await rpc(montadora, "montagem_item_operar", { _cycle: cicloRua, _variant: v, _delta: 1, _origem: "bipagem", _operacao: crypto.randomUUID() })).erro).toBeNull();
    expect((await rpc(master, "kit_conferir", { _cycle: cicloRua, _note: null })).erro).toBeNull();
    expect((await rpc(master, "kit_expedir", { _cycle: cicloRua, _payload: { rota: "direta" } })).erro).toBeNull();
    const cod = String(1000 + Math.floor(Math.random() * 8999));
    await adm.unsafe(`update public.parties set code=$2 where id=$1`, [cons.partyId, cod]);

    const d = await rpc<PedidoDados>(master, "kit_pedido_dados", { _cycle: cicloRua });
    expect(d.erro).toBeNull();
    expect(d.dados.cliente_codigo).toBe(cod.padStart(5, "0"));
    expect(d.dados.remessa).toMatchObject({ kit: 1, tipo_envio: "correio" });
    expect(d.dados.remessa.postar_ate).toBeTruthy();
    expect(d.dados.montado_por).toContain(`ped-mont-${marca}`);
    expect(d.dados.representante?.telefone).toContain("43988887777");
    expect(d.dados.itens.map((i) => [i.grupo, i.preco_cents, i.quantidade]).sort()).toEqual([["aneis", 10500, 2], ["brincos", 4500, 3]]);
    expect(d.dados.itens.every((i) => i.referencia === (i.grupo === "aneis" ? `AN-REF-${marca}` : `BR-REF-${marca}`))).toBe(true);
    expect((await rpc(cons, "kit_pedido_dados", { _cycle: cicloRua })).ok).toBe(false);
  });

  test("preço novo: só Master; relatório antes; maleta na rua fica no preço gravado; maleta em montagem passa ao novo; desfazer volta", async () => {
    // segunda maleta, ainda em montagem
    const outra = await criarConta({ nome: `ped-cons2-${marca}`, papeis: ["consultora"], comParty: true });
    await adm.unsafe(`insert into public.consultant_profiles (party_id, praca_id) values ($1,$2) on conflict (party_id) do update set praca_id = excluded.praca_id`, [outra.partyId, praca]);
    cicloMontagem = (await rpc<{ cycle_id: string }>(master, "remessa_abrir_maleta", { _remessa: remessa, _consultora: outra.partyId })).dados.cycle_id;
    expect((await rpc(master, "kit_item_upsert", { _cycle: cicloMontagem, _variant: vAnel, _qty: 1 })).erro).toBeNull();

    const linhas = await ler<{ variant_id: string; antes_cents: number; depois_cents: number; pecas_na_rua: number }>(master,
      `select * from public.preco_reajuste_previa() where variant_id = any($1::uuid[])`, [`{${vAnel},${vBrinco}}`]);
    expect(linhas.erro).toBeNull();
    const anel = linhas.linhas.find((l) => l.variant_id === vAnel)!;
    expect([anel.antes_cents, anel.depois_cents, anel.pecas_na_rua]).toEqual([10500, 10990, 2]);
    expect((await ler(cons, `select * from public.preco_reajuste_previa() limit 1`)).ok).toBe(false);

    expect((await rpc(montadora, "preco_reajuste_aplicar", { _confirmacao: "APLICAR NOVO PRECO" })).ok).toBe(false);
    expect((await rpc(master, "preco_reajuste_aplicar", { _confirmacao: "sim" })).erro).toContain("APLICAR NOVO PRECO");
    const ap = await rpc<{ lote: string; variantes: number; maletas_em_montagem: number }>(master, "preco_reajuste_aplicar", { _confirmacao: "APLICAR NOVO PRECO" });
    expect(ap.erro).toBeNull();
    try {
      expect((await um<{ p: number }>(`select price_cents p from public.product_variants where id=$1`, [vAnel])).p).toBe(10990);
      // na rua: preço gravado
      expect((await um<{ p: number }>(`select public.kit_preco($1,$2) p`, [cicloRua, vAnel])).p).toBe(10500);
      const folha = await rpc<PedidoDados>(master, "kit_pedido_dados", { _cycle: cicloRua });
      expect(folha.dados.itens.find((i) => i.grupo === "aneis")!.preco_cents).toBe(10500);
      // em montagem: preço novo
      expect((await um<{ p: number }>(`select public.kit_preco($1,$2) p`, [cicloMontagem, vAnel])).p).toBe(10990);
      // app da consultora: vitrine e pedido da cliente pelo preço gravado
      const t = (await um<{ id: string }>(`select id from public.kit_transfers where cycle_id=$1 order by seq limit 1`, [cicloRua])).id;
      expect((await rpc(cons, "kit_transfer_confirm", { _transfer: t, _payload: {} })).erro).toBeNull();
      expect((await rpc(cons, "kit_aceitar", { _cycle: cicloRua, _idempotency_key: `ped-${marca}`,
        _itens: [{ variant_id: vAnel, qty_accepted: 2, qty_divergent: 0 }, { variant_id: vBrinco, qty_accepted: 3, qty_divergent: 0 }] })).erro).toBeNull();
      const pecas = await ler<{ variant_id: string } & Record<string, unknown>>(cons, `select * from public.consultant_pieces()`);
      expect(JSON.stringify(pecas.linhas.find((p) => p.variant_id === vAnel))).toContain("10500");
      const cli = (await ler<{ id: string }>(cons, `insert into public.consultant_clients (consultora_party_id, nome, telefone) values ($1,'Cliente Ped','43911112222') returning id`, [cons.partyId])).linhas[0]!.id;
      const ped = await rpc<{ total_cents: number }>(cons, "consultant_order_create", { _client: cli, _itens: [{ cycle_id: cicloRua, variant_id: vAnel, quantidade: 1 }], _idempotency_key: `ped-o-${marca}` });
      expect(ped.erro).toBeNull();
      expect(Number(ped.dados.total_cents)).toBe(10500);
    } finally {
      const d = await rpc<{ variantes: number }>(master, "preco_reajuste_desfazer", { _lote: ap.dados.lote });
      expect(d.erro).toBeNull();
    }
    expect((await um<{ p: number }>(`select price_cents p from public.product_variants where id=$1`, [vAnel])).p).toBe(10500);
  });

  test("dados da folha: só o Master altera; campo fora da lista é recusado", async () => {
    expect((await rpc(montadora, "pedido_config_salvar", { _dados: { prazo_correio_dias: 5 } })).ok).toBe(false);
    expect((await rpc(master, "pedido_config_salvar", { _dados: { preco_virada_em: "2020-01-01" } })).erro).toContain("não editável");
    const r = await rpc<{ prazo_correio_dias: number }>(master, "pedido_config_salvar", { _dados: { prazo_correio_dias: 5 } });
    expect(r.dados.prazo_correio_dias).toBe(5);
    await rpc(master, "pedido_config_salvar", { _dados: { prazo_correio_dias: 7 } });
  });
});
