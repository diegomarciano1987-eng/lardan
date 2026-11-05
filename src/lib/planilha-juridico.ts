import * as XLSX from "xlsx";

export type LinhaJuridico = {
  id: string; nome: string; cpf: string; status: string; valor_causa_cents: number | null; valor_bloqueado_cents: number | null;
  fase: string; cidade: string; praca: string; responsavel: string; status_citacao: string; proxima_acao: string; tipo: string;
  numero: string; link: string; ultima_atualizacao: string;
};

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const COLS: Record<keyof LinhaJuridico, (h: string) => boolean> = {
  id: (h) => h === "id", nome: (h) => h.startsWith("nome"), cpf: (h) => h.startsWith("cpf"), status: (h) => h === "status",
  valor_causa_cents: (h) => h.startsWith("valor da causa"), valor_bloqueado_cents: (h) => h.startsWith("valor bloqueado"),
  fase: (h) => h.startsWith("fase"), cidade: (h) => h === "cidade", praca: (h) => h.startsWith("praca"), responsavel: (h) => h.startsWith("responsavel"),
  status_citacao: (h) => h.startsWith("status citacao"), proxima_acao: (h) => h.startsWith("proxima acao"), tipo: (h) => h.startsWith("tipo"),
  numero: (h) => h.startsWith("no processo") || h.startsWith("n processo") || h.startsWith("nº processo"), link: (h) => h.startsWith("link"),
  ultima_atualizacao: (h) => h.includes("ultima atualizacao"),
};

/** Valor em reais (número do Excel ou texto "1.234,56") → centavos; vazio/"A confirmar" → null. */
export function centavos(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  const s = String(v ?? "").replace(/[R$\s]/g, "");
  if (!/\d/.test(s) || /[a-z]/i.test(s)) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function dataIso(v: unknown): string {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const m = String(v ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : /^\d{4}-\d{2}-\d{2}/.test(String(v ?? "")) ? String(v).slice(0, 10) : "";
}

/** Lê a aba "Base Geral" da planilha mestra do jurídico. */
export function lerPlanilhaJuridico(buf: ArrayBuffer): LinhaJuridico[] {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const nomeAba = wb.SheetNames.find((n) => norm(n).includes("base geral")) ?? wb.SheetNames[0]!;
  const ws = wb.Sheets[nomeAba]!;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
  const hi = rows.findIndex((r) => r.some((c) => norm(c) === "id") && r.some((c) => norm(c).startsWith("cpf")));
  if (hi < 0) throw new Error("Não achei o cabeçalho (ID, CPF) na aba Base Geral.");
  const head = rows[hi]!.map(norm);
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, f]) => [k, head.findIndex(f)])) as Record<keyof LinhaJuridico, number>;
  const out: LinhaJuridico[] = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r]!;
    const g = (k: keyof LinhaJuridico) => (idx[k] >= 0 ? row[idx[k]] : "");
    const t = (k: keyof LinhaJuridico) => String(g(k) ?? "").trim();
    if (!t("id") && !t("nome")) continue;
    const cel = idx.link >= 0 ? ws[XLSX.utils.encode_cell({ r, c: idx.link })] : undefined;
    out.push({
      id: t("id"), nome: t("nome"), cpf: t("cpf").replace(/\D/g, ""), status: t("status"),
      valor_causa_cents: centavos(g("valor_causa_cents")), valor_bloqueado_cents: centavos(g("valor_bloqueado_cents")),
      fase: t("fase"), cidade: t("cidade"), praca: t("praca"), responsavel: t("responsavel"), status_citacao: t("status_citacao"),
      proxima_acao: t("proxima_acao"), tipo: t("tipo"), numero: t("numero"), link: (cel?.l?.Target as string | undefined) ?? (/^https:\/\//.test(t("link")) ? t("link") : ""),
      ultima_atualizacao: dataIso(g("ultima_atualizacao")),
    });
  }
  return out;
}
