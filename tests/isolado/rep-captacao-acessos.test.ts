/**
 * 0245 — captação do representante, contrato pela candidatura, CPF, convite só com senha e acessos.
 * Banco ISOLADO, dados sintéticos, sem rede.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, type Conta } from "./base";

let master: Conta, diretoria: Conta, repC: Conta, outroRep: Conta, cons: Conta, consEquipe: Conta;
let n = 0;
const marca = () => `${Date.now().toString(36)}${++n}`;
const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
function cpf(): string {
  const b = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (x: number[]) => { const s = x.reduce((a, d, i) => a + d * (x.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(b); return [...b, d1, dv([...b, d1])].join("");
}
async function servico<T>(sql: string, p: unknown[] = []): Promise<{ dados: T | null; erro: string | null }> {
  const c = await adm.reserve();
  try {
    await c.unsafe(`set role service_role`);
    await c.unsafe(`select set_config('lardan.test_role','service_role',false), set_config('lardan.test_uid','',false)`);
    return { dados: ((await c.unsafe(sql, p)) as { r: T }[])[0]!.r, erro: null };
  } catch (e) { return { dados: null, erro: (e as Error).message }; }
  finally { try { await c.unsafe(`reset role`); await c.unsafe(`select set_config('lardan.test_role','',false)`); } catch { /* */ } c.release(); }
}
async function lead(rep: string, party: string | null, status = "novo", cpfDigits: string | null = null) {
  return (await um<{ id: string }>(`insert into public.leads (full_name, whatsapp, city, uf, privacy_version, status, party_id, representante_party_id, representante_origem, cpf, stage_id)
      values ($1,'43999990000','Londrina','PR','v1',$2::lead_status,$3,$4,'encaminhada',$5,(select id from public.candidatura_stages order by sort_order limit 1)) returning id`, [`ISO Cand ${marca()}`, status, party, rep, cpfDigits])).id;
}

beforeAll(async () => {
  master = await criarConta({ nome: `cap-master-${marca()}`, papeis: ["master"], comParty: true });
  diretoria = await criarConta({ nome: `cap-dir-${marca()}`, papeis: ["diretoria"], comParty: true });
  repC = await criarConta({ nome: `cap-rep-${marca()}`, papeis: ["representante"], comParty: true });
  outroRep = await criarConta({ nome: `cap-rep2-${marca()}`, papeis: ["representante"], comParty: true });
  cons = await criarConta({ nome: `cap-cons-${marca()}`, papeis: ["consultora"], comParty: true });
  consEquipe = await criarConta({ nome: `cap-consrep-${marca()}`, papeis: ["consultora", "representante"], comParty: true });
  await adm.unsafe(`insert into public.party_roles (party_id, role) values ($1,'representante'),($2,'representante'),($3,'consultora'),($4,'consultora') on conflict do nothing`,
    [repC.partyId, outroRep.partyId, cons.partyId, consEquipe.partyId]);
  await adm.unsafe(`insert into public.contact_points (party_id, kind, value, is_primary) values ($1,'whatsapp','43999990000',true)`, [cons.partyId]);
});

