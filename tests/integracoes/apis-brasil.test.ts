/**
 * Homologação das APIs brasileiras (CEP e CNPJ) com provedor SIMULADO.
 *
 * Nenhum cenário depende da internet: o transporte HTTP dos provedores é
 * substituído para reproduzir sucesso, 404, 429, timeout e queda dos dois
 * provedores. O banco é o real — é ele que precisa provar cache, auditoria e
 * máscara do que fica persistido.
 *
 * Todos os documentos e CEPs abaixo são sintéticos.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  __definirTransporteDeTeste,
  lookupAddressByPostalCode,
  lookupCompanyByTaxId,
} from "@/lib/br/providers.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/* CEPs e CNPJ sintéticos, reservados para homologação. */
const CEP_OK = "99990001";
const CEP_FALLBACK = "99990002";
const CEP_INEXISTENTE = "99990003";
const CEP_TIMEOUT = "99990004";
const CEP_LIMITE = "99990005";
const CEP_CACHE = "99990006";
const CEP_QUEDA = "99990007";
const CNPJ_OK = "19131243000197"; // válido matematicamente
const CNPJ_INEXISTENTE = "11444777000161";
const CNPJ_ALFA = "12ABC34501DE35";

const CEPS = [CEP_OK, CEP_FALLBACK, CEP_INEXISTENTE, CEP_TIMEOUT, CEP_LIMITE, CEP_CACHE, CEP_QUEDA];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const viaCepBody = (cep: string) => ({
  cep: `${cep.slice(0, 5)}-${cep.slice(5)}`,
  logradouro: "Rua Sintética de Homologação",
  complemento: "lado ímpar",
  bairro: "Bairro Teste",
  localidade: "São Paulo",
  uf: "SP",
  ibge: "3550308",
  ddd: "11",
});

const brasilApiCepBody = (cep: string) => ({
  cep,
  street: "Rua Fallback Homologação",
  neighborhood: "Bairro Fallback",
  city: "Campinas",
  state: "SP",
});

const brasilApiCnpjBody = {
  cnpj: CNPJ_OK,
  razao_social: "HOMOLOG EMPRESA SINTETICA LTDA",
  nome_fantasia: "HOMOLOG SINTETICA",
  descricao_situacao_cadastral: "ATIVA",
  data_situacao_cadastral: "2020-01-02",
  data_inicio_atividade: "2013-10-03",
  natureza_juridica: "206-2 - Sociedade Empresária Limitada",
  porte: "DEMAIS",
  capital_social: 1000,
  cnae_fiscal_descricao: "Comércio varejista de joias",
  cnaes_secundarios: [{ descricao: "Comércio varejista de bijuterias" }],
  logradouro: "AVENIDA SINTETICA",
  numero: "1000",
  complemento: "ANDAR 3",
  bairro: "CENTRO",
  cep: "99990001",
  municipio: "SAO PAULO",
  uf: "SP",
  ddd_telefone_1: "1133334444",
  email: "contato@homolog.test",
  qsa: [{ nome_socio: "SOCIA SINTETICA UM", qualificacao_socio: "Sócio-Administrador" }],
};

/** Transporte controlado: decide a resposta pela URL pedida. */
function instalarTransporte(regras: (url: string) => Response | Promise<Response>) {
  __definirTransporteDeTeste(async (url) => regras(url));
}

const abortar = () => {
  const e = new Error("abort");
  e.name = "AbortError";
  throw e;
};

async function limparRastros() {
  await supabaseAdmin
    .from("integration_cache")
    .delete()
    .in("chave", [...CEPS, CNPJ_OK, CNPJ_INEXISTENTE, CNPJ_ALFA]);
}

beforeEach(async () => {
  await limparRastros();
});

afterAll(async () => {
  __definirTransporteDeTeste(null);
  await limparRastros();
});

