/**
 * DANFE em layout compacto (retrato, A4), gerado a partir do XML AUTORIZADO
 * (nfeProc). Uma linha por item — a maleta de 70 peças cabe em 2 páginas, em
 * vez das 5+ do DANFE da Focus (que imprime um quadro de impostos da reforma
 * tributária em cada item, mesmo zerado).
 *
 * Pura: recebe o XML e devolve o HTML para impressão (código de barras
 * CODE-128C da chave em SVG). Sem rede, sem banco.
 */
import JsBarcode from "jsbarcode";

/** SVG do código de barras CODE-128C da chave de acesso (44 dígitos). */
export function svgCodigoBarras(chave: string): string {
  const c = chave.replace(/\D/g, "");
  if (c.length !== 44) return "";
  const alvo: { encodings?: { data: string }[] } = {};
  JsBarcode(alvo as unknown as SVGElement, c, { format: "CODE128C", displayValue: false, margin: 0 });
  const bits = (alvo.encodings ?? []).map((e) => e.data).join("");
  let x = 0, rects = "";
  for (const b of bits) { if (b === "1") rects += `<rect x="${x}" y="0" width="1" height="40"/>`; x++; }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} 40" preserveAspectRatio="none">${rects}</svg>`;
}

const tag = (xml: string, nome: string): string | null => {
  const m = new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`).exec(xml);
  return m ? m[1]! : null;
};
const tags = (xml: string, nome: string): string[] =>
  [...xml.matchAll(new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`, "g"))].map((m) => m[1]!);
