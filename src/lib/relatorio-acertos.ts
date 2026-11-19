/**
 * 0355 — Relatório de acertos por período (Remessas). Dados só do banco (acertos_relatorio): Lardan + SmallData.
 * O HTML A4 tem: capa com logo, lista agrupada por praça ou por representante e, nas páginas seguintes,
 * um bloco por consultora com 6 linhas para anotações (ligação consultiva antes do acerto).
 */
import { supabase } from "@/integrations/supabase/client";

export interface LinhaAcerto {
  fonte: "lardan" | "smalldata"; maleta: string; remessa: number | null; acerto: string; party_id: string | null;
  consultora: string; codigo: string | null; praca: string; representante: string; pecas: number | null; valor_cents: number | null;
  situacao: string; telefone: string | null; cidade: string | null;
  /** 0356: maleta direta (Nova maleta, sem representante) — aparece só em "Geral". */
  direta?: boolean; praca_id?: string | null; rep_id?: string | null;
}
export interface RelatorioAcertos { de: string; ate: string; gerado_em: string; linhas: LinhaAcerto[] }
export type AgruparPor = "praca" | "representante" | "geral";

/** Chave estável da praça/representante (id; sem id, o nome). */
export const chaveAlvo = (l: LinhaAcerto, por: AgruparPor) =>
  por === "praca" ? (l.praca_id ?? `nome:${l.praca}`) : (l.rep_id ?? `nome:${l.representante}`);

/** 0356: "Geral" = só maletas diretas; praça/representante = sem as diretas e, se escolhido, só aquela praça/representante. */
export function filtrarAcertos(linhas: LinhaAcerto[], por: AgruparPor, alvo: string) {
  if (por === "geral") return linhas.filter((l) => l.direta);
  return linhas.filter((l) => !l.direta && (!alvo || chaveAlvo(l, por) === alvo));
}

