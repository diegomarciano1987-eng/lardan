/**
 * 18/11/2026 (Diego): antes de gerar acordo/cobrança, mostrar na tela se o Asaas vai conseguir avisar a cliente
 * (e-mail, SMS, WhatsApp) e o que falta. Regras puras, sem rede — a leitura do Asaas é feita no servidor.
 */
import { cpfValido } from "../br/canonico";
import { celularAsaas, normalizar, telefoneTorto, valido } from "./cliente-espelho";

export type StatusItem = "ok" | "falta" | "atencao";
export type Canal = "email" | "sms" | "whatsapp";
export interface ItemProntidao {
  chave: string;
  status: StatusItem;
  titulo: string;
  detalhe: string;
  /** quem resolve: "lardan" = completar cadastro; "asaas" = botão "Corrigir no Asaas" */
  resolve?: "lardan" | "asaas";
}
export interface ContatoLardan {
  nome: string | null;
  doc: string | null;
  emails: string[];
  telefones: { kind: string; valor: string }[];
}
export interface ClienteAsaasLido {
  external_id: string;
  /** null = não encontrado no Asaas (excluído) */
  dados: { email?: string | null; mobilePhone?: string | null; deleted?: boolean | null; notificationDisabled?: boolean | null } | null;
  avisos: Array<Record<string, unknown>> | null;
  erro?: string | null;
}
export interface Prontidao {
  pronto: boolean;
  canais: Record<Canal, boolean>;
  email: string | null;
  celular: string | null;
  itens: ItemProntidao[];
  faltas: string[];
}

export const ROTULO_CANAL: Record<Canal, string> = { email: "E-mail", sms: "SMS", whatsapp: "WhatsApp" };

const fone = (d: string) => (d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d);

/** Primeiro e-mail válido e primeiro celular aceito pelo Asaas (WhatsApp antes de telefone). */
export function escolherContato(l: ContatoLardan) {
  const email = l.emails.map((e) => e.trim().toLowerCase()).find((e) => valido("email", e)) ?? null;
  const ordenados = [...l.telefones].sort((a, b) => Number(b.kind === "whatsapp") - Number(a.kind === "whatsapp"));
  const celular = ordenados.map((t) => celularAsaas(t.valor)).find(Boolean) ?? null;
  return { email, celular };
}

const ativos = (avisos: Array<Record<string, unknown>>) => avisos.filter((n) => n["id"] && n["deleted"] !== true);

