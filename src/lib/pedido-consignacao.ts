/**
 * Pedido de consignação (folha A4) — modelo aprovado em 26/10/2026.
 * Puro: recebe os dados de kit_pedido_dados e devolve o HTML das páginas, já paginado.
 *  - Página 1: cabeçalho, Consultora/Representante/Montado por, faixa de valores, bloco de ganho, itens.
 *  - Páginas seguintes: cabeçalho de 1 linha + itens.
 *  - Última: TOTAL DO KIT + Garantia + Montagem do próximo kit + Pagamento/Pix.
 *  - Itens agrupados por tipo com subtotal; sem assinatura e sem colunas vendeu/devolveu.
 *  - "Postar a maleta até" só quando a remessa é pelo correio.
 */

export type GrupoPeca = "aneis" | "brincos" | "colares" | "pulseiras" | "tornozeleiras" | "piercing" | "outros";

export const GRUPOS: { id: GrupoPeca; rotulo: string }[] = [
  { id: "aneis", rotulo: "Anéis" },
  { id: "brincos", rotulo: "Brincos" },
  { id: "colares", rotulo: "Colares e conjuntos" },
  { id: "pulseiras", rotulo: "Pulseiras" },
  { id: "tornozeleiras", rotulo: "Tornozeleiras" },
  { id: "piercing", rotulo: "Piercing" },
  { id: "outros", rotulo: "Outras peças" },
];

export interface FaixaPedido { min_cents: number; percentual: number }

export interface PedidoDados {
  empresa: {
    endereco_linha: string; pedidos_telefone: string; pedidos_email: string; pagamento_texto: string;
    pix_tipo: string; pix_chave: string; pix_favorecido: string; garantia_titulo: string; garantia_texto: string;
    garantia_exclusoes: string; montagem_texto: string; rodape_texto: string; prazo_correio_dias: number;
  };
  remessa: { numero: number | null; kit: number; tipo_envio: "pessoal" | "correio"; data_acerto: string | null; postar_ate: string | null };
  maleta: string | null;
  cliente_codigo: string | null;
  consultora: { nome: string; endereco: string | null; cidade: string | null; whatsapp: string | null };
  representante: { nome: string | null; praca: string | null; telefone: string | null } | null;
  montado_por: string | null;
  faixas: FaixaPedido[];
  itens: { variant_id: string; sku: string | null; descricao: string; preco_cents: number; quantidade: number; grupo: GrupoPeca }[];
}

// ---------------------------------------------------------------- formatação
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** **negrito** do texto configurável vira <strong>, depois de escapar o resto. */
const rico = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

export const reais = (cents: number) =>
  (Number(cents) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const brl = (cents: number) => `R$ ${reais(cents)}`;
/** R$ 200 (sem centavos quando é redondo), R$ 199,99 quando não é. */
const brlCurto = (cents: number) =>
  Number(cents) % 100 === 0 ? `R$ ${(Number(cents) / 100).toLocaleString("pt-BR")}` : brl(cents);
const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const diaMes = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().slice(0, 2).join("/") : "—");
const num = (n: number | null, casas: number) => (n == null ? "—" : String(n).padStart(casas, "0"));

/** +5544999176598 → (44) 99917-6598; fixo (43) 3234-5678; o que não for telefone volta como veio. */
export function fone(s: string | null | undefined) {
  if (!s) return "";
  let d = s.replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return s;
}

/** "Beatriz Oliveira Alexandre da Silva" → "Beatriz O. A. da Silva" */
export function nomeCurto(nome: string) {
  const partes = nome.trim().split(/\s+/);
  if (partes.length <= 2) return nome.trim();
  const particulas = new Set(["da", "de", "do", "das", "dos", "e"]);
  const primeiro = partes[0]!;
  let fim = partes.length - 1;
  const ultimo = [partes[fim]!];
  if (fim - 1 > 0 && particulas.has(partes[fim - 1]!.toLowerCase())) { ultimo.unshift(partes[fim - 1]!); fim -= 1; }
  const meio = partes.slice(1, fim).filter((p) => !particulas.has(p.toLowerCase())).map((p) => `${p[0]!.toUpperCase()}.`);
  return [primeiro, ...meio, ...ultimo].join(" ");
}