describe("CEP — provedor simulado", () => {
  it("CEP válido pelo ViaCEP preenche logradouro, bairro, cidade, UF, IBGE e DDD", async () => {
    instalarTransporte((url) =>
      url.includes("viacep") ? json(viaCepBody(CEP_OK)) : json({}, 500),
    );
    const r = await lookupAddressByPostalCode(CEP_OK, null);
    expect(r.status).toBe("ok");
    expect(r.provider).toBe("viacep");
    expect(r.cache).toBe(false);
    expect(r.dados).toMatchObject({
      logradouro: "Rua Sintética de Homologação",
      bairro: "Bairro Teste",
      cidade: "São Paulo",
      uf: "SP",
      ibge: "3550308",
      ddd: "11",
    });
  });

  it("ViaCEP fora do ar cai para a BrasilAPI", async () => {
    instalarTransporte((url) =>
      url.includes("viacep") ? json({}, 500) : json(brasilApiCepBody(CEP_FALLBACK)),
    );
    const r = await lookupAddressByPostalCode(CEP_FALLBACK, null);
    expect(r.status).toBe("ok");
    expect(r.provider).toBe("brasilapi");
    expect(r.dados?.cidade).toBe("Campinas");
  });

  it("CEP inexistente nos dois provedores devolve orientação de preenchimento manual", async () => {
    instalarTransporte(() => json({ erro: true }, 404));
    const r = await lookupAddressByPostalCode(CEP_INEXISTENTE, null);
    expect(r.status).toBe("nao_encontrado");
    expect(r.dados).toBeNull();
    expect(r.mensagem).toMatch(/manualmente/i);
  });

  it("CEP incompleto nem chega ao provedor", async () => {
    let chamadas = 0;
    instalarTransporte(() => {
      chamadas++;
      return json(viaCepBody(CEP_OK));
    });
    const r = await lookupAddressByPostalCode("9999", null);
    expect(r.status).toBe("dado_invalido");
    expect(chamadas).toBe(0);
  });

  it("colagem com máscara e caracteres excedentes é normalizada", async () => {
    instalarTransporte((url) => {
      expect(url).toContain(CEP_OK);
      return json(viaCepBody(CEP_OK));
    });
    const r = await lookupAddressByPostalCode(" 99.990-001abc ", null);
    expect(r.status).toBe("ok");
  });

  it("timeout do provedor é diferenciado de indisponibilidade", async () => {
    instalarTransporte(() => abortar());
    const r = await lookupAddressByPostalCode(CEP_TIMEOUT, null);
    expect(r.status).toBe("timeout");
  });

  it("429 dos dois provedores vira limite de consultas", async () => {
    instalarTransporte(() => json({}, 429));
    const r = await lookupAddressByPostalCode(CEP_LIMITE, null);
    expect(r.status).toBe("limite");
  });

  it("queda total dos dois provedores permite preenchimento manual", async () => {
    instalarTransporte(() => {
      throw new Error("ECONNRESET");
    });
    const r = await lookupAddressByPostalCode(CEP_QUEDA, null);
    expect(r.status).toBe("indisponivel");
    expect(r.mensagem).toMatch(/manualmente/i);
  });

  it("cache miss consulta o provedor e cache hit não consulta", async () => {
    let chamadas = 0;
    instalarTransporte(() => {
      chamadas++;
      return json(viaCepBody(CEP_CACHE));
    });
    const miss = await lookupAddressByPostalCode(CEP_CACHE, null);
    expect(miss.cache).toBe(false);
    expect(chamadas).toBe(1);

    const hit = await lookupAddressByPostalCode(CEP_CACHE, null);
    expect(hit.cache).toBe(true);
    expect(hit.status).toBe("ok");
    expect(chamadas).toBe(1);
  });
});