export function avaliarProntidao(l: ContatoLardan, clientes: ClienteAsaasLido[], conta: { conectada: boolean; motivo?: string | null } = { conectada: true }, totalCadastros = clientes.length): Prontidao {
  const itens: ItemProntidao[] = [];
  const { email, celular } = escolherContato(l);
  const doc = (l.doc ?? "").replace(/\D/g, "");

  // ---- Lardan
  if (doc.length === 14 || cpfValido(doc)) itens.push({ chave: "cpf", status: "ok", titulo: "CPF", detalhe: "CPF válido no cadastro." });
  else itens.push({ chave: "cpf", status: "falta", resolve: "lardan", titulo: "CPF", detalhe: doc ? `CPF inválido (${doc}). O Asaas recusa boleto sem CPF válido.` : "Sem CPF no cadastro. O Asaas recusa boleto sem CPF." });

  if (email) itens.push({ chave: "email", status: "ok", titulo: "E-mail", detalhe: email });
  else {
    const ruim = l.emails.find((e) => e.trim());
    itens.push({ chave: "email", status: "falta", resolve: "lardan", titulo: "E-mail", detalhe: ruim ? `E-mail inválido (“${ruim.trim()}”): a fatura NÃO vai por e-mail.` : "Sem e-mail no cadastro: a fatura NÃO vai por e-mail." });
  }

  if (celular) itens.push({ chave: "celular", status: "ok", titulo: "Celular (SMS e WhatsApp)", detalhe: fone(celular) });
  else {
    const ruim = l.telefones.map((t) => normalizar("mobilePhone", t.valor)).find(Boolean);
    // número antigo de 8 dígitos (sem o 9): só sugere, nunca troca sozinho
    const antigo = ruim && /^\d{2}[6-9]\d{7}$/.test(ruim) ? ` Parece número antigo sem o 9 — confirme com ela se é ${fone(ruim.slice(0, 2) + "9" + ruim.slice(2))}.` : "";
    itens.push({
      chave: "celular", status: "falta", resolve: "lardan", titulo: "Celular (SMS e WhatsApp)",
      detalhe: ruim ? `O número ${fone(ruim)} não é celular válido (precisa DDD + 9 + 8 dígitos): SMS e WhatsApp NÃO chegam.${antigo}` : "Sem celular no cadastro: SMS e WhatsApp NÃO chegam.",
    });
  }

  // ---- Asaas
  const canais: Record<Canal, boolean> = { email: !!email, sms: !!celular, whatsapp: !!celular };
  let emailSoAsaas: string | null = null;
  if (!conta.conectada) {
    itens.push({ chave: "conta", status: "falta", titulo: "Conta Asaas", detalhe: conta.motivo || "A conta Asaas não está conectada agora: nada foi conferido lá." });
    canais.email = canais.sms = canais.whatsapp = false;
  } else if (!clientes.length) {
    itens.push({ chave: "cadastro_asaas", status: "atencao", titulo: "Cadastro no Asaas", detalhe: "Ainda não tem cadastro no Asaas. Ele é criado ao gerar as cobranças, já com o e-mail, o celular e os avisos ligados." });
  } else {
    if (totalCadastros > 1) itens.push({ chave: "varios", status: "atencao", titulo: "Cadastros no Asaas",
      detalhe: totalCadastros > clientes.length ? `${totalCadastros} cadastros desta cliente no Asaas (duplicados). Conferidos o principal e os ${clientes.length - 1} mais recentes.` : `${totalCadastros} cadastros desta cliente no Asaas. Todos foram conferidos.` });
    for (const [k, c] of clientes.entries()) {
      const suf = clientes.length > 1 ? ` (${k + 1}º cadastro)` : "";
      if (c.erro) { itens.push({ chave: `erro_${k}`, status: "falta", titulo: `Asaas${suf}`, detalhe: `O Asaas não respondeu: ${c.erro}` }); canais.email = canais.sms = canais.whatsapp = false; continue; }
      if (!c.dados || c.dados.deleted) { itens.push({ chave: `excluido_${k}`, status: "falta", titulo: `Cadastro no Asaas${suf}`, detalhe: "O cadastro dela foi excluído no Asaas. Avise o financeiro antes de gerar." }); canais.email = canais.sms = canais.whatsapp = false; continue; }
      if (c.dados.notificationDisabled) {
        itens.push({ chave: `desligado_${k}`, status: "falta", resolve: "asaas", titulo: `Avisos no Asaas${suf}`, detalhe: "Os avisos estão DESLIGADOS no cadastro dela no Asaas: nenhuma mensagem sai." });
        canais.email = canais.sms = canais.whatsapp = false;
      }
      const ea = c.dados.email ?? null;
      if (email && normalizar("email", ea) !== normalizar("email", email)) {
        itens.push({ chave: `email_asaas_${k}`, status: "falta", resolve: "asaas", titulo: `E-mail no Asaas${suf}`, detalhe: ea ? `No Asaas está “${ea}”, diferente do Lardan.` : "O Asaas está sem o e-mail dela." });
        canais.email = false;
      } else if (!email && ea && valido("email", ea) && !c.dados.notificationDisabled) {
        emailSoAsaas = emailSoAsaas ?? ea;
        canais.email = true;
      }
      const ma = c.dados.mobilePhone ?? null;
      if (celular && (normalizar("mobilePhone", ma) !== celular || telefoneTorto("mobilePhone", ma))) {
        itens.push({ chave: `cel_asaas_${k}`, status: "falta", resolve: "asaas", titulo: `Celular no Asaas${suf}`,
          detalhe: !ma ? "O Asaas está sem o celular dela." : telefoneTorto("mobilePhone", ma) ? `No Asaas está ${ma} (com 55 na frente): SMS e WhatsApp falham.` : `No Asaas está ${ma}, diferente do Lardan.` });
        canais.sms = canais.whatsapp = false;
      }
      if (c.avisos) {
        const lista = ativos(c.avisos);
        const total = lista.length;
        // só conta canal que o Asaas oferece naquele aviso (ex.: SEND_LINHA_DIGITAVEL não tem WhatsApp → null, não é "desligado")
        const off = (campo: string) => lista.filter((n) => n[campo] === false).length;
        const desligados = lista.filter((n) => n["enabled"] === false).length;
        if (desligados) itens.push({ chave: `eventos_${k}`, status: "falta", resolve: "asaas", titulo: `Avisos no Asaas${suf}`, detalhe: `${desligados} de ${total} avisos (ex.: vencimento, atraso) estão desligados no Asaas.` });
        if (email && off("emailEnabledForCustomer")) { itens.push({ chave: `canal_email_${k}`, status: "falta", resolve: "asaas", titulo: `Canal e-mail${suf}`, detalhe: `E-mail desligado em ${off("emailEnabledForCustomer")} de ${total} avisos no Asaas.` }); canais.email = false; }
        if (celular && off("smsEnabledForCustomer")) { itens.push({ chave: `canal_sms_${k}`, status: "falta", resolve: "asaas", titulo: `Canal SMS${suf}`, detalhe: `SMS desligado em ${off("smsEnabledForCustomer")} de ${total} avisos no Asaas.` }); canais.sms = false; }
        const temWhats = lista.some((n) => typeof n["whatsappEnabledForCustomer"] === "boolean");
        if (celular && total && !temWhats) { itens.push({ chave: `canal_whats_${k}`, status: "atencao", titulo: `Canal WhatsApp${suf}`, detalhe: "O Asaas não oferece WhatsApp nos avisos desta cliente (depende do plano da conta Asaas)." }); canais.whatsapp = false; }
        else if (celular && off("whatsappEnabledForCustomer")) { itens.push({ chave: `canal_whats_${k}`, status: "falta", resolve: "asaas", titulo: `Canal WhatsApp${suf}`, detalhe: `WhatsApp desligado em ${off("whatsappEnabledForCustomer")} de ${total} avisos no Asaas.` }); canais.whatsapp = false; }
      }
    }
    if (!itens.some((i) => i.chave.startsWith("cel_asaas") || i.chave.startsWith("email_asaas") || i.chave.startsWith("canal_") || i.chave.startsWith("desligado") || i.chave.startsWith("eventos") || i.chave.startsWith("excluido") || i.chave.startsWith("erro")))
      itens.push({ chave: "asaas_ok", status: "ok", titulo: "Cadastro no Asaas", detalhe: "Conferido agora no Asaas: cadastro ativo e avisos ligados lá." });
  }

  if (emailSoAsaas && canais.email) {
    const it = itens.find((i) => i.chave === "email");
    if (it) { it.status = "atencao"; it.detalhe = `Sem e-mail no Lardan, mas o Asaas tem “${emailSoAsaas}” e a fatura vai para lá. Confirme com ela e cadastre no Lardan.`; }
  }
  const itensFinais = juntarRepetidos(itens);
  const faltas = (Object.keys(canais) as Canal[]).filter((c) => !canais[c]).map((c) => ROTULO_CANAL[c]);
  return { pronto: !itensFinais.some((i) => i.status === "falta"), canais, email, celular, itens: itensFinais, faltas };
}