/** Opções do seletor: cada praça/representante que tem acerto no período, com a quantidade de maletas. */
export function opcoesAlvo(linhas: LinhaAcerto[], por: Exclude<AgruparPor, "geral">) {
  const m = new Map<string, { label: string; n: number }>();
  for (const l of linhas) {
    if (l.direta) continue;
    const k = chaveAlvo(l, por);
    const atual = m.get(k);
    m.set(k, { label: por === "praca" ? l.praca : l.representante, n: (atual?.n ?? 0) + 1 });
  }
  return [...m.entries()].map(([value, v]) => ({ value, label: v.label, hint: `${v.n} ${v.n === 1 ? "maleta" : "maletas"}` }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

export async function lerRelatorioAcertos(de: string, ate: string): Promise<RelatorioAcertos> {
  const { data, error } = await supabase.rpc("acertos_relatorio" as never, { _de: de, _ate: ate } as never);
  if (error) throw error;
  return data as unknown as RelatorioAcertos;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const dataBR = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const brl = (c: number | null) => (c == null ? "—" : (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
/** (43) 99911-2233 — tira o 55 do Brasil quando vier junto. */
export function telefoneBR(t: string | null): string {
  const n = (t ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return n || "—";
}
const SIT: Record<string, string> = {
  sem_pre_baixa: "Na rua", aberta: "Marcando vendas", aguardando_pagamento: "Fechou, falta o Pix", aguardando_conferencia: "Pago, falta conferir",
  pendencia: "Pendência", encerrada: "Encerrado", smalldata: "Na rua (SmallData)",
};

/** Agrupa mantendo a ordem: praça/representante → data do acerto → nome. */
export function agruparAcertos(linhas: LinhaAcerto[], por: AgruparPor) {
  if (por === "geral") {
    const itens = [...linhas].sort((a, b) => a.acerto.localeCompare(b.acerto) || a.consultora.localeCompare(b.consultora, "pt-BR"));
    return itens.length ? [{ titulo: "Maletas diretas (sem representante)", itens }] : [];
  }
  // mesma praça/representante pela chave (id), mesmo que o nome venha escrito diferente do SmallData
  const rot = (l: LinhaAcerto) => (por === "praca" ? l.praca : l.representante);
  const ord = [...linhas].sort((a, b) => rot(a).localeCompare(rot(b), "pt-BR")
    || a.acerto.localeCompare(b.acerto) || a.consultora.localeCompare(b.consultora, "pt-BR"));
  const mapa = new Map<string, { titulo: string; itens: LinhaAcerto[] }>();
  for (const l of ord) {
    const k = chaveAlvo(l, por);
    const g = mapa.get(k) ?? { titulo: rot(l), itens: [] };
    g.itens.push(l);
    mapa.set(k, g);
  }
  return [...mapa.values()];
}

export function htmlRelatorioAcertos(r: RelatorioAcertos, por: AgruparPor, opcoes: { logoUrl: string; operador: string; impressoEm: Date; filtro?: string }) {
  const grupos = agruparAcertos(r.linhas, por);
  const consultoras = new Set(r.linhas.map((l) => l.party_id ?? `${l.codigo}:${l.consultora}`)).size;
  const outro = (l: LinhaAcerto) => (por === "praca" ? l.representante : l.praca);
  const rotGrupo = por === "praca" ? "Praça" : por === "representante" ? "Representante" : "Geral";
  const rotOutro = por === "praca" ? "Representante" : "Praça";
  const rotPor = por === "praca" ? "praça" : por === "representante" ? "representante" : "geral (maletas diretas)";
  const rotGrupos = por === "praca" ? "praças" : por === "representante" ? "representantes" : "grupo";
  const lista = grupos.map((g) => `
    <section class="grupo">
      <h2>${rotGrupo}: ${esc(g.titulo)} <span>${g.itens.length} ${g.itens.length === 1 ? "maleta" : "maletas"}</span></h2>
      <table>
        <thead><tr><th>Acerto</th><th>Cód.</th><th>Consultora</th><th>Telefone</th><th>Cidade</th><th>${rotOutro}</th><th>Maleta</th><th class="r">Peças</th><th class="r">Valor</th></tr></thead>
        <tbody>${g.itens.map((l) => `<tr>
          <td class="n">${dataBR(l.acerto)}</td><td class="n">${esc(l.codigo ?? "—")}</td><td><b>${esc(l.consultora)}</b><div class="sit">${esc(SIT[l.situacao] ?? l.situacao)}</div></td>
          <td class="n">${esc(telefoneBR(l.telefone))}</td><td>${esc(l.cidade ?? "—")}</td><td>${esc(outro(l))}</td>
          <td class="n">${esc(l.maleta)}${l.remessa ? `<div class="sit">Remessa ${esc(l.remessa)}</div>` : ""}</td>
          <td class="r n">${l.pecas ?? "—"}</td><td class="r n">${brl(l.valor_cents)}</td></tr>`).join("")}</tbody>
      </table>
    </section>`).join("");
  // Uma folha de anotação por consultora (2+ maletas na mesma praça/representante viram um bloco só).
  const porConsultora = (itens: LinhaAcerto[]) => {
    const m = new Map<string, LinhaAcerto[]>();
    for (const l of itens) { const k = l.party_id ?? `${l.codigo}:${l.consultora}`; m.set(k, [...(m.get(k) ?? []), l]); }
    return [...m.values()];
  };
  const blocos = grupos.map((g) => `
    <h2 class="sec">${rotGrupo}: ${esc(g.titulo)}</h2>
    ${porConsultora(g.itens).map((ls) => {
      const l = ls[0]!;
      const maletas = ls.map((x) => `${esc(x.maleta)}${x.remessa ? ` (remessa ${esc(x.remessa)})` : ""}`).join(" + ");
      const datas = [...new Set(ls.map((x) => dataBR(x.acerto)))].join(", ");
      return `
      <div class="nota">
        <div class="cab"><b>${l.codigo ? `[Cód. ${esc(l.codigo)}] ` : ""}${esc(l.consultora)}</b><span>Acerto ${datas}</span></div>
        <div class="sub">${esc(telefoneBR(l.telefone))} · ${esc(l.cidade ?? "cidade não informada")} · ${maletas} · ${esc(outro(l))}</div>
        ${"<div class=\"pauta\"></div>".repeat(6)}
      </div>`;
    }).join("")}`).join("");
  const quando = opcoes.impressoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Acertos de ${dataBR(r.de)} a ${dataBR(r.ate)}</title>
<style>
  @page{size:A4 portrait;margin:12mm 12mm 14mm}
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;color:#1c1614;margin:0;font-size:11px}
  .topo{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #8a5a4f;padding-bottom:10px;margin-bottom:14px}
  .topo img{height:46px}
  .topo .t{text-align:right}
  .topo h1{font-size:19px;margin:0;letter-spacing:.04em}
  .topo p{margin:3px 0 0;color:#5b4d48}
  .resumo{display:flex;gap:10px;margin-bottom:14px}
  .resumo div{flex:1;border:1px solid #d9c9c2;border-radius:8px;padding:8px 10px}
  .resumo b{display:block;font-size:17px}
  .resumo span{color:#5b4d48}
  .grupo{margin-bottom:14px;break-inside:auto}
  h2{font-size:13px;margin:12px 0 6px;color:#6d3f35;border-bottom:1px solid #d9c9c2;padding-bottom:3px}
  h2 span{float:right;font-weight:400;color:#5b4d48}
  table{width:100%;border-collapse:collapse}
  th{background:#f3ebe7;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.04em;padding:5px 5px}
  td{border-bottom:1px solid #e6dad5;padding:5px 5px;vertical-align:top}
  tr{break-inside:avoid}
  .r{text-align:right}.n{white-space:nowrap;font-variant-numeric:tabular-nums}
  .sit{color:#6b5d58;font-size:9.5px;margin-top:1px}
  .quebra{break-before:page}
  .sec{margin-top:4px}
  .nota{border:1px solid #d9c9c2;border-radius:8px;padding:9px 12px 4px;margin-bottom:10px;break-inside:avoid}
  .nota .cab{display:flex;justify-content:space-between;font-size:12.5px}
  .nota .sub{color:#5b4d48;margin:2px 0 4px}
  .pauta{border-bottom:1px solid #b9a59d;height:23px}
  .rodape{margin-top:10px;color:#6b5d58;font-size:9.5px}
  .vazio{padding:30px;text-align:center;border:1px dashed #b9a59d;border-radius:8px}
</style></head><body>
  <div class="topo"><img src="${esc(opcoes.logoUrl)}" alt="LARDAN"><div class="t"><h1>Acertos de ${dataBR(r.de)} a ${dataBR(r.ate)}</h1>
    <p>${opcoes.filtro ? `${esc(opcoes.filtro)} · ` : `Por ${rotPor} · `}impresso em ${esc(quando)} por ${esc(opcoes.operador)}</p></div></div>
  <div class="resumo"><div><b>${r.linhas.length}</b><span>maletas para acertar</span></div><div><b>${consultoras}</b><span>consultoras</span></div><div><b>${grupos.length}</b><span>${rotGrupos}</span></div></div>
  ${r.linhas.length === 0 ? `<div class="vazio">Nenhum acerto neste período.</div>` : lista}
  <p class="rodape">Lista para a ligação antes do acerto: pergunte o que vendeu mais, que tipo de peça e qual modelo ela quer na próxima maleta. Anote nas páginas seguintes.</p>
  ${r.linhas.length === 0 ? "" : `<div class="quebra"></div>
  <div class="topo"><img src="${esc(opcoes.logoUrl)}" alt="LARDAN"><div class="t"><h1>Anotações</h1><p>Acertos de ${dataBR(r.de)} a ${dataBR(r.ate)}</p></div></div>
  ${blocos}`}
</body></html>`;
}