describe("CNPJ — provedor simulado", () => {
  it("CNPJ válido devolve o cadastro mapeado", async () => {
    instalarTransporte(() => json(brasilApiCnpjBody));
    const r = await lookupCompanyByTaxId(CNPJ_OK, null, { comQsa: true });
    expect(r.status).toBe("ok");
    expect(r.dados).toMatchObject({
      razao_social: "HOMOLOG EMPRESA SINTETICA LTDA",
      situacao: "ATIVA",
      porte: "DEMAIS",
      capital_social: 1000,
      atividade_principal: "Comércio varejista de joias",
      uf: "SP",
    });
    expect(r.dados?.atividades_secundarias.length).toBe(1);
  });

  it("quadro societário só sai quando autorizado", async () => {
    instalarTransporte(() => json(brasilApiCnpjBody));
    const autorizado = await lookupCompanyByTaxId(CNPJ_OK, null, { comQsa: true });
    expect(autorizado.dados?.socios.length).toBe(1);

    const semPermissao = await lookupCompanyByTaxId(CNPJ_OK, null, { comQsa: false });
    expect(semPermissao.dados?.socios).toEqual([]);
    expect(JSON.stringify(semPermissao)).not.toContain("SOCIA SINTETICA");
  });

  it("pontuação e caracteres excedentes são aceitos", async () => {
    instalarTransporte((url) => {
      expect(url).toContain(CNPJ_OK);
      return json(brasilApiCnpjBody);
    });
    const r = await lookupCompanyByTaxId("19.131.243/0001-97 ", null, { comQsa: false });
    expect(r.status).toBe("ok");
  });

  it("CNPJ com tamanho inválido não chega ao provedor", async () => {
    let chamadas = 0;
    instalarTransporte(() => {
      chamadas++;
      return json(brasilApiCnpjBody);
    });
    const r = await lookupCompanyByTaxId("1913124300019", null, { comQsa: false });
    expect(r.status).toBe("dado_invalido");
    expect(chamadas).toBe(0);
  });

  it("CNPJ alfanumérico é aceito pelo sistema e marcado como incompatível com o provedor", async () => {
    let chamadas = 0;
    instalarTransporte(() => {
      chamadas++;
      return json(brasilApiCnpjBody);
    });
    const r = await lookupCompanyByTaxId(CNPJ_ALFA, null, { comQsa: false });
    expect(r.status).toBe("incompativel");
    expect(chamadas).toBe(0);
    expect(r.mensagem).toMatch(/manualmente/i);
  });

  it("CNPJ inexistente devolve não encontrado", async () => {
    instalarTransporte(() => json({ message: "not found" }, 404));
    const r = await lookupCompanyByTaxId(CNPJ_INEXISTENTE, null, { comQsa: false });
    expect(r.status).toBe("nao_encontrado");
  });

  it("timeout e limite do provedor são distinguidos", async () => {
    instalarTransporte(() => abortar());
    expect((await lookupCompanyByTaxId(CNPJ_OK, null, { comQsa: false })).status).toBe("timeout");
    instalarTransporte(() => json({}, 429));
    expect((await lookupCompanyByTaxId(CNPJ_OK, null, { comQsa: false })).status).toBe("limite");
  });

  it("cache hit não consulta o provedor de novo", async () => {
    let chamadas = 0;
    instalarTransporte(() => {
      chamadas++;
      return json(brasilApiCnpjBody);
    });
    await lookupCompanyByTaxId(CNPJ_OK, null, { comQsa: false });
    const hit = await lookupCompanyByTaxId(CNPJ_OK, null, { comQsa: false });
    expect(chamadas).toBe(1);
    expect(hit.cache).toBe(true);
  });
});

describe("privacidade do que fica persistido", () => {
  it("integration_lookups guarda referência mascarada, nunca o número completo", async () => {
    instalarTransporte(() => json(viaCepBody(CEP_OK)));
    await lookupAddressByPostalCode(CEP_OK, null);
    instalarTransporte(() => json(brasilApiCnpjBody));
    await lookupCompanyByTaxId(CNPJ_OK, null, { comQsa: true });

    const { data } = await supabaseAdmin
      .from("integration_lookups")
      .select("referencia, kind, status")
      .order("created_at", { ascending: false })
      .limit(50);
    const linhas = data ?? [];
    expect(linhas.length).toBeGreaterThan(0);
    for (const l of linhas) {
      expect(l.referencia ?? "").not.toContain(CEP_OK);
      expect(l.referencia ?? "").not.toContain(CNPJ_OK);
      if (l.referencia) expect(l.referencia).toMatch(/^[0-9a-f]{10}:.{0,2}$/);
    }
  });

  it("nenhum CPF, telefone, e-mail ou PIX é escrito na auditoria de integrações", async () => {
    const { data } = await supabaseAdmin
      .from("integration_lookups")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    const bruto = JSON.stringify(data ?? []);
    expect(bruto).not.toMatch(/\b\d{11}\b/); // CPF/telefone completo
    expect(bruto).not.toMatch(/@/); // e-mail
    expect(bruto).not.toContain("qsa");
    expect(bruto).not.toContain("payload");
  });

  it("o cache guarda payload mapeado, sem quadro societário cru nem campos desconhecidos", async () => {
    instalarTransporte(() => json({ ...brasilApiCnpjBody, campo_desconhecido: "LIXO" }));
    await lookupCompanyByTaxId(CNPJ_OK, null, { comQsa: true });
    const { data } = await supabaseAdmin
      .from("integration_cache")
      .select("payload, response_hash")
      .eq("provider", "brasilapi_cnpj")
      .eq("chave", CNPJ_OK)
      .maybeSingle();
    expect(data).toBeTruthy();
    const bruto = JSON.stringify(data?.payload);
    expect(bruto).not.toContain("LIXO");
    expect(bruto).not.toContain("qsa");
    expect(data?.response_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("integration_cache e integration_lookups não são legíveis pelo aplicativo", async () => {
    const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!;
    const anon =
      process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]!;
    for (const tabela of ["integration_cache", "integration_lookups"]) {
      const res = await fetch(`${url}/rest/v1/${tabela}?select=*&limit=1`, {
        headers: { apikey: anon },
      });
      const corpo = await res.text();
      expect(res.ok && corpo !== "[]" ? "vazou" : "bloqueado").toBe("bloqueado");
    }
  });
});
