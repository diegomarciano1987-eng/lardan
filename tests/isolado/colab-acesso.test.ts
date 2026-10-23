/**
 * 0130 — login da colaboradora por código + senha e módulos liberados pelo Master. Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, rpcServico, type Conta } from "./base";

const base = 100 + Math.floor(Math.random() * 89000);
const cod = (n: number) => String(10000000 + base * 10 + n).slice(-8);
let master: Conta, colab: Conta, semPapel: Conta, estoque: Conta;

const caps = async (c: Conta) =>
  ((await rpc<{ capability: string }[]>(c, "my_capabilities", {})).dados ?? []).map((r) => r.capability);

beforeAll(async () => {
  master = await criarConta({ nome: `colab-master-${base}`, papeis: ["master"], comParty: true });
  colab = await criarConta({ nome: `colab-ana-${base}`, papeis: [], comParty: true });
  semPapel = await criarConta({ nome: `colab-sem-${base}`, papeis: [], comParty: true });
  estoque = await criarConta({ nome: `colab-est-${base}`, papeis: ["estoque"], comParty: true });
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'colaborador')`, [colab.partyId]);
});

describe("acesso da colaboradora por código", () => {
  test("só o Master cria o código; precisa do papel Colaborador; código não repete", async () => {
    expect((await rpcServico("colab_acesso_registrar", { _user_id: colab.uid, _party_id: colab.partyId, _codigo: cod(1), _actor: estoque.uid })).erro)
      .toContain("Somente o Master");
    expect((await rpcServico("colab_acesso_registrar", { _user_id: semPapel.uid, _party_id: semPapel.partyId, _codigo: cod(2), _actor: master.uid })).erro)
      .toContain("Colaboradora");
    expect((await rpcServico("colab_acesso_registrar", { _user_id: colab.uid, _party_id: colab.partyId, _codigo: cod(1), _actor: master.uid })).erro).toBeNull();
    await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'colaborador')`, [semPapel.partyId]);
    expect((await rpcServico("colab_acesso_registrar", { _user_id: semPapel.uid, _party_id: semPapel.partyId, _codigo: cod(1), _actor: master.uid })).erro)
      .toContain("já é de outra");
  });

  test("sem módulos ela não tem permissão nenhuma", async () => {
    expect(await caps(colab)).toEqual([]);
  });

  test("módulos liberados viram permissões reais; ver ≠ alterar", async () => {
    const r = await rpcServico("colab_modulos_definir", { _user_id: colab.uid, _caps: ["kit.view", "catalog.view"], _financeiro: false, _actor: master.uid });
    expect(r.erro).toBeNull();
    const c = await caps(colab);
    expect(c).toContain("kit.view");
    expect(c).toContain("catalog.view");
    expect(c).not.toContain("kit.manage");
    expect(c).not.toContain("catalog.manage");
  });

  test("permissão fora da lista (usuários, financeiro solto) é recusada", async () => {
    expect((await rpcServico("colab_modulos_definir", { _user_id: colab.uid, _caps: ["users.manage"], _financeiro: false, _actor: master.uid })).erro)
      .toContain("não liberável");
    expect((await rpcServico("colab_modulos_definir", { _user_id: colab.uid, _caps: ["finance.view"], _financeiro: false, _actor: master.uid })).erro)
      .toContain("não liberável");
  });

  test("acesso suspenso corta as permissões na hora; liberar devolve", async () => {
    expect((await rpcServico("colab_acesso_ativo_definir", { _user_id: colab.uid, _ativo: false, _actor: master.uid })).erro).toBeNull();
    expect(await caps(colab)).toEqual([]);
    await rpcServico("colab_acesso_ativo_definir", { _user_id: colab.uid, _ativo: true, _actor: master.uid });
    expect(await caps(colab)).toContain("kit.view");
  });

  test("tudo fica na auditoria", async () => {
    const n = (await adm.unsafe(`select count(*)::int n from public.audit_logs where entity_id=$1 and action like 'colab.%'`, [colab.uid]))[0].n;
    expect(n).toBeGreaterThanOrEqual(3);
  });
});
