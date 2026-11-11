/**
 * 0284 — teste de candidatura: quem gera o link, o que o representante enxerga, conclusão move a etapa.
 * Banco ISOLADO, dados sintéticos.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { adm, criarConta, rpc, rpcServico, type Conta } from "./base";

const um = async <T>(sql: string, p: unknown[] = []) => ((await adm.unsafe(sql, p)) as T[])[0]!;
const base = 800000 + Math.floor(Math.random() * 90000);
let master: Conta, rep: Conta, outroRep: Conta, consultora: Conta;
let lead = "", leadOutro = "", protocolo = "";

async function novoLead(nome: string, repParty: string | null) {
  const st = await um<{ id: string }>(`select id from public.candidatura_stages where key='nova'`);
  const prot = `T84-${base}-${Math.floor(Math.random() * 1e6)}`;
  const r = await um<{ id: string }>(
    `insert into public.leads (full_name, first_name, whatsapp, city, uf, privacy_version, stage_id, protocol, representante_party_id, dream)
     values ($1,$1,'43999990000','Ibaiti','PR','v1',$2,$3,$4,'Uma moto') returning id`, [nome, st.id, prot, repParty]);
  return { id: r.id, prot };
}

beforeAll(async () => {
  master = await criarConta({ nome: `t84-master-${base}`, papeis: ["master"], comParty: true });
  rep = await criarConta({ nome: `t84-rep-${base}`, papeis: ["representante"], comParty: true });
  outroRep = await criarConta({ nome: `t84-rep2-${base}`, papeis: ["representante"], comParty: true });
  consultora = await criarConta({ nome: `t84-cons-${base}`, papeis: ["consultora"], comParty: true });
  ({ id: lead, prot: protocolo } = await novoLead(`Candidata ${base}`, rep.partyId!));
  ({ id: leadOutro } = await novoLead(`Outra ${base}`, outroRep.partyId!));
});

describe("link do teste", () => {
  test("representante gera o link da candidata dele; repetir devolve o mesmo link", async () => {
    const a = await rpc<{ token: string; novo: boolean }>(rep, "candidatura_teste_gerar", { _lead: lead });
    expect(a.erro).toBeNull();
    expect(a.dados!.token).toMatch(/^[a-f0-9]{64}$/);
    expect(a.dados!.novo).toBe(true);
    const b = await rpc<{ token: string; novo: boolean }>(rep, "candidatura_teste_gerar", { _lead: lead });
    expect(b.dados!.token).toBe(a.dados!.token);
    expect(b.dados!.novo).toBe(false);
    const t = await um<{ origem: string; dias: number }>(`select origem, round(extract(epoch from expira_em - criado_em)/86400)::int dias from public.candidatura_testes where token=$1`, [a.dados!.token]);
    expect(t.origem).toBe("representante");
    expect(t.dias).toBe(15);
  });
  test("representante NÃO gera link de candidata de outra carteira; consultora também não", async () => {
    expect((await rpc(rep, "candidatura_teste_gerar", { _lead: leadOutro })).erro).toContain("sem_permissao");
    expect((await rpc(consultora, "candidatura_teste_gerar", { _lead: lead })).erro).toContain("sem_permissao");
  });
  test("o link do site só o servidor cria (nem visitante nem usuário logado)", async () => {
    const r = await rpc(rep, "candidatura_teste_site", { _protocolo: protocolo, _site: {}, _aceite: "x" });
    expect(r.erro).not.toBeNull();
  });
});

describe("conclusão e o que cada um vê", () => {
  test("concluir marca a avaliação, move para Documentação; representante vê perfil e sonho, nunca o risco", async () => {
    const t = await um<{ id: string }>(`select id from public.candidatura_testes where lead_id=$1`, [lead]);
    await adm.unsafe(`update public.candidatura_testes set concluido_em=now(), versao_teste='2026-09-30',
      resultado='{"disc_perfil":"I+S","disc_principal":"I","disc_pct":{"D":40,"I":75,"S":60,"C":25},"rp_faixa":"alta","risco_acerto":"alto","ioa":30}'::jsonb where id=$1`, [t.id]);
    const s = await rpcServico("candidatura_teste_concluido", { _teste: t.id });
    expect(s.erro).toBeNull();
    const l = await um<{ key: string }>(`select s.key from public.leads l join public.candidatura_stages s on s.id=l.stage_id where l.id=$1`, [lead]);
    expect(l.key).toBe("documentacao");
    const a = await um<{ status: string }>(`select status from public.candidatura_assessments where lead_id=$1 and assessment_type='disc'`, [lead]);
    expect(a.status).toBe("concluido");
    const p = await rpc<Record<string, unknown>>(rep, "rep_candidata_perfil", { _lead: lead });
    expect(p.erro).toBeNull();
    expect(p.dados!["disc_perfil"]).toBe("I+S");
    expect(p.dados!["rede"]).toBe("alta");
    expect(p.dados!["sonho"]).toBe("Uma moto");
    expect(JSON.stringify(p.dados)).not.toContain("risco");
    expect(JSON.stringify(p.dados)).not.toContain("ioa");
  });
  test("outro representante não vê o perfil; a tabela do teste não abre para representante", async () => {
    expect((await rpc(outroRep, "rep_candidata_perfil", { _lead: lead })).erro).toContain("sem_permissao");
    const { linhas } = await (await import("./base")).ler(rep, `select count(*)::int n from public.candidatura_testes`);
    expect((linhas[0] as { n: number }).n).toBe(0);
  });
  test("Master lê a análise completa", async () => {
    const { linhas } = await (await import("./base")).ler(master, `select resultado->>'risco_acerto' r from public.candidatura_testes where lead_id=$1`, [lead]);
    expect((linhas[0] as { r: string }).r).toBe("alto");
  });
});
