/** Recusar candidata (candidaturas.mark_lost) fica só com um usuário escolhido, pela rotina auditada. Banco ISOLADO. */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, rpcServico, type Conta } from "./base";

let master: Conta, daniel: Conta;
beforeAll(async () => {
  master = await criarConta({ nome: "mk-master", papeis: ["master"] });
  daniel = await criarConta({ nome: "mk-daniel", papeis: ["master"] });
});

describe("candidaturas.mark_lost exclusiva", () => {
  test("depois da rotina, só o escolhido tem a permissão; outro master perde; fica auditado", async () => {
    const r = await rpcServico<{ depois: { perfis: string[]; usuarios: string[] } }>("cap_exclusiva_definir", {
      _cap: "candidaturas.mark_lost", _user: daniel.uid, _actor: master.uid, _motivo: "teste",
    });
    expect(r.erro).toBeNull();
    expect(r.dados.depois.perfis).toEqual([]);
    expect(r.dados.depois.usuarios).toEqual([daniel.uid]);
    const d = await rpc<boolean>(daniel, "has_capability", { _user_id: daniel.uid, _cap: "candidaturas.mark_lost" });
    const m = await rpc<boolean>(master, "has_capability", { _user_id: master.uid, _cap: "candidaturas.mark_lost" });
    expect(d.dados).toBe(true);
    expect(m.dados).toBe(false);
    const log = (await adm.unsafe(`select count(*)::int n from public.audit_logs where action='access.cap_exclusiva' and actor_id=$1`, [master.uid])) as { n: number }[];
    expect(log[0]!.n).toBe(1);
  });
  test("não serve para outras permissões e ninguém chama pelo navegador", async () => {
    const r = await rpcServico("cap_exclusiva_definir", { _cap: "candidaturas.edit", _user: daniel.uid, _actor: master.uid, _motivo: "x" });
    expect(r.ok).toBe(false);
    const n = await rpc(master, "cap_exclusiva_definir", { _cap: "candidaturas.mark_lost", _user: master.uid, _actor: master.uid, _motivo: "x" });
    expect(n.ok).toBe(false);
  });
});