/** Frase curta para confirmação antes de gerar cobranças. */
export function fraseFaltas(p: Prontidao): string {
  if (!p.faltas.length) return "";
  const motivos = p.itens.filter((i) => i.status === "falta").map((i) => `• ${i.titulo}: ${i.detalhe}`).join("\n");
  return `A cliente NÃO vai receber o aviso por: ${p.faltas.join(", ")}.\n\n${motivos}`;
}

/** Cliente com vários cadastros no Asaas: a mesma falha em cada um vira uma linha só ("em 5 cadastros"). */
function juntarRepetidos(itens: ItemProntidao[]): ItemProntidao[] {
  const out: ItemProntidao[] = [];
  const vistos = new Map<string, { item: ItemProntidao; n: number }>();
  for (const i of itens) {
    const base = i.chave.replace(/_\d+$/, "");
    const titulo = i.titulo.replace(/ \(\d+º cadastro\)$/, "");
    const k = `${base}|${i.detalhe}`;
    const v = vistos.get(k);
    if (v) { v.n++; v.item.titulo = `${titulo} (em ${v.n} cadastros)`; continue; }
    const novo = { ...i, chave: base === i.chave ? i.chave : `${base}_${out.length}`, titulo };
    vistos.set(k, { item: novo, n: 1 });
    out.push(novo);
  }
  return out;
}
