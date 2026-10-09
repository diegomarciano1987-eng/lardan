import logo from "@/assets/lardan-wordmark.png.asset.json";

const FORMA: Record<string, string> = { dinheiro: "Dinheiro", debito: "Cartão de débito", credito: "Cartão de crédito", pix: "Pix", link_cartao: "Cartão de crédito (link Asaas)" };
const brl = (c: number) => ((Number(c) || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[m]!);

/** Monta o comprovante (não fiscal) da venda em HTML: cupom 80mm (impressora térmica) ou A4. */
export function cupomHtml(c: any, formato: "termica" | "a4", origem: string): string {
  const data = new Date(c.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const itens = (c.itens ?? []) as any[];
  const pags = (c.pagamentos ?? []) as any[];
  const logoUrl = origem + logo.url;
  const cliente = c.cliente_nome ?? c.cliente ?? "";
  const linhasPag = pags.map((p) => `<div class="row"><span>${esc(FORMA[p.forma] ?? p.forma)}${p.parcelas > 1 ? ` ${p.parcelas}x` : ""}${p.status === "pendente" ? " · aguardando" : ""}</span><span>${brl(p.valor)}</span></div>${p.troco ? `<div class="row muted"><span>Troco</span><span>${brl(p.troco)}</span></div>` : ""}`).join("");

  if (formato === "termica") {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Comprovante ${esc(c.codigo)}</title><style>
@page{size:80mm auto;margin:0}*{box-sizing:border-box}body{margin:0;font:12px/1.35 "Helvetica Neue",Arial,sans-serif;color:#000}
.c{width:72mm;margin:0 auto;padding:4mm 0 6mm}.ctr{text-align:center}img{width:42mm;filter:grayscale(1) contrast(1.4)}
.sep{border-top:1px dashed #000;margin:6px 0}.row{display:flex;justify-content:space-between;gap:6px}.muted{color:#333;font-size:11px}
.it{margin:4px 0}.it b{font-weight:600}.tot{font-size:16px;font-weight:700;margin-top:4px}.tag{letter-spacing:.2em;font-size:10px;text-transform:uppercase}
</style></head><body><div class="c">
<div class="ctr"><img src="${logoUrl}" alt="Lardan"/><div class="tag" style="margin-top:4px">Semijoias</div><div style="margin-top:4px;font-weight:600">${esc(c.loja)}</div></div>
<div class="sep"></div><div class="ctr tag">Comprovante de venda</div><div class="ctr" style="font-size:15px;font-weight:700">Nº ${esc(c.codigo)}</div>
<div class="row muted"><span>${esc(data)}</span></div><div class="muted">Atendimento: ${esc(c.vendedora)}</div>${cliente ? `<div class="muted">Cliente: ${esc(cliente)}</div>` : ""}
<div class="sep"></div>${itens.map((i) => `<div class="it"><b>${esc(i.nome)}</b><div class="row muted"><span>${i.qtd} × ${brl(i.total / (i.qtd || 1))}</span><span>${brl(i.total)}</span></div></div>`).join("")}
<div class="sep"></div><div class="row"><span>Subtotal</span><span>${brl(c.subtotal)}</span></div>${c.desconto ? `<div class="row"><span>Desconto</span><span>− ${brl(c.desconto)}</span></div>` : ""}
<div class="row tot"><span>TOTAL</span><span>${brl(c.total)}</span></div><div class="sep"></div>${linhasPag}
<div class="sep"></div><div class="ctr muted">Obrigada pela preferência!</div>${c.rodape ? `<div class="ctr muted">${esc(c.rodape)}</div>` : ""}<div class="ctr muted" style="margin-top:4px">lardan.com.br · Documento sem valor fiscal</div>
</div><script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><title>Comprovante ${esc(c.codigo)} — Lardan</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Karla:wght@400;600&display=swap" rel="stylesheet"><style>
@page{size:A4;margin:16mm}*{box-sizing:border-box}body{margin:0;font:13px/1.5 Karla,Arial,sans-serif;color:#2a2420;background:#fff}
.pg{max-width:178mm;margin:0 auto}.hd{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:14px;border-bottom:2px solid #b08d57}
.hd img{height:44px}.num{text-align:right}.num small{display:block;letter-spacing:.25em;text-transform:uppercase;color:#8a7a68;font-size:10px}
.num b{font:600 30px "Cormorant Garamond",serif;color:#2a2420}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:20px 0}
.meta div{background:#faf6f0;border-radius:8px;padding:10px 12px}.meta small{display:block;color:#8a7a68;font-size:10px;letter-spacing:.15em;text-transform:uppercase}
table{width:100%;border-collapse:collapse}th{text-align:left;font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:#8a7a68;border-bottom:1px solid #e6dccd;padding:8px 6px}
td{padding:10px 6px;border-bottom:1px solid #f0e8dc}.r{text-align:right}.bx{display:flex;justify-content:space-between;gap:24px;margin-top:22px}
.pag{flex:1}.pag h4,.sum h4{font:600 16px "Cormorant Garamond",serif;margin:0 0 8px}.row{display:flex;justify-content:space-between;padding:3px 0}.muted{color:#8a7a68}
.sum{width:42%;background:#faf6f0;border-radius:10px;padding:14px 16px}.tot{border-top:1px solid #d9c9b0;margin-top:8px;padding-top:8px;font:600 22px "Cormorant Garamond",serif}
.ft{margin-top:36px;padding-top:12px;border-top:1px solid #e6dccd;text-align:center;color:#8a7a68;font-size:11px}.ft b{font:600 15px "Cormorant Garamond",serif;color:#b08d57;display:block}
</style></head><body><div class="pg">
<div class="hd"><div><img src="${logoUrl}" alt="Lardan"/><div class="muted" style="margin-top:6px">${esc(c.loja)}</div></div><div class="num"><small>Comprovante de venda</small><b>Nº ${esc(c.codigo)}</b></div></div>
<div class="meta"><div><small>Data e hora</small>${esc(data)}</div><div><small>Atendimento</small>${esc(c.vendedora)}</div><div><small>Cliente</small>${esc(cliente || "Não identificada")}</div></div>
<table><thead><tr><th>Peça</th><th class="r">Qtd</th><th class="r">Unitário</th><th class="r">Total</th></tr></thead><tbody>
${itens.map((i) => `<tr><td>${esc(i.nome)}</td><td class="r">${i.qtd}</td><td class="r">${brl(i.total / (i.qtd || 1))}</td><td class="r">${brl(i.total)}</td></tr>`).join("")}</tbody></table>
<div class="bx"><div class="pag"><h4>Pagamento</h4>${linhasPag}</div><div class="sum"><div class="row"><span>Subtotal</span><span>${brl(c.subtotal)}</span></div>${c.desconto ? `<div class="row"><span>Desconto</span><span>− ${brl(c.desconto)}</span></div>` : ""}<div class="row tot"><span>Total</span><span>${brl(c.total)}</span></div></div></div>
<div class="ft"><b>Obrigada pela preferência!</b>${c.rodape ? esc(c.rodape) + "<br>" : ""}lardan.com.br · Documento sem valor fiscal</div>
</div><script>window.onload=()=>setTimeout(()=>window.print(),500)</script></body></html>`;
}

export function abrirCupom(c: any, formato: "termica" | "a4") {
  const w = window.open("", "_blank", formato === "termica" ? "width=420,height=760" : "width=900,height=1000");
  if (!w) throw new Error("O navegador bloqueou a janela. Libere pop-ups para este site.");
  w.document.write(cupomHtml(c, formato, window.location.origin));
  w.document.close();
}
