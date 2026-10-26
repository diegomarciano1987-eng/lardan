/**
 * Exclusão de documento judicial anexado por engano (cob_judicial_doc_excluir).
 * Banco ISOLADO, dados sintéticos.
 *  1. Quem não tem permissão de cobrança não exclui.
 *  2. Sem motivo não exclui.
 *  3. Exclusão válida remove o registro, devolve o caminho do arquivo,
 *     grava histórico na ficha e log de auditoria.
 *  4. Excluir de novo falha com "Documento não encontrado".
 */
import { beforeAll, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

let master: Conta, semPermissao: Conta;
let party = "", docId = "";

beforeAll(async () => {
  master = await criarConta({ nome: "doc-exc-master", papeis: ["master"], comParty: true });
  semPermissao = await criarConta({ nome: "doc-exc-cons", papeis: ["consultora"], comParty: true });
  const p = await adm.unsafe("insert into parties(kind,display_name,status) values('pessoa',$1,'ativo') returning id", [`Pessoa doc excluir ${Date.now()}`]);
  party = String(p[0].id);
  const d = await adm.unsafe(
    "insert into cob_judicial_docs(party_id,tipo,titulo,storage_path,file_name,content_type,autor_id) values($1,'outro',$2,$3,$4,'application/pdf',$5) returning id",
    [party, "Documento errado de teste", `judicial/${party}/teste-doc-errado.pdf`, "doc-errado.pdf", master.uid],
  );
  docId = String(d[0].id);
});

test("quem não tem permissão de cobrança não exclui", async () => {
  const r = await rpc(semPermissao, "cob_judicial_doc_excluir", { _id: docId, _motivo: "anexado por engano" });
  expect(r.erro).toMatch(/permissão/i);
});

test("sem motivo não exclui", async () => {
  const r = await rpc(master, "cob_judicial_doc_excluir", { _id: docId, _motivo: "" });
  expect(r.erro).toMatch(/motivo/i);
});

test("exclusão válida remove registro, devolve caminho e grava histórico e auditoria", async () => {
  // a rotina devolve uma linha composta; o driver a entrega como texto "(caminho,party)"
  const r = await rpc<string>(master, "cob_judicial_doc_excluir", { _id: docId, _motivo: "anexado na ficha errada" });
  expect(r.erro).toBeNull();
  expect(String(r.dados)).toContain(`judicial/${party}/teste-doc-errado.pdf`);
  expect(String(r.dados)).toContain(party);

  const resto = await adm.unsafe("select count(*)::int n from cob_judicial_docs where id=$1", [docId]);
  expect(Number(resto[0].n)).toBe(0);

  const hist = await adm.unsafe("select observacao, autor_id from cob_interacoes where party_id=$1 and observacao like 'Documento judicial removido:%'", [party]);
  expect(hist.length).toBe(1);
  expect(String(hist[0].observacao)).toContain("Documento errado de teste");
  expect(String(hist[0].observacao)).toContain("anexado na ficha errada");
  expect(String(hist[0].autor_id)).toBe(master.uid);

  const aud = await adm.unsafe("select actor_id, payload from audit_logs where action='cob_judicial_doc_excluir' and entity_id=$1", [docId]);
  expect(aud.length).toBe(1);
  expect(String(aud[0].actor_id)).toBe(master.uid);
});

test("excluir de novo falha como não encontrado", async () => {
  const r = await rpc(master, "cob_judicial_doc_excluir", { _id: docId, _motivo: "tentativa repetida" });
  expect(r.erro).toMatch(/não encontrado/i);
});