// ---------------------------------------------------------------- comissão
export function faixaDe(vendidoCents: number, faixas: FaixaPedido[]): FaixaPedido | null {
  let achada: FaixaPedido | null = null;
  for (const f of [...faixas].sort((a, b) => a.min_cents - b.min_cents)) if (vendidoCents >= Number(f.min_cents)) achada = f;
  return achada;
}
export const ganho = (vendidoCents: number, faixas: FaixaPedido[]) => {
  const f = faixaDe(vendidoCents, faixas);
  return { cents: f ? Math.round((vendidoCents * Number(f.percentual)) / 100) : 0, pct: f ? Number(f.percentual) : 0 };
};

/** Cartões "Cada venda aumenta o seu ganho": as duas maiores faixas que cabem no kit + metade do kit. */
export function cartoesGanho(totalCents: number, faixas: FaixaPedido[]) {
  const degraus = [...faixas].map((f) => Number(f.min_cents)).filter((m) => m > 0 && m <= totalCents).sort((a, b) => a - b).slice(-2);
  const cartoes = degraus.map((m) => ({ titulo: `Vendendo ${brlCurto(m)}`, ...ganho(m, faixas), destaque: false }));
  const metade = Math.round(totalCents / 2);
  if (metade > 0) cartoes.push({ titulo: "Vendendo metade do kit", ...ganho(metade, faixas), destaque: true });
  return cartoes;
}

export function textoFaixas(faixas: FaixaPedido[]) {
  const ord = [...faixas].sort((a, b) => Number(a.min_cents) - Number(b.min_cents));
  return ord.map((f, i) => {
    const pct = `${Number(f.percentual).toLocaleString("pt-BR")}%`;
    const t = i === 0 && ord[1] ? `${pct} até ${brl(Number(ord[1].min_cents) - 1)}` : `${pct} a partir de ${brlCurto(Number(f.min_cents))}`;
    return i === ord.length - 1 ? `<strong>${esc(t)}</strong>` : esc(t);
  }).join(" · ");
}

// ---------------------------------------------------------------- paginação
type Linha = { tipo: "grupo"; rotulo: string; subtotal: number; qtd: number; continua: boolean }
  | { tipo: "item"; sku: string; descricao: string; preco: number; qtd: number };

/** Alturas em mm (iguais às do CSS abaixo). */
// Medidos no Chromium (A4, margens 12 mm): linha 5,0 mm; grupo 7,5 mm; tabela começa a 137,4 mm na pág. 1 e a 28 mm nas demais;
// cabeçalho da tabela 7 mm; rodapé a 284,3 mm (deixamos 3 mm de respiro); fechamento (total + garantia + Pix) 68 mm.
const ALT = { item: 5.0, grupo: 7.5, pag1: 133.5, pagN: 245, fim: 70 };

export function montarLinhas(itens: PedidoDados["itens"]) {
  const out: { grupo: GrupoPeca; rotulo: string; itens: PedidoDados["itens"]; subtotal: number; qtd: number }[] = [];
  for (const g of GRUPOS) {
    const lista = itens.filter((i) => (GRUPOS.some((x) => x.id === i.grupo) ? i.grupo : "outros") === g.id)
      .sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR"));
    if (!lista.length) continue;
    out.push({ grupo: g.id, rotulo: g.rotulo, itens: lista,
      subtotal: lista.reduce((s, i) => s + i.preco_cents * i.quantidade, 0), qtd: lista.reduce((s, i) => s + i.quantidade, 0) });
  }
  return out;
}