const txt = (xml: string | null, nome: string) => {
  const v = xml ? tag(xml, nome) : null;
  return v == null ? "" : decodificar(v.trim());
};
function decodificar(s: string) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (s: string) => Number(s || 0);
const brl = (v: number, casas = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const qtd = (v: number) => (Number.isInteger(v) ? String(v) : brl(v, 4));
const dataHora = (iso: string) => {
  if (!iso) return "";
  const [d, h] = iso.split("T");
  return `${d!.split("-").reverse().join("/")}${h ? ` ${h.slice(0, 8)}` : ""}`;
};
const doc = (s: string) =>
  s.length === 14 ? s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
  : s.length === 11 ? s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4") : s;
const cep = (s: string) => s.replace(/^(\d{5})(\d{3})$/, "$1-$2");
export const chaveFormatada = (c: string) => c.replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ");

export interface ItemDanfe {
  n: number; codigo: string; descricao: string; ncm: string; cst: string; cfop: string; un: string;
  qtd: number; unit: number; total: number;
}
export interface DadosDanfe {
  chave: string; numero: string; serie: string; tpNF: string; natOp: string; emissao: string; saida: string;
  homologacao: boolean;
  protocolo: string; dhProtocolo: string; cancelada: boolean;
  emit: { nome: string; fantasia: string; cnpj: string; ie: string; endereco: string; cidade: string; fone: string; crt: string };
  dest: { nome: string; doc: string; ie: string; endereco: string; bairro: string; cep: string; cidade: string; uf: string; fone: string };
  totais: { produtos: number; frete: number; seguro: number; desconto: number; outras: number; ipi: number; bcIcms: number; icms: number; nota: number };
  modFrete: string;
  itens: ItemDanfe[];
  infCpl: string; infFisco: string;
}

/** Lê o XML autorizado (nfeProc) ou a NFe sem protocolo. */
export function lerNfe(xml: string): DadosDanfe {
  const inf = tag(xml, "infNFe") ?? "";
  const idChave = /Id="NFe(\d{44})"/.exec(xml)?.[1] ?? "";
  const ide = tag(inf, "ide");
  const emit = tag(inf, "emit");
  const ee = emit ? tag(emit, "enderEmit") : null;
  const dest = tag(inf, "dest");
  const ed = dest ? tag(dest, "enderDest") : null;
  const tot = tag(inf, "ICMSTot");
  const prot = tag(xml, "infProt");
  const itens: ItemDanfe[] = tags(inf, "det").map((d, i) => {
    const p = tag(d, "prod") ?? "";
    const imp = tag(d, "ICMS") ?? "";
    const cst = (txt(imp, "orig") || "0") + (txt(imp, "CSOSN") || txt(imp, "CST"));
    return {
      n: i + 1, codigo: txt(p, "cProd"), descricao: txt(p, "xProd"), ncm: txt(p, "NCM"), cst, cfop: txt(p, "CFOP"),
      un: txt(p, "uCom"), qtd: num(txt(p, "qCom")), unit: num(txt(p, "vUnCom")), total: num(txt(p, "vProd")),
    };
  });
  const lgr = (e: string | null) => [txt(e, "xLgr"), txt(e, "nro"), txt(e, "xCpl")].filter(Boolean).join(", ");
  return {
    chave: txt(prot, "chNFe") || idChave,
    numero: txt(ide, "nNF"), serie: txt(ide, "serie"), tpNF: txt(ide, "tpNF"), natOp: txt(ide, "natOp"),
    emissao: txt(ide, "dhEmi"), saida: txt(ide, "dhSaiEnt"), homologacao: txt(ide, "tpAmb") === "2",
    protocolo: txt(prot, "nProt"), dhProtocolo: txt(prot, "dhRecbto"), cancelada: false,
    emit: {
      nome: txt(emit, "xNome"), fantasia: txt(emit, "xFant"), cnpj: txt(emit, "CNPJ"), ie: txt(emit, "IE"), crt: txt(emit, "CRT"),
      endereco: `${lgr(ee)} - ${txt(ee, "xBairro")}`, cidade: `${txt(ee, "xMun")}/${txt(ee, "UF")} - CEP ${cep(txt(ee, "CEP"))}`, fone: txt(ee, "fone"),
    },
    dest: {
      nome: txt(dest, "xNome"), doc: txt(dest, "CPF") || txt(dest, "CNPJ"), ie: txt(dest, "IE"),
      endereco: lgr(ed), bairro: txt(ed, "xBairro"), cep: cep(txt(ed, "CEP")), cidade: txt(ed, "xMun"), uf: txt(ed, "UF"), fone: txt(ed, "fone"),
    },
    totais: {
      produtos: num(txt(tot, "vProd")), frete: num(txt(tot, "vFrete")), seguro: num(txt(tot, "vSeg")), desconto: num(txt(tot, "vDesc")),
      outras: num(txt(tot, "vOutro")), ipi: num(txt(tot, "vIPI")), bcIcms: num(txt(tot, "vBC")), icms: num(txt(tot, "vICMS")), nota: num(txt(tot, "vNF")),
    },
    modFrete: txt(tag(inf, "transp"), "modFrete"),
    itens,
    infCpl: txt(tag(inf, "infAdic"), "infCpl"), infFisco: txt(tag(inf, "infAdic"), "infAdFisco"),
  };
}

const FRETE: Record<string, string> = { "0": "0-Emitente", "1": "1-Destinatário", "2": "2-Terceiros", "3": "3-Próprio remetente", "4": "4-Próprio destinatário", "9": "9-Sem frete" };
const ITENS_PAG1 = 46;
const ITENS_DEMAIS = 70;

/** Páginas: a primeira com o cabeçalho completo, as demais só com o quadro de itens. */
export function paginarItens<T>(itens: T[], pag1 = ITENS_PAG1, demais = ITENS_DEMAIS): T[][] {
  const paginas: T[][] = [itens.slice(0, pag1)];
  for (let i = pag1; i < itens.length; i += demais) paginas.push(itens.slice(i, i + demais));
  return paginas;
}

export function htmlDanfeCompacto(d: DadosDanfe, codigoBarrasSvg = svgCodigoBarras(d.chave)): string {
  const paginas = paginarItens(d.itens);
  const total = paginas.length;
  const cab = (pag: number) => `
  <table class="cab"><tr>
    <td class="emit"><b>${esc(d.emit.nome)}</b><br>${esc(d.emit.endereco)}<br>${esc(d.emit.cidade)}${d.emit.fone ? `<br>Fone: ${esc(d.emit.fone)}` : ""}</td>
    <td class="danfe"><b class="g">DANFE</b><br>Documento Auxiliar da<br>Nota Fiscal Eletrônica<br>
      <span class="es">${d.tpNF === "0" ? "<b>0</b>" : "0"} - ENTRADA<br>${d.tpNF === "1" ? "<b>1</b>" : "1"} - SAÍDA</span>
      <span class="box">${esc(d.tpNF)}</span><br><b>Nº ${esc(d.numero.padStart(9, "0").replace(/(\d{3})(\d{3})(\d{3})/, "$1.$2.$3"))}</b><br>
      SÉRIE ${esc(d.serie)} · FOLHA ${pag}/${total}</td>
    <td class="chave">${codigoBarrasSvg}<div class="rot">CHAVE DE ACESSO</div><div class="ch">${chaveFormatada(d.chave)}</div>
      <div class="pq">Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da Sefaz autorizadora</div></td>
  </tr></table>
  <table class="g2"><tr>
    <td style="width:56%"><div class="rot">NATUREZA DA OPERAÇÃO</div>${esc(d.natOp)}</td>
    <td><div class="rot">PROTOCOLO DE AUTORIZAÇÃO DE USO</div>${esc(d.protocolo)} ${esc(dataHora(d.dhProtocolo))}</td>
  </tr></table>
  <table class="g2"><tr>
    <td><div class="rot">INSCRIÇÃO ESTADUAL</div>${esc(d.emit.ie)}</td>
    <td><div class="rot">INSC. ESTADUAL DO SUBST. TRIBUT.</div>&nbsp;</td>
    <td><div class="rot">CNPJ</div>${esc(doc(d.emit.cnpj))}</td>
  </tr></table>`;

  const linhas = (itens: ItemDanfe[]) => itens.map((i) => `<tr>
      <td>${esc(i.codigo)}</td><td class="desc">${esc(i.descricao)}</td><td class="c">${esc(i.ncm)}</td><td class="c">${esc(i.cst)}</td>
      <td class="c">${esc(i.cfop)}</td><td class="c">${esc(i.un)}</td><td class="r">${qtd(i.qtd)}</td><td class="r">${brl(i.unit)}</td>
      <td class="r">${brl(i.total)}</td><td class="r">0,00</td><td class="r">0,00</td><td class="r">0,00</td><td class="r">0,00</td><td class="r">0,00</td></tr>`).join("");
  const quadro = (itens: ItemDanfe[]) => `
  <div class="sec">DADOS DOS PRODUTOS / SERVIÇOS</div>
  <table class="itens"><thead><tr>
    <th style="width:11%">CÓDIGO</th><th>DESCRIÇÃO DO PRODUTO / SERVIÇO</th><th>NCM/SH</th><th>CSOSN</th><th>CFOP</th><th>UN</th><th>QTD.</th>
    <th>V.UNIT.</th><th>V.TOTAL</th><th>BC ICMS</th><th>V.ICMS</th><th>V.IPI</th><th>% ICMS</th><th>% IPI</th>
  </tr></thead><tbody>${linhas(itens)}</tbody></table>`;

  const t = d.totais;
  const pagina1 = `${cab(1)}
  <div class="sec">DESTINATÁRIO / REMETENTE</div>
  <table class="g2">
    <tr><td style="width:56%"><div class="rot">NOME / RAZÃO SOCIAL</div>${esc(d.dest.nome)}</td><td><div class="rot">CNPJ / CPF</div>${esc(doc(d.dest.doc))}</td>
        <td><div class="rot">DATA DA EMISSÃO</div>${esc(dataHora(d.emissao).slice(0, 10))}</td></tr>
    <tr><td><div class="rot">ENDEREÇO</div>${esc(d.dest.endereco)}</td><td><div class="rot">BAIRRO / DISTRITO</div>${esc(d.dest.bairro)}</td>
        <td><div class="rot">DATA DA SAÍDA/ENTRADA</div>${esc(dataHora(d.saida).slice(0, 10))}</td></tr>
    <tr><td><div class="rot">MUNICÍPIO</div>${esc(d.dest.cidade)} · ${esc(d.dest.uf)} · CEP ${esc(d.dest.cep)}</td><td><div class="rot">INSCRIÇÃO ESTADUAL</div>${esc(d.dest.ie)}</td>
        <td><div class="rot">HORA DA SAÍDA</div>${esc(dataHora(d.saida).slice(11))}</td></tr>
  </table>
  <div class="sec">CÁLCULO DO IMPOSTO</div>
  <table class="g2"><tr>
    <td><div class="rot">BASE DE CÁLC. DO ICMS</div>${brl(t.bcIcms)}</td><td><div class="rot">VALOR DO ICMS</div>${brl(t.icms)}</td>
    <td><div class="rot">VALOR TOTAL DOS PRODUTOS</div>${brl(t.produtos)}</td><td><div class="rot">VALOR DO FRETE</div>${brl(t.frete)}</td>
    <td><div class="rot">VALOR DO SEGURO</div>${brl(t.seguro)}</td><td><div class="rot">DESCONTO</div>${brl(t.desconto)}</td>
    <td><div class="rot">OUTRAS DESPESAS</div>${brl(t.outras)}</td><td><div class="rot">VALOR DO IPI</div>${brl(t.ipi)}</td>
    <td><div class="rot">VALOR TOTAL DA NOTA</div><b>${brl(t.nota)}</b></td>
  </tr></table>
  <div class="sec">TRANSPORTADOR / VOLUMES TRANSPORTADOS</div>
  <table class="g2"><tr><td><div class="rot">FRETE POR CONTA</div>${esc(FRETE[d.modFrete] ?? d.modFrete)}</td>
    <td><div class="rot">QUANTIDADE DE ITENS / PEÇAS</div>${d.itens.length} itens · ${qtd(d.itens.reduce((s, i) => s + i.qtd, 0))} peças</td></tr></table>
  ${quadro(paginas[0]!)}
  ${total === 1 ? adicionais(d) : ""}`;

  const demais = paginas.slice(1).map((itens, k) => `<div class="pagina">${cab(k + 2)}${quadro(itens)}${k + 2 === total ? adicionais(d) : ""}</div>`).join("");
  const canhoto = `<table class="canhoto"><tr>
    <td style="width:80%">RECEBEMOS DE ${esc(d.emit.nome)} OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO<br>
      <div class="ass"><span>DATA DE RECEBIMENTO</span><span>IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR</span></div></td>
    <td class="c"><b>NF-e</b><br>Nº ${esc(d.numero)}<br>SÉRIE ${esc(d.serie)}</td></tr></table>`;
  const marca = d.homologacao ? `<div class="marca">SEM VALOR FISCAL</div>` : d.cancelada ? `<div class="marca">CANCELADA</div>` : "";

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>DANFE ${esc(d.numero)}</title><style>
  @page{size:A4 portrait;margin:7mm}
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:0;font-size:7.5pt}
  table{width:100%;border-collapse:collapse}
  td,th{border:0.6pt solid #000;padding:1.2pt 2.5pt;vertical-align:top}
  .rot{font-size:5.5pt;text-transform:uppercase;color:#222}
  .sec{font-size:6.5pt;font-weight:700;margin:3pt 0 1pt}
  .cab td{height:30mm}.emit{width:38%;font-size:7.5pt}.danfe{width:20%;text-align:center;font-size:7pt}.g{font-size:13pt}
  .es{display:inline-block;text-align:left;margin-top:3pt}.box{display:inline-block;border:0.8pt solid #000;padding:1pt 4pt;margin-left:6pt;font-weight:700}
  .chave{text-align:center}.chave svg{width:100%;height:12mm}.ch{font-weight:700;font-size:8pt;letter-spacing:.3pt}.pq{font-size:6pt;margin-top:2pt}
  .itens th{font-size:5.5pt;background:#eee;padding:1pt 1.5pt}
  .itens td{font-size:6.6pt;padding:0.4pt 1.5pt;border-top:none;border-bottom:0.3pt solid #999;white-space:nowrap;overflow:hidden;line-height:1.15}
  .itens td.desc{white-space:normal;width:40%}
  .r{text-align:right}.c{text-align:center}
  .canhoto{margin-bottom:3pt}.canhoto td{font-size:6.5pt;height:12mm}.ass{display:flex;gap:30pt;margin-top:12pt;font-size:5.5pt}.ass span{border-top:0.6pt solid #000;flex:1}
  .adic td{height:18mm;font-size:6.8pt}
  .pagina{page-break-before:always}
  .marca{position:fixed;top:45%;left:0;right:0;text-align:center;font-size:48pt;color:rgba(0,0,0,.08);transform:rotate(-25deg);pointer-events:none}
  </style></head><body>${marca}${canhoto}${pagina1}${demais}</body></html>`;
}

function adicionais(d: DadosDanfe) {
  return `<div class="sec">DADOS ADICIONAIS</div>
  <table class="adic"><tr><td style="width:65%"><div class="rot">INFORMAÇÕES COMPLEMENTARES</div>${esc(d.infCpl).replace(/;/g, "<br>")}
    ${d.emit.crt === "1" ? "<br>DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL." : ""}</td>
    <td><div class="rot">RESERVADO AO FISCO</div>${esc(d.infFisco)}</td></tr></table>`;
}
