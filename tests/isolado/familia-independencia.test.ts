/**
 * 0177 — Prova de independência e privacidade do Financeiro da família (portado do sistema antigo).
 * Se alguém ligar este módulo à Lardan (pessoas, maletas, cobrança, financeiro, avisos, push, e-mail...),
 * ou fizer o espelho do representante abrir a família de outra pessoa, este teste quebra. Sem banco.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const RAIZ = resolve(import.meta.dir, "../..");
const listar = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listar(p) : [p];
  });
const ARQUIVOS = [...listar(join(RAIZ, "src/lib/familia")), ...listar(join(RAIZ, "src/components/familia"))].filter((f) => /\.(ts|tsx)$/.test(f));
const imports = (arquivo: string) => [...readFileSync(arquivo, "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);

/** Únicas origens permitidas: kit visual, utilitário cn, client do backend, libs npm e o próprio módulo. */
function permitido(spec: string): boolean {
  if (!spec.startsWith("@/") && !spec.startsWith(".")) return true;
  if (spec.startsWith("./")) return true;
  return ["@/components/ui/", "@/lib/utils", "@/integrations/supabase/client", "@/lib/familia/", "@/components/familia/"].some((p) => spec.startsWith(p));
}

describe("Financeiro da família é independente e privado", () => {
  test("encontra os arquivos do módulo", () => {
    expect(ARQUIVOS.length).toBeGreaterThanOrEqual(8);
  });

  test("só importa kit visual, utilitários e o próprio módulo", () => {
    const proibidos = ARQUIVOS.flatMap((f) => imports(f).filter((s) => !permitido(s)).map((s) => `${f.replace(RAIZ + "/", "")}: ${s}`));
    expect(proibidos).toEqual([]);
  });

  test("só toca em tabelas e rotinas familia_*, sem server functions, push ou e-mail", () => {
    for (const f of ARQUIVOS) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\.(?:from|rpc)\(\s*["']([^"']+)["']/g)) expect(m[1]!.startsWith("familia_")).toBe(true);
      expect(/functions\.invoke\(|createServerFn|useServerFn/.test(src)).toBe(false);
      expect(/\buser_id\s*:/.test(src)).toBe(false); // o dono vem do banco (auth.uid()), nunca do front
    }
  });

  test("migração: só o dono lê e grava, sem papel da equipe nas políticas", () => {
    const sql = readFileSync(join(RAIZ, "drizzle/migrations/0177_financeiro_familia.sql"), "utf8");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("USING (user_id = auth.uid())");
    expect(/has_role|has_capability|is_staff|audit_logs\s*\(/.test(sql.replace(/--[^\n]*/g, ""))).toBe(false);
  });

  test("no espelho do representante a família fica trancada", () => {
    const rota = readFileSync(join(RAIZ, "src/routes/_authenticated/representante.tsx"), "utf8");
    expect(rota).toMatch(/aba === "familia" && \(espelho \? <FamiliaTrancada \/>/);
  });
});