export function paginar(grupos: ReturnType<typeof montarLinhas>): Linha[][] {
  const paginas: Linha[][] = [[]];
  let livre = ALT.pag1;
  const nova = () => { paginas.push([]); livre = ALT.pagN; };
  for (const g of grupos) {
    let primeira = true;
    for (const it of g.itens) {
      const precisa = (primeira ? ALT.grupo : 0) + ALT.item;
      if (livre < precisa) { nova(); if (!primeira) { paginas.at(-1)!.push({ tipo: "grupo", rotulo: `${g.rotulo} (continuação)`, subtotal: 0, qtd: 0, continua: true }); livre -= ALT.grupo; } }
      if (primeira) { paginas.at(-1)!.push({ tipo: "grupo", rotulo: g.rotulo, subtotal: g.subtotal, qtd: g.qtd, continua: false }); livre -= ALT.grupo; primeira = false; }
      paginas.at(-1)!.push({ tipo: "item", sku: it.sku ?? "—", descricao: it.descricao, preco: it.preco_cents, qtd: it.quantidade });
      livre -= ALT.item;
    }
  }
  if (livre < ALT.fim) {
    // O fechamento não cabe: em vez de uma folha só com o rodapé, leva as últimas peças junto (nunca página quase vazia).
    const ant = paginas.at(-1)!;
    const mover: Linha[] = [];
    while (mover.length < 8 && ant.length > 1 && ant.at(-1)!.tipo === "item") mover.unshift(ant.pop()!);
    if (ant.at(-1)?.tipo === "grupo" && mover.length) mover.unshift(ant.pop()!);
    if (mover.length && mover[0]!.tipo === "item") {
      let g: Linha | undefined;
      for (const l of [...ant].reverse()) if (l.tipo === "grupo") { g = l; break; }
      if (g && g.tipo === "grupo") mover.unshift({ tipo: "grupo", rotulo: g.continua ? g.rotulo : `${g.rotulo} (continuação)`, subtotal: 0, qtd: 0, continua: true });
    }
    paginas.push(mover);
  }
  return paginas;
}

