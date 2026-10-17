import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, ler, type Conta } from "./base";
let master: Conta, consultora: Conta;
beforeAll(async () => {
  master = await criarConta({ nome: "biblioteca-master", papeis: ["master"] });
  consultora = await criarConta({ nome: "biblioteca-cons", papeis: ["consultora"] });
});
describe("Biblioteca: documentos e publicação", () => {
  test("campanha PDF: rascunho invisível, publicado visível e retirada invisível", async () => {
    const path = `iso/${crypto.randomUUID()}.pdf`;
    const r = await ler<{ id: string }>(master, `insert into public.biblioteca_artes (titulo,tipo,path) values ('ISO Campanha','campanha',$1) returning id`, [path]);
    expect(r.erro).toBeNull();
    const id = r.linhas[0]?.id; if (!id) throw new Error("Conteúdo não criado");
    const sql = `select id from public.biblioteca_artes where id=$1`;
    expect((await ler(consultora, sql, [id])).linhas).toEqual([]);
    await ler(master, `update public.biblioteca_artes set publicado=true where id=$1`, [id]);
    expect((await ler(consultora, sql, [id])).linhas).toEqual([{ id }]);
    await ler(master, `update public.biblioteca_artes set publicado=false where id=$1`, [id]);
    expect((await ler(consultora, sql, [id])).linhas).toEqual([]);
  });
  test("categorias de documentos aceitas e arte legada preservada", async () => {
    for (const [tipo, ext] of [["informativo", "pdf"], ["campanha", "jpg"], ["material", "png"]]) {
      const r = await ler<{ tipo: string }>(master, `insert into public.biblioteca_artes (titulo,tipo,path) values ('ISO Documento',$1,$2) returning tipo`, [tipo, `iso/${crypto.randomUUID()}.${ext}`]);
      expect(r.erro).toBeNull(); expect(r.linhas[0]?.tipo).toBe(tipo);
    }
    const r = await ler(master, `insert into public.biblioteca_artes (titulo,path,formato) values ('ISO Arte',$1,'feed') returning tipo,formato`, [`iso/${crypto.randomUUID()}.jpg`]);
    expect(r.linhas).toEqual([{ tipo: "arte", formato: "feed" }]);
  });
  test("consultora não publica e categoria inválida é recusada", async () => {
    const path = `iso/${crypto.randomUUID()}.pdf`;
    expect((await ler(consultora, `insert into public.biblioteca_artes (titulo,tipo,path,publicado) values ('ISO Indevido','informativo',$1,true)`, [path])).ok).toBe(false);
    expect((await ler(master, `insert into public.biblioteca_artes (titulo,tipo,path) values ('ISO Inválido','invalido',$1)`, [path])).ok).toBe(false);
  });
  test("PDF privado só é lido pela consultora quando publicado", async () => {
    const path = `iso/${crypto.randomUUID()}.pdf`;
    await adm.unsafe(`insert into storage.buckets (id,name,public) values ('biblioteca-lardan','biblioteca-lardan',false) on conflict do nothing`);
    await adm.unsafe(`insert into storage.objects (bucket_id,name) values ('biblioteca-lardan',$1)`, [path]);
    await ler(master, `insert into public.biblioteca_artes (titulo,tipo,path) values ('ISO Informativo','informativo',$1)`, [path]);
    const sql = `select name from storage.objects where bucket_id='biblioteca-lardan' and name=$1`;
    expect((await ler(consultora, sql, [path])).linhas).toEqual([]);
    await ler(master, `update public.biblioteca_artes set publicado=true where path=$1`, [path]);
    expect((await ler(consultora, sql, [path])).linhas).toEqual([{ name: path }]);
  });
});