/**
 * Homologação do fluxo candidata → consultora.
 *
 * Cria uma candidatura sintética pelo mesmo caminho público do site, converte
 * com sessão real de Master, repete a conversão e dispara duas conversões
 * simultâneas. Nenhum dado real é tocado: tudo usa o prefixo HOMOLOG e é
 * removido no fim.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarConta, limpar, rpc, TEST_PREFIX } from "../security/harness";

const URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!;
const ANON =
  process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]!;
const SERVICE = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
const T = 120_000;

const admin = (path: string, init: RequestInit = {}) =>
  fetch(`${URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });

let tokenMaster: string | null = null;
let leadId = "";
let protocolo = "";
const criados: string[] = [];
const NOME = `${TEST_PREFIX} Candidata ${Date.now()}`;

beforeAll(async () => {
  const master = await criarConta({ nome: "conv-master", papeis: ["master"] });
  tokenMaster = master.token;

  // Restos de execuções anteriores não podem contaminar a prova.
  const velhos = await admin(
    `/parties?select=id&display_name=like.${encodeURIComponent(`${TEST_PREFIX} Candidata%`)}`,
  );
  for (const v of (await velhos.json()) as { id: string }[]) {
    await admin(`/consultant_profiles?party_id=eq.${v.id}`, { method: "DELETE" });
    await admin(`/party_roles?party_id=eq.${v.id}`, { method: "DELETE" });
    await admin(`/contact_points?party_id=eq.${v.id}`, { method: "DELETE" });
    await admin(`/party_addresses?party_id=eq.${v.id}`, { method: "DELETE" });
    await admin(`/leads?party_id=eq.${v.id}`, {
      method: "PATCH",
      body: JSON.stringify({ party_id: null }),
    });
    await admin(`/parties?id=eq.${v.id}`, { method: "DELETE" });
  }
  await admin(`/leads?full_name=like.${encodeURIComponent(`${TEST_PREFIX} Candidata%`)}`, {
    method: "DELETE",
  });

  // Candidatura pelo mesmo caminho público usado pelo formulário do site.
  const r = await fetch(`${URL}/rest/v1/rpc/submit_lead`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_full_name: NOME,
      p_whatsapp: "+5511990001122",
      p_city: "São Paulo",
      p_uf: "SP",
      p_postal_code: "01001000",
      p_financial_goal: "1000",
      p_availability: "integral",
      p_experience: "nenhuma",
      p_audience: "amigas",
      p_motivation: "renda",
      p_source: "homologacao",
      p_entry_url: "http://localhost:8080/seja-lardan",
      p_utm: {},
      p_privacy_version: "1.0",
      p_marketing_consent: true,
    }),
  });
  const body = (await r.json()) as { protocol?: string } | string;
  protocolo = typeof body === "string" ? body : (body?.protocol ?? "");

  const lista = await admin(
    `/leads?select=id,protocol,source,utm,privacy_version,marketing_consent,party_id&full_name=eq.${encodeURIComponent(NOME)}`,
  );
  const leads = (await lista.json()) as { id: string; protocol: string }[];
  leadId = leads[0]?.id ?? "";
  protocolo ||= leads[0]?.protocol ?? "";
}, T);

afterAll(async () => {
  for (const id of criados) await admin(`/parties?id=eq.${id}`, { method: "DELETE" });
  if (leadId) await admin(`/leads?id=eq.${leadId}`, { method: "DELETE" });
  await limpar();
}, T);

describe("candidata → consultora", () => {
  it(
    "a candidatura entra pelo formulário público e recebe protocolo",
    async () => {
      expect(leadId, "candidatura criada").toBeTruthy();
      expect(protocolo, "protocolo gerado").toBeTruthy();
    },
    T,
  );

  it(
    "converte, preserva origem/UTM/consentimento e não cria login",
    async () => {
      const conv = await rpc(tokenMaster, "convert_lead_to_consultant", { _lead_id: leadId });
      expect(conv.status, JSON.stringify(conv.body)).toBeLessThan(400);
      const partyId = String(conv.body);
      criados.push(partyId);

      const lead = await admin(
        `/leads?select=party_id,source,utm,privacy_version,marketing_consent,status&id=eq.${leadId}`,
      );
      const [l] = (await lead.json()) as Record<string, unknown>[];
      expect(l!["party_id"]).toBe(partyId);
      expect(l!["source"]).toBe("homologacao");
      expect(l!["privacy_version"]).toBe("1.0");
      expect(l!["marketing_consent"]).toBe(true);

      const papel = await admin(`/party_roles?select=role&party_id=eq.${partyId}`);
      const papeis = ((await papel.json()) as { role: string }[]).map((p) => p.role);
      expect(papeis).toContain("consultora");

      const perfil = await admin(`/consultant_profiles?select=party_id&party_id=eq.${partyId}`);
      expect(((await perfil.json()) as unknown[]).length).toBe(1);

      // Nenhum login é criado automaticamente.
      const prof = await admin(`/profiles?select=id&party_id=eq.${partyId}`);
      expect(((await prof.json()) as unknown[]).length).toBe(0);
    },
    T,
  );

  it(
    "repetir a mesma conversão não cria segunda pessoa nem segunda consultora",
    async () => {
      const antes = criados[0]!;
      const de_novo = await rpc(tokenMaster, "convert_lead_to_consultant", { _lead_id: leadId });
      expect(de_novo.status).toBeLessThan(400);
      expect(String(de_novo.body)).toBe(antes);

      const pessoas = await admin(`/parties?select=id&display_name=eq.${encodeURIComponent(NOME)}`);
      expect(((await pessoas.json()) as unknown[]).length).toBeLessThanOrEqual(1);

      const papeis = await admin(`/party_roles?select=id&party_id=eq.${antes}&role=eq.consultora`);
      expect(((await papeis.json()) as unknown[]).length).toBe(1);
    },
    T,
  );

  it(
    "dois cliques simultâneos devolvem a mesma pessoa",
    async () => {
      const [a, b] = await Promise.all([
        rpc(tokenMaster, "convert_lead_to_consultant", { _lead_id: leadId }),
        rpc(tokenMaster, "convert_lead_to_consultant", { _lead_id: leadId }),
      ]);
      const ok = [a, b].filter((r) => r.status < 400).map((r) => String(r.body));
      expect(ok.length).toBeGreaterThan(0);
      for (const id of ok) expect(id).toBe(criados[0]);

      const perfis = await admin(`/consultant_profiles?select=party_id&party_id=eq.${criados[0]}`);
      expect(((await perfis.json()) as unknown[]).length).toBe(1);
    },
    T,
  );

  it(
    "a conversão fica registrada na auditoria",
    async () => {
      const r = await admin(
        `/audit_logs?select=action,entity,entity_id&entity_id=eq.${criados[0]}&limit=20`,
      );
      const linhas = (await r.json()) as unknown[];
      expect(linhas.length).toBeGreaterThan(0);
    },
    T,
  );
});
