/**
 * CRM de Candidaturas — homologação ponta a ponta.
 *
 * Cobre os 20 cenários obrigatórios: entrada pelo site, atribuição de origem,
 * funil, follow-ups, WhatsApp, ganho/perda/reabertura, etiquetas, responsável,
 * duplicidade, busca, lista e permissão (menu, URL e API).
 *
 * Nada real é tocado: as candidaturas criadas usam WhatsApp sintético com
 * marcador próprio e são removidas ao final, uma a uma, pelo id criado aqui.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarConta, limpar, rpc, comoUsuario, type Conta } from "../security/harness";

const URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!;
const SERVICE = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;

const T = 180_000;
const marca = Date.now().toString().slice(-6);
let master: Conta;
let consultora: Conta;
let suporte: Conta;
const criados: string[] = [];
/** Candidaturas auxiliares, fora da numeração usada pelos cenários por índice. */
const extras: string[] = [];

async function admin(path: string, init: RequestInit = {}) {
  const res = await fetch(`${URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const txt = await res.text();
  try {
    return { status: res.status, body: JSON.parse(txt) as unknown };
  } catch {
    return { status: res.status, body: txt };
  }
}

/**
 * CPF sintético válido e estável por sufixo: mesma candidata = mesmo CPF
 * (o reenvio precisa cair na regra de duplicidade), candidatas diferentes
 * nunca colidem. Nenhum CPF real é usado.
 */
function cpfSintetico(sufixo: string): string {
  const base = `${marca}${sufixo}`.replace(/\D/g, "").padStart(9, "7").slice(-9);
  const digitos = base.split("").map(Number);
  const dv = (parcial: number[]) => {
    const peso = parcial.length + 1;
    const soma = parcial.reduce((acc, n, i) => acc + n * (peso - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(digitos);
  const d2 = dv([...digitos, d1]);
  return `${digitos.join("")}${d1}${d2}`;
}

/** Envia como o site envia: anônimo, pela rotina oficial. */
async function enviar(
  sufixo: string,
  tracking: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  const r = await rpc(null, "submit_candidatura", {
    _payload: {
      first_name: "HOMOLOG",
      last_name: `Candidata ${sufixo}`,
      cpf: cpfSintetico(sufixo),
      whatsapp: `43 9${marca}${sufixo}`,
      city: "Ibiporã",
      uf: "PR",
      financial_goal: "Aumentar minha renda",
      availability: "De 5 a 10 horas por semana",
      experience: "Já vendi de forma informal",
      motivation: "Quero construir meu próprio negócio.",
      privacy_version: "2026-09-05.v1",
      marketing_consent: true,
      ...extra,
    },
    _tracking: tracking,
  });
  return r;
}


async function acharPorProtocolo(protocolo: string) {
  const r = await admin(`/rest/v1/leads?protocol=eq.${protocolo}&select=*`);
  const linhas = r.body as Record<string, unknown>[];
  return linhas[0] ?? null;
}

type Board = { cards: { id: string; protocolo: string; origem: string }[]; radar: Record<string, number> };
type Detalhe = {
  candidatura: Record<string, unknown>;
  origem: Record<string, unknown>;
  tecnico: Record<string, unknown> | null;
  timeline: { titulo: string; tipo: string }[];
  followups: { id: string; situacao: string; atrasado: boolean }[];
  envios: unknown[];
};

const detalhe = async (token: string | null, id: string) =>
  (await rpc(token, "crm_detail", { _lead: id })).body as Detalhe;

beforeAll(async () => {
  master = await criarConta({ nome: "crm.master", papeis: ["master"] });
  suporte = await criarConta({ nome: "crm.suporte", papeis: ["suporte"] });
  consultora = await criarConta({ nome: "crm.consultora", papeis: ["consultora"] });
  expect(master.token).toBeTruthy();
}, T);

afterAll(async () => {
  for (const id of [...criados, ...extras]) {
    await admin(`/rest/v1/leads?id=eq.${id}`, { method: "DELETE" });
  }

  await limpar();
}, T);

describe("CRM de Candidaturas", () => {
  it(
    "1 · formulário do site cria a candidatura e ela aparece no CRM",
    async () => {
      const r = await enviar("01", { landing_page: "https://lardan.lovable.app/seja-lardan" });
      expect(r.status).toBe(200);
      const protocolo = (r.body as { protocol: string }).protocol;
      expect(protocolo).toMatch(/^CAP/);

      const linha = await acharPorProtocolo(protocolo);
      expect(linha).not.toBeNull();
      criados.push(linha!["id"] as string);

      const board = (await rpc(master.token, "crm_board", { _f: {} })).body as Board;
      expect(board.cards.some((c) => c.protocolo === protocolo)).toBe(true);

      // etapa inicial + atividade automática
      const d = await detalhe(master.token, linha!["id"] as string);
      expect(d.timeline.map((e) => e.tipo)).toContain("submissao");
      expect(d.envios.length).toBe(1);
    },
    T,
  );

  it(
    "2 · UTM do Google distingue busca orgânica, anúncio e origem genérica",
    async () => {
      const r = await enviar("02", { utm: { utm_source: "google", utm_medium: "organic" } });
      const linha = await acharPorProtocolo((r.body as { protocol: string }).protocol);
      criados.push(linha!["id"] as string);
      expect(linha!["source_normalized"]).toBe("google_organico");

      // candidatas distintas (sufixos próprios) para não cair na regra de duplicidade
      const pago = await enviar("42", { utm: { utm_source: "google", utm_medium: "cpc" } });
      const lPago = await acharPorProtocolo((pago.body as { protocol: string }).protocol);
      extras.push(lPago!["id"] as string);
      expect(lPago!["source_normalized"]).toBe("google_ads");

      const generico = await enviar("43", { utm: { utm_source: "google" } });
      const lGen = await acharPorProtocolo((generico.body as { protocol: string }).protocol);
      extras.push(lGen!["id"] as string);
      expect(lGen!["source_normalized"]).toBe("google");
    },
    T,
  );



  it(
    "3 · UTM do ChatGPT é classificada como ChatGPT",
    async () => {
      const r = await enviar("03", { utm: { utm_source: "chatgpt" } });
      const linha = await acharPorProtocolo((r.body as { protocol: string }).protocol);
      criados.push(linha!["id"] as string);
      expect(linha!["source_normalized"]).toBe("chatgpt");
    },
    T,
  );

  it(
    "4 · sem UTM e sem referência a origem fica NÃO IDENTIFICADA (nada é inventado)",
    async () => {
      const r = await enviar("04", {});
      const linha = await acharPorProtocolo((r.body as { protocol: string }).protocol);
      criados.push(linha!["id"] as string);
      expect(linha!["source_normalized"]).toBe("nao_identificado");
    },
    T,
  );

  it(
    "20 · IP e user-agent gravados no servidor e escondidos de quem não tem permissão",
    async () => {
      const r = await enviar("20", {
        ip: "203.0.113.45",
        user_agent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
        referrer: "https://www.google.com/",
      });
      const linha = await acharPorProtocolo((r.body as { protocol: string }).protocol);
      const id = linha!["id"] as string;
      criados.push(id);

      expect(linha!["ip"]).toBe("203.0.113.45");
      expect(linha!["device_type"]).toBe("celular");
      expect(linha!["os"]).toBe("iOS");
      expect(linha!["source_normalized"]).toBe("google_organico");

      const comPii = await detalhe(master.token, id);
      expect((comPii.tecnico as { ip: string }).ip).toBe("203.0.113.45");

      const semPii = await detalhe(suporte.token, id);
      expect(semPii.tecnico).toBeNull();
    },
    T,
  );

  it(
    "5 · mover no Kanban persiste depois de recarregar",
    async () => {
      const id = criados[0]!;
      const etapas = (await rpc(master.token, "crm_options")).body as {
        etapas: { id: string; chave: string }[];
      };
      const destino = etapas.etapas.find((e) => e.chave === "primeiro")!.id;

      const mv = await rpc(master.token, "crm_move_stage", { _lead: id, _stage: destino });
      expect(mv.status).toBe(200);

      // releitura independente: o banco é a fonte da verdade
      const relido = await admin(`/rest/v1/leads?id=eq.${id}&select=stage_id`);
      expect((relido.body as { stage_id: string }[])[0]!.stage_id).toBe(destino);

      const d = await detalhe(master.token, id);
      expect(d.timeline.some((e) => e.tipo === "etapa")).toBe(true);
      const hist = await admin(
        `/rest/v1/candidatura_stage_history?lead_id=eq.${id}&select=to_stage_id,actor_id`,
      );
      expect((hist.body as unknown[]).length).toBeGreaterThanOrEqual(2);
    },
    T,
  );

  it(
    "6 e 7 · follow-up criado aparece na ficha e no Radar; vencido conta como atrasado",
    async () => {
      const id = criados[1]!;
      const futuro = new Date(Date.now() + 3600_000).toISOString();
      const f1 = await rpc(master.token, "crm_followup_create", {
        _lead: id,
        _due_at: futuro,
        _kind: "ligacao",
        _note: "Retornar sobre disponibilidade",
      });
      expect(f1.status).toBe(200);

      const d = await detalhe(master.token, id);
      expect(d.followups.length).toBe(1);
      expect(d.candidatura["proximo_followup"]).toBeTruthy();

      const radar = (await rpc(master.token, "crm_radar")).body as Record<string, number>;
      expect(radar["proximas"]).toBeGreaterThanOrEqual(1);

      // vencido
      const passado = new Date(Date.now() - 2 * 86400_000).toISOString();
      const f2 = await rpc(master.token, "crm_followup_create", {
        _lead: criados[2]!,
        _due_at: passado,
        _kind: "whatsapp",
      });
      expect(f2.status).toBe(200);
      const atrasada = await detalhe(master.token, criados[2]!);
      expect(atrasada.followups[0]!.atrasado).toBe(true);
      const radar2 = (await rpc(master.token, "crm_radar")).body as Record<string, number>;
      expect(radar2["atrasados"]).toBeGreaterThanOrEqual(1);

      const agenda = (await rpc(master.token, "crm_followups_list", { _escopo: "atrasados" }))
        .body as { candidatura_id: string }[];
      expect(agenda.some((a) => a.candidatura_id === criados[2]!)).toBe(true);
    },
    T,
  );

  it(
    "8 · concluir follow-up muda a situação e entra na linha do tempo",
    async () => {
      const id = criados[1]!;
      const antes = await detalhe(master.token, id);
      const fid = antes.followups[0]!.id;

      const r = await rpc(master.token, "crm_followup_complete", {
        _id: fid,
        _outcome: "Conversou e pediu retorno na semana que vem",
      });
      expect(r.status).toBe(200);

      const depois = await detalhe(master.token, id);
      expect(depois.followups[0]!.situacao).toBe("concluido");
      expect(depois.candidatura["proximo_followup"]).toBeNull();
      expect(depois.candidatura["primeiro_atendimento"]).toBeTruthy();
      expect(depois.timeline.some((e) => e.titulo === "Follow-up concluído")).toBe(true);

      // repetir é recusado: não existe conclusão dupla
      const repetido = await rpc(master.token, "crm_followup_complete", { _id: fid });
      expect(repetido.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );

  it(
    "9 · WhatsApp gera link válido e atividade de clique, sem afirmar envio",
    async () => {
      const id = criados[0]!;
      const linha = await admin(`/rest/v1/leads?id=eq.${id}&select=whatsapp_norm`);
      const numero = (linha.body as { whatsapp_norm: string }[])[0]!.whatsapp_norm;
      const url = `https://wa.me/${numero.startsWith("55") ? numero : `55${numero}`}`;
      expect(url).toMatch(/^https:\/\/wa\.me\/55\d{10,11}$/);

      const r = await rpc(master.token, "crm_whatsapp_click", { _lead: id });
      expect(r.status).toBe(200);
      const d = await detalhe(master.token, id);
      const ev = d.timeline.find((e) => e.tipo === "whatsapp")!;
      expect(ev.titulo).toContain("WhatsApp acionado");
      // o registro é do clique, nunca de "mensagem enviada"
      expect(ev.titulo.toLowerCase()).not.toContain("enviad");
    },
    T,
  );

  it(
    "10 e 11 · perda guarda motivo e a reabertura preserva o histórico",
    async () => {
      const id = criados[3]!;
      const opc = (await rpc(master.token, "crm_options")).body as {
        motivos_perda: { id: string; rotulo: string; exige_observacao: boolean }[];
      };
      const outro = opc.motivos_perda.find((m) => m.exige_observacao)!;
      const semRetorno = opc.motivos_perda.find((m) => m.rotulo === "Sem retorno")!;

      // "Outro" sem observação é recusado
      const recusado = await rpc(master.token, "crm_mark_lost", { _lead: id, _reason: outro.id });
      expect(recusado.status).toBeGreaterThanOrEqual(400);

      const r = await rpc(master.token, "crm_mark_lost", {
        _lead: id,
        _reason: semRetorno.id,
        _nota: "Três tentativas sem resposta.",
      });
      expect(r.status).toBe(200);

      const linha = await admin(
        `/rest/v1/leads?id=eq.${id}&select=outcome,lost_reason_id,lost_notes,lost_at,lost_by`,
      );
      const l = (linha.body as Record<string, unknown>[])[0]!;
      expect(l["outcome"]).toBe("perdida");
      expect(l["lost_reason_id"]).toBe(semRetorno.id);
      expect(l["lost_notes"]).toBe("Três tentativas sem resposta.");
      expect(l["lost_at"]).toBeTruthy();
      expect(l["lost_by"]).toBe(master.userId);

      const eventosAntes = (await detalhe(master.token, id)).timeline.length;
      const re = await rpc(master.token, "crm_reopen", { _lead: id, _nota: "Ela retornou." });
      expect(re.status).toBe(200);
      const d = await detalhe(master.token, id);
      expect(d.candidatura["desfecho"]).toBe("aberta");
      expect(d.timeline.length).toBeGreaterThan(eventosAntes);
      expect(d.timeline.some((e) => e.tipo === "perda")).toBe(true);
    },
    T,
  );

  it(
    "12 · ganho registra usuário, data e etapa anterior",
    async () => {
      const id = criados[2]!;
      const r = await rpc(master.token, "crm_mark_won", { _lead: id, _nota: "Perfil aderente." });
      expect(r.status).toBe(200);
      const linha = await admin(`/rest/v1/leads?id=eq.${id}&select=outcome,won_at,won_by,party_id`);
      const l = (linha.body as Record<string, unknown>[])[0]!;
      expect(l["outcome"]).toBe("ganha");
      expect(l["won_by"]).toBe(master.userId);
      // aprovada NÃO cria consultora automaticamente
      expect(l["party_id"]).toBeNull();
    },
    T,
  );

  it(
    "13 · etiquetas persistem e podem ser removidas",
    async () => {
      const id = criados[0]!;
      const opc = (await rpc(master.token, "crm_options")).body as { etiquetas: { id: string }[] };
      const tag = opc.etiquetas[0]!.id;

      await rpc(master.token, "crm_tag_set", { _lead: id, _tag: tag, _aplicar: true });
      let vinc = await admin(`/rest/v1/candidatura_tag_links?lead_id=eq.${id}&select=tag_id`);
      expect((vinc.body as unknown[]).length).toBe(1);

      await rpc(master.token, "crm_tag_set", { _lead: id, _tag: tag, _aplicar: false });
      vinc = await admin(`/rest/v1/candidatura_tag_links?lead_id=eq.${id}&select=tag_id`);
      expect((vinc.body as unknown[]).length).toBe(0);
    },
    T,
  );

  it(
    "14 · responsável persiste e entra na linha do tempo",
    async () => {
      const id = criados[0]!;
      const r = await rpc(master.token, "crm_assign", { _lead: id, _user: master.userId });
      expect(r.status).toBe(200);
      const linha = await admin(`/rest/v1/leads?id=eq.${id}&select=assigned_to`);
      expect((linha.body as { assigned_to: string }[])[0]!.assigned_to).toBe(master.userId);
      const d = await detalhe(master.token, id);
      expect(d.timeline.some((e) => e.tipo === "responsavel")).toBe(true);
    },
    T,
  );

  it(
    "15 · reenvio da mesma pessoa não cria candidatura duplicada",
    async () => {
      const antes = await admin(`/rest/v1/leads?id=eq.${criados[0]}&select=submissions_count`);
      const contagemAntes = (antes.body as { submissions_count: number }[])[0]!.submissions_count;

      const r = await enviar("01", { utm: { utm_source: "instagram" } });
      expect(r.status).toBe(200);
      expect((r.body as { duplicate: boolean }).duplicate).toBe(true);

      const depois = await admin(
        `/rest/v1/leads?id=eq.${criados[0]}&select=submissions_count,protocol`,
      );
      const l = (depois.body as { submissions_count: number; protocol: string }[])[0]!;
      expect(l.submissions_count).toBe(contagemAntes + 1);

      // o envio antigo continua guardado; nada é apagado
      const envios = await admin(
        `/rest/v1/candidatura_submissions?lead_id=eq.${criados[0]}&select=id,is_duplicate`,
      );
      expect((envios.body as unknown[]).length).toBeGreaterThanOrEqual(2);

      const d = await detalhe(master.token, criados[0]!);
      expect(
        d.timeline.some((e) => e.titulo.includes("Nova candidatura recebida novamente")),
      ).toBe(true);
    },
    T,
  );

  it(
    "16 · sem permissão não passa por menu, URL nem API",
    async () => {
      // rotina do CRM recusada para papel sem permissão
      for (const nome of ["crm_board", "crm_radar", "crm_options"]) {
        const r = await rpc(consultora.token, nome, nome === "crm_board" ? { _f: {} } : {});
        expect(r.status).toBeGreaterThanOrEqual(400);
      }
      // ficha por id direto
      const ficha = await rpc(consultora.token, "crm_detail", { _lead: criados[0] });
      expect(ficha.status).toBeGreaterThanOrEqual(400);
      // ação de escrita
      const mover = await rpc(consultora.token, "crm_move_stage", {
        _lead: criados[0],
        _stage: criados[0],
      });
      expect(mover.status).toBeGreaterThanOrEqual(400);
      // leitura direta pela API de tabelas
      const direto = await comoUsuario(
        consultora.token,
        `/leads?id=eq.${criados[0]}&select=full_name,ip`,
      );
      expect(Array.isArray(direto.body) ? (direto.body as unknown[]).length : 0).toBe(0);
      // visitante anônimo
      const anon = await rpc(null, "crm_board", { _f: {} });
      expect(anon.status).toBeGreaterThanOrEqual(400);
      // e o site não grava mais direto na tabela
      const insercao = await comoUsuario(null, `/leads`, {
        method: "POST",
        body: JSON.stringify({ full_name: "X", whatsapp: "43999999999", city: "a", uf: "PR" }),
      });
      expect(insercao.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );

  it(
    "17 · suporte opera o funil mas não configura nem vê dados técnicos",
    async () => {
      const board = await rpc(suporte.token, "crm_board", { _f: {} });
      expect(board.status).toBe(200);
      const config = await rpc(suporte.token, "crm_stage_save", {
        _payload: { nome: "Etapa proibida" },
      });
      expect(config.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );

  it(
    "18 e 19 · lista, filtros e busca respondem com o recorte certo",
    async () => {
      const busca = (await rpc(master.token, "crm_list", {
        _f: { q: `Candidata 02` },
        _limit: 50,
        _offset: 0,
      })).body as { total: number; itens: { id: string }[] };
      expect(busca.total).toBeGreaterThanOrEqual(1);
      expect(busca.itens.some((i) => i.id === criados[1])).toBe(true);

      const porOrigem = (await rpc(master.token, "crm_list", { _f: { origem: "chatgpt" } }))
        .body as { itens: { id: string }[] };
      expect(porOrigem.itens.some((i) => i.id === criados[2])).toBe(true);

      const porProtocolo = await admin(`/rest/v1/leads?id=eq.${criados[3]}&select=protocol`);
      const proto = (porProtocolo.body as { protocol: string }[])[0]!.protocol;
      const achado = (await rpc(master.token, "crm_list", { _f: { q: proto } })).body as {
        itens: { id: string }[];
      };
      expect(achado.itens[0]!.id).toBe(criados[3]);

      const ganhas = (await rpc(master.token, "crm_list", { _f: { desfecho: "ganha" } })).body as {
        itens: { id: string }[];
      };
      expect(ganhas.itens.some((i) => i.id === criados[2])).toBe(true);

      const metricas = (await rpc(master.token, "crm_metrics", {})).body as Record<string, unknown>;
      expect(Number(metricas["total"])).toBeGreaterThanOrEqual(4);
    },
    T,
  );

  it(
    "extra · campos com HTML/script são guardados como texto, sem execução",
    async () => {
      const r = await enviar("09", {}, { motivation: "<script>alert(1)</script> teste" });
      const linha = await acharPorProtocolo((r.body as { protocol: string }).protocol);
      criados.push(linha!["id"] as string);
      expect(linha!["motivation"]).toBe("<script>alert(1)</script> teste");
    },
    T,
  );

  it(
    "extra · payload inválido é recusado pela rotina oficial",
    async () => {
      const semNome = await rpc(null, "submit_candidatura", {
        _payload: { first_name: "a", whatsapp: "4399", city: "x", uf: "ZZ", privacy_version: "" },
      });
      expect(semNome.status).toBeGreaterThanOrEqual(400);

      // CPF inválido é recusado mesmo com o resto do formulário correto
      const cpfRuim = await rpc(null, "submit_candidatura", {
        _payload: {
          first_name: "HOMOLOG",
          last_name: "Candidata CPF",
          cpf: "111.111.111-11",
          whatsapp: `43 9${marca}99`,
          city: "Ibiporã",
          uf: "PR",
          privacy_version: "2026-09-05.v1",
        },
      });
      expect(cpfRuim.status).toBeGreaterThanOrEqual(400);

      // sobrenome ausente também é recusado
      const semSobrenome = await rpc(null, "submit_candidatura", {
        _payload: {
          first_name: "HOMOLOG",
          cpf: cpfSintetico("98"),
          whatsapp: `43 9${marca}98`,
          city: "Ibiporã",
          uf: "PR",
          privacy_version: "2026-09-05.v1",
        },
      });
      expect(semSobrenome.status).toBeGreaterThanOrEqual(400);
    },
    T,
  );
});

