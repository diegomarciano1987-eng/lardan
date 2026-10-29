/**
 * 0176 — Em produção o Supabase recusa UPDATE/DELETE sem WHERE (pg-safeupdate), mas a bancada não.
 * Este teste lê toda função do schema public e falha se alguma tiver UPDATE ou DELETE sem WHERE.
 * Para "todas as linhas" use WHERE true. Banco ISOLADO, sem dados.
 */
import { describe, expect, test } from "bun:test";
import { adm } from "./base";

// Rotinas de manutenção rodadas pelo editor SQL (fora do PostgREST), onde a regra não vale.
const FORA_DO_APP = new Set(["homolog_purge_v2"]);

function semComentariosETextos(s: string) {
  return s.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''");
}

describe("UPDATE/DELETE sempre com WHERE", () => {
  test("nenhuma função do app tem UPDATE ou DELETE sem WHERE", async () => {
    const fs = (await adm.unsafe(`
      select p.proname as nome, pg_get_functiondef(p.oid) as def
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
         and p.prolang in (select oid from pg_language where lanname in ('sql','plpgsql'))`)) as { nome: string; def: string }[];
    const achados: string[] = [];
    for (const f of fs) {
      if (FORA_DO_APP.has(f.nome)) continue;
      const corpo = semComentariosETextos(f.def);
      const re = /\b(UPDATE|DELETE\s+FROM)\s+([a-z_.]+)\b/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(corpo))) {
        const antes = corpo.slice(Math.max(0, m.index - 30), m.index);
        if (m[1]!.toUpperCase() === "UPDATE" && /(DO|FOR|ON)\s*$/i.test(antes)) continue; // ON CONFLICT DO UPDATE / FOR UPDATE
        const fim = corpo.indexOf(";", m.index);
        const comando = corpo.slice(m.index, fim < 0 ? undefined : fim);
        if (!/\bWHERE\b/i.test(comando)) achados.push(`${f.nome}: ${comando.replace(/\s+/g, " ").slice(0, 80)}`);
      }
    }
    expect(achados).toEqual([]);
  });
});