// ---------------------------------------------------------------- HTML
export const CSS_PEDIDO = `
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
body{font-family:'Jost',Arial,sans-serif;color:#2B201C;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pg{width:210mm;height:297mm;padding:10mm 12mm 0;position:relative;overflow:hidden;page-break-after:always;break-after:page}
.pg:last-child{page-break-after:auto;break-after:auto}
.serif{font-family:'Cormorant Garamond',Georgia,serif}
.eyebrow{font-size:6.6pt;letter-spacing:.28em;text-transform:uppercase;color:#7A5642;font-weight:500}
.cab{display:flex;justify-content:space-between;align-items:flex-start;height:23mm;border-bottom:.35mm solid #C49A7C}
.marca{display:flex;align-items:center;gap:5mm}
.marca img{width:14mm;height:auto}
.marca .nome{font-family:'Cormorant Garamond',Georgia,serif;font-size:27pt;letter-spacing:.32em;line-height:1;color:#2B201C}
.marca .end{font-size:7.6pt;color:#7A5642;margin-top:2.6mm;letter-spacing:.01em}
.dir{display:flex;gap:4mm;align-items:flex-start}
.dir .txt{text-align:right}
.dir .rem{font-family:'Cormorant Garamond',Georgia,serif;font-size:20pt;line-height:1.15;margin-top:1.6mm}
.dir .kit{font-size:8.4pt;margin-top:.6mm}
.qr{width:17mm;height:17mm;border:.3mm dashed #C49A7C;border-radius:2mm;display:flex;align-items:center;justify-content:center;text-align:center;font-size:5.6pt;color:#7A5642;line-height:1.3;padding:1mm}
.cartoes{display:grid;grid-template-columns:1.42fr 1fr .95fr;gap:3mm;margin-top:4mm;height:23mm}
.cartao{border:.3mm solid #E7D8CB;border-radius:2.4mm;padding:3.2mm 3.4mm 2mm;overflow:hidden}
.cartao .t{font-size:10.2pt;font-weight:600;margin:1.8mm 0 1.2mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cartao .l{font-size:8pt;line-height:1.55}
.faixa{display:flex;margin-top:3.4mm;border:.35mm solid #2B201C;border-radius:2.4mm;overflow:hidden;height:19mm}
.faixa>div{padding:3.4mm 3.6mm 2mm;border-right:.3mm solid #E7D8CB}
.faixa>div:last-child{border-right:0}
.faixa .total{background:#2B201C;color:#fff;flex:1.62}
.faixa .total .eyebrow{color:#E9D9CC}
.faixa .total .v{font-family:'Cormorant Garamond',Georgia,serif;font-size:24pt;line-height:1.1;margin-top:1mm}
.faixa .pecas{flex:.75}.faixa .pecas .v{font-size:17pt;font-weight:600;margin-top:1mm}
.faixa .acerto{flex:1.18}.faixa .acerto .v{font-size:17pt;font-weight:600;color:#7A5642;margin-top:1mm}
.faixa .postar{flex:1.46;background:#F6EFE8}.faixa .postar .v{font-size:17pt;font-weight:600;margin-top:1mm}
.faixa .postar .obs{font-size:6pt;color:#7A5642;margin-top:.4mm}
.ganho{display:flex;align-items:stretch;margin-top:3.4mm;border:.3mm solid #E7D8CB;border-radius:2.4mm;overflow:hidden}
.ganho .esq{background:#7A5642;color:#fff;width:62mm;flex-shrink:0;padding:5mm 4.6mm 4mm}
.ganho .esq .eyebrow{color:#F1E3D7;letter-spacing:.22em;white-space:nowrap}
.ganho .esq .v{font-family:'Cormorant Garamond',Georgia,serif;font-size:30pt;line-height:1;margin:3mm 0 2.6mm;white-space:nowrap}
.ganho .esq .s{font-size:7.9pt;line-height:1.5}
.ganho .dirg{flex:1;background:#F6EFE8;padding:3.4mm 4mm}
.ganho h3{font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:15pt;margin:0 0 2mm}
.ganho .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:2.4mm}
.ganho .card{background:#fff;border:.3mm solid #E7D8CB;border-radius:2mm;padding:2.6mm 2.8mm}
.ganho .card.d{background:#2B201C;color:#fff;border-color:#2B201C}
.ganho .card .a{font-size:7pt}.ganho .card .b{font-size:13pt;font-weight:600;margin:1mm 0 .6mm}.ganho .card .c{font-size:6.6pt;color:#7A5642}
.ganho .card.d .c{color:#E9D9CC}
.ganho .regra{font-size:6.6pt;line-height:1.5;color:#4A3A33;margin-top:2.4mm;white-space:normal}
table{width:186mm;table-layout:fixed;border-collapse:collapse;margin-top:6mm}
.pg+.pg table,.cab2+table{margin-top:4mm}
th{font-size:6.6pt;letter-spacing:.16em;white-space:nowrap;text-transform:uppercase;color:#7A5642;font-weight:500;text-align:left;padding:0 2mm 1.6mm;border-bottom:.45mm solid #2B201C;height:7mm;vertical-align:bottom}
th.r,td.r{text-align:right}th.q,td.q{text-align:center}
td{font-size:7.8pt;height:5mm;line-height:4.8mm;padding:0 2mm;border-bottom:.2mm solid #EFE4DA;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
td.t{font-weight:600}
tr.g td{background:#F6EFE8;height:7.4mm;line-height:7.2mm;font-size:7.6pt;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:#7A5642;border-bottom:.3mm solid #E2D1C3}
tr.g td.r,tr.g td.q{font-size:8pt;letter-spacing:.06em}
.cab2{display:flex;justify-content:space-between;align-items:center;height:14mm;padding-bottom:1mm;border-bottom:.35mm solid #C49A7C}
.cab2 .marca img{width:9mm}.cab2 .marca .nome{font-size:15pt}
.cab2 .info{font-size:8pt}
.fimtab{width:186mm;display:flex;justify-content:space-between;align-items:center;background:#2B201C;color:#fff;padding:0 2mm 0 3mm;height:9mm;font-weight:600;font-size:9.5pt}
.fimtab .v{display:flex;font-size:10pt}
.fimtab .v .q{width:14mm;text-align:center}.fimtab .v .r{width:26mm;text-align:right}
.blocos{display:grid;grid-template-columns:1.32fr 1fr;gap:4mm;margin-top:5mm}
.box{border:.3mm solid #E7D8CB;border-radius:2.4mm;padding:3.8mm 4mm 2.4mm}
.box h4{font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:14pt;margin:0 0 2mm}
.box p{font-size:7.3pt;line-height:1.55;margin:0 0 1.8mm;color:#4A3A33}
.pix{background:#F6EFE8;border-radius:2.4mm;padding:3mm 3.6mm;display:flex;gap:3.4mm;align-items:center;margin-top:3mm}
.pix .qr{width:16mm;height:16mm;flex-shrink:0}
.pix p{font-size:7.3pt;line-height:1.6;margin:0}
.rod{position:absolute;left:12mm;right:12mm;bottom:7mm;gap:4mm;display:flex;justify-content:space-between;border-top:.2mm solid #C49A7C;padding-top:2mm;font-size:6.8pt;color:#7A5642}
`;