describe("1. captação e contrato pela candidatura", () => {
  test("rep_crm traz o cadastro e o CPF da candidatura; contrato liberado pela candidatura", async () => {
    const meuCpf = cpf();
    await lead(repC.partyId!, cons.partyId, "aprovado", meuCpf);
    const crm = await rpc<{ cards: { party_id: string | null; sistema: string | null; tem_cpf: boolean }[] }>(repC, "rep_crm", { _rep: repC.partyId });
    expect(crm.erro).toBeNull();
    const c = crm.dados.cards.find((x) => x.party_id === cons.partyId)!;
    expect(c.sistema).toBe("aprovada");
    expect(c.tem_cpf).toBe(true);
    // sem consultant_profiles: antes dava "Sem permissão"; agora a candidatura basta
    const d = await rpc<{ pendencias: string[] }>(repC, "assinatura_dados", { _tipo: "contrato", _party: cons.partyId, _cycle: null, _rep: repC.partyId });
    expect(d.erro).toBeNull();
    expect(d.dados.pendencias).toEqual(["CPF da consultora"]);
    expect((await rpc(outroRep, "assinatura_dados", { _tipo: "contrato", _party: cons.partyId, _cycle: null, _rep: outroRep.partyId })).ok).toBe(false);
  });

  test("CPF: usa o da candidatura, recusa inválido, não troca o que já existe, outro rep não mexe", async () => {
    expect((await rpc(outroRep, "rep_consultora_cpf_definir", { _rep: outroRep.partyId, _party: cons.partyId, _cpf: null })).ok).toBe(false);
    expect((await rpc(repC, "rep_consultora_cpf_definir", { _rep: repC.partyId, _party: cons.partyId, _cpf: "111.111.111-12" })).erro).toContain("CPF inválido");
    const r = await rpc<{ ok: boolean; fonte: string }>(repC, "rep_consultora_cpf_definir", { _rep: repC.partyId, _party: cons.partyId, _cpf: null });
    expect(r.erro).toBeNull();
    expect(r.dados.fonte).toBe("candidatura");
    const d = await rpc<{ pendencias: string[] }>(repC, "assinatura_dados", { _tipo: "contrato", _party: cons.partyId, _cycle: null, _rep: repC.partyId });
    expect(d.dados.pendencias).toEqual([]);
    const de_novo = await rpc<{ ja_tinha: boolean }>(repC, "rep_consultora_cpf_definir", { _rep: repC.partyId, _party: cons.partyId, _cpf: cpf() });
    expect(de_novo.dados.ja_tinha).toBe(true);
  });
});

describe("2. convite só com senha", () => {
  test("servidor lê o e-mail do convite; ninguém mais", async () => {
    const hash = `iso${marca()}`.padEnd(64, "0");
    await adm.unsafe(`insert into public.access_invites (party_id, email, roles, token_hash, created_by) values ($1,$2,'{consultora}',$3,$4)`,
      [cons.partyId, `Nova.${marca()}@Exemplo.com`, hash, master.uid]);
    const r = await servico<{ situacao: string; email: string; user_id: string | null }>(`select public.access_invite_conta($1) r`, [hash]);
    expect(r.erro).toBeNull();
    expect(r.dados!.situacao).toBe("valido");
    expect(r.dados!.email).toMatch(/^nova\..*@exemplo\.com$/);
    expect(r.dados!.user_id).toBeNull();
    expect((await rpc(master, "access_invite_conta", { _token_hash: hash })).ok).toBe(false);
    expect((await servico<{ situacao: string }>(`select public.access_invite_conta('nao-existe') r`)).dados!.situacao).toBe("invalido");
  });
});

describe("3. acessos das consultoras", () => {
  test("Daniel (diretoria) e Master veem; representante não; senha só de conta que é só consultora", async () => {
    const l = await rpc<{ total: number; itens: { id: string; pode_definir_senha: boolean }[] }>(diretoria, "consultoras_acessos", { _busca: "ISO cap-cons", _offset: 0 });
    expect(l.erro).toBeNull();
    expect(l.dados.itens.find((x) => x.id === cons.partyId)?.pode_definir_senha).toBe(true);
    expect((await rpc(master, "consultoras_acessos", { _busca: null, _offset: 0 })).ok).toBe(true);
    expect((await rpc(repC, "consultoras_acessos", { _busca: null, _offset: 0 })).ok).toBe(false);
    const ok = await servico<{ user_id: string }>(`select public.consultora_acesso_pode_definir($1,$2) r`, [diretoria.uid, cons.partyId]);
    expect(ok.dados!.user_id).toBe(cons.uid);
    expect((await servico(`select public.consultora_acesso_pode_definir($1,$2) r`, [repC.uid, cons.partyId])).erro).toContain("Só o Daniel");
    expect((await servico(`select public.consultora_acesso_pode_definir($1,$2) r`, [diretoria.uid, consEquipe.partyId])).erro).toContain("equipe Lardan");
    expect((await rpc(diretoria, "consultora_acesso_pode_definir", { _ator: diretoria.uid, _party: cons.partyId })).ok).toBe(false);
  });
});
