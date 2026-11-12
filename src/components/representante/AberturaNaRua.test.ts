// 0300: o rascunho da "Nova candidata" não pode se perder (Diego, 12/11/2026).
import { beforeEach, describe, expect, it } from "vitest";
import { apagarRascunho, chaveCandidata, gravarRascunho, lerRascunho, rascunhoTemConteudo, type Rascunho } from "./AberturaNaRua";

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
  };
});
const base = (over: Partial<Rascunho> = {}): Rascunho => ({
  v: 1, rep: "rep-1", chave: "43999990000", passo: 3,
  f: { nome: "Maria da Silva", cpf: "529.982.247-25", nascimento: "01/01/1990", rg: "", rg_orgao: "", estado_civil: "Casada", whatsapp: "(43) 99999-0000", email: "m@x.com", cep: "86000-000", rua: "Rua A", numero: "10", complemento: "", bairro: "Centro", cidade: "Londrina", uf: "PR", ibge: "" },
  perfil: { metas: 3, comunicacao: 3, organizacao: 2, pontualidade: 3 },
  feito: { lead_id: "l1", party_id: "p1", perfil: "Forte" }, maleta: { cycle_id: "c1", nome: "MAL-1" }, salvo_em: Date.now(), ...over,
});

describe("rascunho da abertura na rua", () => {
  it("guarda e devolve tudo, inclusive a etapa da assinatura", () => {
    gravarRascunho(base());
    const r = lerRascunho("rep-1")!;
    expect(r.passo).toBe(3);
    expect(r.f.cpf).toBe("529.982.247-25");
    expect(r.feito?.party_id).toBe("p1");
    expect(r.maleta?.cycle_id).toBe("c1");
  });
  it("vale por 24 horas e depois some", () => {
    gravarRascunho(base({ salvo_em: Date.now() - 25 * 60 * 60 * 1000 }));
    expect(lerRascunho("rep-1")).toBeNull();
    gravarRascunho(base({ salvo_em: Date.now() - 23 * 60 * 60 * 1000 }));
    expect(lerRascunho("rep-1")).not.toBeNull();
  });
  it("um representante não vê o rascunho do outro", () => {
    gravarRascunho(base());
    expect(lerRascunho("rep-2")).toBeNull();
  });
  it("descartar apaga", () => {
    gravarRascunho(base());
    apagarRascunho("rep-1");
    expect(lerRascunho("rep-1")).toBeNull();
  });
  it("tela recém-aberta sem nada digitado não vira rascunho", () => {
    const vazio = { ...base().f, nome: "", cpf: "", nascimento: "", estado_civil: "", whatsapp: "", email: "", cep: "", rua: "", numero: "", bairro: "", cidade: "", uf: "" };
    expect(rascunhoTemConteudo({ passo: 0, f: vazio, perfil: {}, feito: null }, vazio)).toBe(false);
    expect(rascunhoTemConteudo({ passo: 0, f: { ...vazio, cpf: "1" }, perfil: {}, feito: null }, vazio)).toBe(true);
  });
  it("cada candidata tem sua chave", () => {
    expect(chaveCandidata()).toBe("nova");
    expect(chaveCandidata({ nome: "Ana", whatsapp: "(43) 99999-0000" })).toBe("43999990000");
  });
});

import { linkSms } from "./AssinaturaDigital";
describe("SMS da assinatura (0300)", () => {
  it("abre o SMS com o número dela (+55) e o link", () => {
    const l = linkSms("(43) 99999-0000", "https://app.zapsign.com.br/verificar/abc", "contrato");
    expect(l.startsWith("sms:+5543999990000?&body=")).toBe(true);
    expect(decodeURIComponent(l)).toContain("https://app.zapsign.com.br/verificar/abc");
  });
  it("sem número abre o SMS para escolher o contato", () => {
    expect(linkSms(null, "https://x", "promissoria").startsWith("sms:?&body=")).toBe(true);
  });
});