export function htmlPedidoConsignacao(d: PedidoDados, opcoes: { logoUrl: string; operador: string; impressoEm: Date }) {
  const grupos = montarLinhas(d.itens);
  const paginas = paginar(grupos);
  const total = d.itens.reduce((s, i) => s + i.preco_cents * i.quantidade, 0);
  const pecas = d.itens.reduce((s, i) => s + i.quantidade, 0);
  const max = ganho(total, d.faixas);
  const correio = d.remessa.tipo_envio === "correio";
  const remessa = num(d.remessa.numero, 5);
  const kit = num(d.remessa.kit, 3);
  const cliente = d.cliente_codigo ?? "—";
  const impresso = `${opcoes.impressoEm.toLocaleDateString("pt-BR")} ${opcoes.impressoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  const marca = (pequena = false) => `<div class="marca"><img src="${esc(opcoes.logoUrl)}" alt=""><div><div class="nome">LARDAN</div>${pequena ? "" : `<div class="end">${esc(d.empresa.endereco_linha)}</div>`}</div></div>`;
  const rodape = (i: number) => `<div class="rod"><span>${esc(d.empresa.rodape_texto)}</span><span>Impresso em ${esc(impresso)} · ${esc(opcoes.operador)} · Página ${i + 1} de ${paginas.length}</span></div>`;
  const linhas = (ls: Linha[]) => ls.map((l) => l.tipo === "grupo"
    ? `<tr class="g"><td colspan="3">${esc(l.rotulo)}${l.continua ? "" : ` · ${l.qtd} ${l.qtd === 1 ? "peça" : "peças"}`}</td><td class="q">${l.continua ? "" : l.qtd}</td><td class="r">${l.continua ? "" : esc(brl(l.subtotal))}</td></tr>`
    : `<tr><td class="cod">${esc(l.sku)}</td><td>${esc(l.descricao)}</td><td class="r">${esc(reais(l.preco))}</td><td class="q">${l.qtd}</td><td class="r t">${esc(reais(l.preco * l.qtd))}</td></tr>`).join("");
  const tabela = (ls: Linha[]) => ls.length
    ? `<table><colgroup><col style="width:24mm"><col><col style="width:24mm"><col style="width:14mm"><col style="width:26mm"></colgroup><thead><tr><th>Código</th><th>Descrição</th><th class="r">Valor unit. R$</th><th class="q">Qtd</th><th class="r">Total R$</th></tr></thead><tbody>${linhas(ls)}</tbody></table>`
    : "";
  const rep = d.representante;

  const pagina1 = `
  <div class="cab">${marca()}
    <div class="dir"><div class="txt"><div class="eyebrow">Pedido de consignação</div>
      <div class="rem">Remessa ${esc(remessa)}</div><div class="kit">Kit ${esc(kit)} · Cliente ${esc(cliente)}</div></div>
      <div class="qr">[QR do pedido no app]</div></div>
  </div>
  <div class="cartoes">
    <div class="cartao"><div class="eyebrow">Consultora</div><div class="t">${esc(d.consultora.nome)}</div>
      <div class="l">${esc(d.consultora.endereco ?? "Endereço não cadastrado")}<br>${esc(d.consultora.cidade ?? "")}${d.consultora.whatsapp ? ` · WhatsApp ${esc(fone(d.consultora.whatsapp))}` : ""}</div></div>
    <div class="cartao"><div class="eyebrow">Representante</div><div class="t">${esc(rep?.nome ?? "—")}</div>
      <div class="l">${rep?.praca ? `Praça ${esc(rep.praca)}` : "&nbsp;"}<br>${esc(fone(rep?.telefone))}</div></div>
    <div class="cartao"><div class="eyebrow">Montado por</div><div class="t">${esc(d.montado_por ?? "—")}</div>
      <div class="l">Pedidos ${esc(d.empresa.pedidos_telefone)}<br>${esc(d.empresa.pedidos_email)}</div></div>
  </div>
  <div class="faixa">
    <div class="total"><div class="eyebrow">Valor total do kit</div><div class="v">${esc(brl(total))}</div></div>
    <div class="pecas"><div class="eyebrow">Peças</div><div class="v">${pecas}</div></div>
    <div class="acerto"><div class="eyebrow">Data do acerto</div><div class="v">${esc(dataBr(d.remessa.data_acerto))}</div></div>
    ${correio ? `<div class="postar"><div class="eyebrow">Postar a maleta até</div><div class="v">${esc(dataBr(d.remessa.postar_ate))}</div><div class="obs">Só para envio pelo correio</div></div>` : ""}
  </div>
  <div class="ganho">
    <div class="esq"><div class="eyebrow">Este kit pode render pra você</div><div class="v">${esc(brl(max.cents))}</div>
      <div class="s">de ganho, vendendo as ${pecas} peças até o dia <strong>${esc(diaMes(d.remessa.data_acerto))}</strong></div></div>
    <div class="dirg"><h3>Cada venda aumenta o seu ganho</h3>
      <div class="cards">${cartoesGanho(total, d.faixas).map((c) => `<div class="card${c.destaque ? " d" : ""}"><div class="a">${esc(c.titulo)}</div><div class="b">${esc(brl(c.cents))}</div><div class="c">no seu bolso · ${c.pct.toLocaleString("pt-BR")}%</div></div>`).join("")}</div>
      <div class="regra">Sua comissão sobe conforme o total vendido no ciclo e vale sobre <strong>tudo</strong>: ${textoFaixas(d.faixas)}</div></div>
  </div>`;

  const cab2 = `<div class="cab2">${marca(true)}<div class="info">Remessa <strong>${esc(remessa)}</strong> · Kit ${esc(kit)} · Cliente ${esc(cliente)} · ${esc(nomeCurto(d.consultora.nome))} · Acerto <strong style="color:#7A5642">${esc(dataBr(d.remessa.data_acerto))}</strong></div></div>`;

  const final = `
  <div class="fimtab" style="margin-top:${paginas.at(-1)!.length ? "0" : "3.6mm"}"><span>TOTAL DO KIT</span><span class="v"><span class="q">${pecas}</span><span class="r">${esc(brl(total))}</span></span></div>
  <div class="blocos">
    <div class="box"><h4>${esc(d.empresa.garantia_titulo)}</h4><p>${rico(d.empresa.garantia_texto)}</p><p>${rico(d.empresa.garantia_exclusoes)}</p></div>
    <div><div class="box"><h4>Montagem do próximo kit</h4><p>${rico(d.empresa.montagem_texto)}</p></div>
      <div class="pix"><div class="qr">[QR Pix]</div><p><strong>Pagamento:</strong> ${rico(d.empresa.pagamento_texto)}<br>Pix (${esc(d.empresa.pix_tipo)}) <strong>${esc(d.empresa.pix_chave)}</strong><br>${esc(d.empresa.pix_favorecido)}</p></div></div>
  </div>`;

  return paginas.map((ls, i) => `<section class="pg">${i === 0 ? pagina1 : cab2}${tabela(ls)}${i === paginas.length - 1 ? final : ""}${rodape(i)}</section>`).join("");
}

export function documentoPedido(d: PedidoDados, opcoes: { logoUrl: string; operador: string; impressoEm: Date }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido de consignação — Remessa ${esc(num(d.remessa.numero, 5))}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Jost:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS_PEDIDO}</style></head><body>${htmlPedidoConsignacao(d, opcoes)}</body></html>`;
}
