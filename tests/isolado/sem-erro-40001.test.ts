/**
 * 0290 — O PostgREST repete sozinho, sem fim, toda requisição que termina com o código 40001
 * (serialization_failure). Uma função que levanta 40001 de propósito (ex.: conflito de revisão
 * da vitrine) prende a conexão num laço de milhares de tentativas por segundo.
 * Regra: nenhuma função do schema public levanta 40001/40P01 de propósito; conflito usa P0409.
 */
import { describe, expect, test } from "bun:test";
import { adm } from "./base";

describe("nenhuma função provoca repetição infinita do PostgREST", () => {
  test("nenhuma função levanta 40001 ou 40P01 de propósito", async () => {
    const fs = (await adm.unsafe(`
      select p.proname as nome from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.prosrc ~* 'errcode\\s*=\\s*''(40001|40P01|serialization_failure|deadlock_detected)'''`)) as { nome: string }[];
    expect(fs.map((f) => f.nome)).toEqual([]);
  });

  test("conflito de revisão ao publicar a vitrine usa o código P0409", async () => {
    const [r] = (await adm.unsafe(
      `select prosrc ilike '%errcode=''P0409''%' as ok from pg_proc where oid = 'public.showcase_design_publish(integer)'::regprocedure`,
    )) as { ok: boolean }[];
    expect(r?.ok).toBe(true);
  });
});
