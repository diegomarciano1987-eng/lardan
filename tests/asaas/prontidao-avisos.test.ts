/** 18/11/2026 (Diego): antes do acordo a tela diz se o Asaas vai avisar a cliente e o que falta. */
import { describe, expect, test } from "bun:test";
import { avaliarProntidao, escolherContato, fraseFaltas } from "../../src/lib/asaas/prontidao-avisos";

const cpf = "52998224725"; // CPF válido de exemplo
const base = { nome: "Cliente", doc: cpf, emails: ["Maria@Email.com"], telefones: [{ kind: "whatsapp", valor: "(43) 99876-5432" }] };
const aviso = (o: Record<string, unknown> = {}) => ({ id: "n1", enabled: true, emailEnabledForCustomer: true, smsEnabledForCustomer: true, whatsappEnabledForCustomer: true, ...o });
const cliente = (dados: Record<string, unknown> = {}, avisos = [aviso()]) => ({ external_id: "cus_1", dados: { email: "maria@email.com", mobilePhone: "43998765432", notificationDisabled: false, ...dados }, avisos });

describe("prontidão dos avisos do Asaas", () => {
  test("tudo certo: e-mail, SMS e WhatsApp vão", () => {
    const r = avaliarProntidao(base, [cliente()]);
    expect(r.pronto).toBe(true);
    expect(r.canais).toEqual({ email: true, sms: true, whatsapp: true });
    expect(r.faltas).toEqual([]);
  });
  test("sem e-mail no Lardan: avisa que a fatura não vai por e-mail", () => {
    const r = avaliarProntidao({ ...base, emails: [] }, [cliente({ email: null })]);
    expect(r.pronto).toBe(false);
    expect(r.canais.email).toBe(false);
    expect(r.itens.find((i) => i.chave === "email")?.detalhe).toContain("NÃO vai por e-mail");
    expect(fraseFaltas(r)).toContain("E-mail");
  });
  test("telefone fixo não conta como celular: SMS e WhatsApp não chegam", () => {
    const r = avaliarProntidao({ ...base, telefones: [{ kind: "telefone", valor: "4333221100" }] }, []);
    expect(r.celular).toBeNull();
    expect(r.canais.sms).toBe(false);
    expect(r.canais.whatsapp).toBe(false);
    expect(r.itens.find((i) => i.chave === "celular")?.detalhe).toContain("não é celular válido");
  });
  test("celular com 55 no Asaas: pede correção no Asaas", () => {
    const r = avaliarProntidao(base, [cliente({ mobilePhone: "5543998765432" })]);
    const it = r.itens.find((i) => i.chave.startsWith("cel_asaas"));
    expect(it?.resolve).toBe("asaas");
    expect(r.canais.whatsapp).toBe(false);
  });
  test("WhatsApp desligado nos avisos do Asaas é apontado", () => {
    const r = avaliarProntidao(base, [cliente({}, [aviso({ whatsappEnabledForCustomer: false }), aviso({ id: "n2" })])]);
    expect(r.canais.whatsapp).toBe(false);
    expect(r.itens.find((i) => i.chave.startsWith("canal_whats"))?.detalhe).toContain("1 de 2");
  });
  test("avisos desligados no cadastro do Asaas: nenhum canal vai", () => {
    const r = avaliarProntidao(base, [cliente({ notificationDisabled: true })]);
    expect(r.canais).toEqual({ email: false, sms: false, whatsapp: false });
  });
  test("sem cadastro no Asaas ainda: não bloqueia (é criado com avisos ligados)", () => {
    const r = avaliarProntidao(base, []);
    expect(r.pronto).toBe(true);
    expect(r.itens.find((i) => i.chave === "cadastro_asaas")?.status).toBe("atencao");
  });
  test("escolhe celular válido mesmo quando o WhatsApp cadastrado está errado", () => {
    expect(escolherContato({ ...base, telefones: [{ kind: "whatsapp", valor: "4399" }, { kind: "telefone", valor: "43 99876-5432" }] }).celular).toBe("43998765432");
  });
  test("conta Asaas fora do ar: nada é dado como enviado", () => {
    const r = avaliarProntidao(base, [], { conectada: false });
    expect(r.pronto).toBe(false);
    expect(r.faltas).toEqual(["E-mail", "SMS", "WhatsApp"]);
  });
});
