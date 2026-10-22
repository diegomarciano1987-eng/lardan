/** Leitor de CSV do pacote do histórico JFLEX (sem banco). */
import { describe, expect, test } from "bun:test";
import { conferirColunas, emBlocos, lerCsv } from "../../src/lib/historico-jflex-csv";

describe("lerCsv", () => {
  test("aspas, vírgula e quebra de linha dentro do campo, BOM e CRLF", () => {
    const t = '﻿codcli,nome,obs\r\n1,"Silva, Ana","linha 1\r\nlinha 2"\r\n2,Bia,"diz ""oi"""\r\n';
    expect(lerCsv(t)).toEqual([
      { codcli: "1", nome: "Silva, Ana", obs: "linha 1\r\nlinha 2" },
      { codcli: "2", nome: "Bia", obs: 'diz "oi"' },
    ]);
  });
  test("zeros à esquerda e vazios continuam texto", () => {
    expect(lerCsv("cep,numero\n08600000,\n")).toEqual([{ cep: "08600000", numero: "" }]);
  });
  test("arquivo sem linha final e vazio", () => {
    expect(lerCsv("a,b\n1,2")).toEqual([{ a: "1", b: "2" }]);
    expect(lerCsv("")).toEqual([]);
  });
});

describe("blocos e colunas", () => {
  test("blocos de até 1.000", () => {
    expect(emBlocos(Array.from({ length: 2500 }, (_, i) => i), 1000).map((b) => b.length)).toEqual([1000, 1000, 500]);
  });
  test("recusa arquivo trocado antes de enviar", () => {
    expect(conferirColunas("maletas", lerCsv("codigo,nome\n1,x\n"))).toContain("faltam as colunas");
    expect(conferirColunas("pracas", lerCsv("codigo,nome\n1,x\n"))).toBeNull();
  });
});
