/**
 * LARDAN — dossiê da candidatura em PDF para envio ao representante.
 *
 * O PDF é montado no servidor a partir da mesma leitura oficial do cockpit
 * (`crm_detail`), de modo que a permissão de quem gera vale para o documento:
 * quem não pode ver o CPF completo gera um PDF com o CPF mascarado.
 *
 * Não existe integração com o WhatsApp. O servidor devolve apenas um link
 * temporário do arquivo; abrir a conversa é um atalho do navegador.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LOGO_LARDAN_PNG_BASE64 } from "./dossie-logo";

export interface RepresentanteOpcao {
  id: string;
  nome: string;
  whatsapp: string;
}

export const listarRepresentantes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("crm_representantes");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as RepresentanteOpcao[];
  });

/* ------------------------------------------------------------ desenho -- */

const MARGEM = 48;
const LARGURA = 595.28;
const ALTURA = 841.89;

const VAZIO = "Não informado";

/** Helvetica usa WinAnsi: acentos passam, símbolos exóticos não. */
function limpar(valor: string): string {
  return valor
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2022\u00b7]/g, "-")
    .replace(/[^\u0020-\u00FF\n]/g, "");
}

function telefoneBonito(digitos: string): string {
  const d = digitos.replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digitos;
}

function cepBonito(valor: string | null | undefined): string {
  const d = (valor ?? "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (valor ?? "");
}

/** "nao_identificado" vira "Nao identificado"; canais conhecidos ficam legíveis. */
function rotuloOrigem(valor: string | null | undefined): string {
  const v = (valor ?? "").trim();
  if (!v) return "";
  const texto = v.replace(/[_-]+/g, " ").trim().replace(/^nao /i, "Não ");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function dataBonita(iso: string | null | undefined): string {
  if (!iso) return VAZIO;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return VAZIO;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(d);
}

const Entrada = z.object({
  leadId: z.string().uuid(),
  representanteId: z.string().uuid().optional(),
  representanteNome: z.string().trim().max(160).optional(),
});

export const gerarDossieCandidatura = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Entrada.parse(data))
  .handler(async ({ data, context }) => {
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

    const { data: detalhe, error } = await context.supabase.rpc("crm_detail", {
      _lead: data.leadId,
    });
    if (error) throw new Error(error.message);
    const d = detalhe as unknown as {
      candidatura: Record<string, unknown>;
      origem: Record<string, unknown>;
      notas: { texto: string; em: string; autor: string | null }[];
    } | null;
    if (!d?.candidatura) throw new Error("Candidatura não encontrada.");
    const c = d.candidatura as Record<string, string | null | boolean | number>;

    /* ---------------------------------------------------------- documento */
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
    const logo = await pdf.embedPng(
      Uint8Array.from(atob(LOGO_LARDAN_PNG_BASE64), (ch) => ch.charCodeAt(0)),
    );

    const bronze = rgb(0.486, 0.333, 0.251);
    const tinta = rgb(0.129, 0.114, 0.102);
    const suave = rgb(0.42, 0.39, 0.36);
    const linhaCor = rgb(0.85, 0.82, 0.78);
    const marfim = rgb(0.984, 0.969, 0.945);

    let pagina = pdf.addPage([LARGURA, ALTURA]);
    let y = 0;

    const novaPagina = (primeira: boolean) => {
      if (!primeira) pagina = pdf.addPage([LARGURA, ALTURA]);
      pagina.drawRectangle({ x: 0, y: ALTURA - 132, width: LARGURA, height: 132, color: marfim });
      const escala = 150 / logo.width;
      pagina.drawImage(logo, {
        x: MARGEM,
        y: ALTURA - 78,
        width: 150,
        height: logo.height * escala,
      });
      pagina.drawText("CANDIDATURA", {
        x: MARGEM,
        y: ALTURA - 104,
        size: 11,
        font: negrito,
        color: bronze,
      });
      const selo = "Documento interno";
      pagina.drawText(selo, {
        x: LARGURA - MARGEM - regular.widthOfTextAtSize(selo, 9),
        y: ALTURA - 104,
        size: 9,
        font: regular,
        color: suave,
      });
      pagina.drawRectangle({ x: 0, y: ALTURA - 134, width: LARGURA, height: 2, color: bronze });
      y = ALTURA - 172;
    };

    const espaco = (necessario: number) => {
      if (y - necessario < 70) novaPagina(false);
    };

    const quebrar = (texto: string, tamanho: number, largura: number) => {
      const linhas: string[] = [];
      for (const paragrafo of texto.split("\n")) {
        let atual = "";
        for (const palavra of paragrafo.split(/\s+/).filter(Boolean)) {
          const teste = atual ? `${atual} ${palavra}` : palavra;
          if (regular.widthOfTextAtSize(teste, tamanho) > largura && atual) {
            linhas.push(atual);
            atual = palavra;
          } else {
            atual = teste;
          }
        }
        linhas.push(atual);
      }
      return linhas;
    };

    const titulo = (texto: string) => {
      espaco(140);
      y -= 18; // respiro antes de cada bloco
      pagina.drawText(limpar(texto.toUpperCase()), {
        x: MARGEM,
        y,
        size: 9.5,
        font: negrito,
        color: bronze,
      });
      pagina.drawRectangle({
        x: MARGEM,
        y: y - 8,
        width: LARGURA - MARGEM * 2,
        height: 0.8,
        color: linhaCor,
      });
      y -= 26;
    };

    const campo = (rotulo: string, valor: string | null | undefined) => {
      const v = limpar((valor ?? "").toString().trim() || VAZIO);
      const largura = LARGURA - MARGEM * 2 - 132;
      const linhas = quebrar(v, 10.5, largura);
      espaco(18 + (linhas.length - 1) * 14);
      pagina.drawText(limpar(rotulo), { x: MARGEM, y, size: 9, font: regular, color: suave });
      linhas.forEach((linha, i) => {
        pagina.drawText(linha, {
          x: MARGEM + 132,
          y: y - i * 14,
          size: 10.5,
          font: i === 0 ? negrito : regular,
          color: tinta,
        });
      });
      y -= 18 + (linhas.length - 1) * 14;
    };

    const paragrafo = (texto: string) => {
      const linhas = quebrar(limpar(texto), 10.5, LARGURA - MARGEM * 2);
      for (const linha of linhas) {
        espaco(16);
        pagina.drawText(linha, { x: MARGEM, y, size: 10.5, font: regular, color: tinta });
        y -= 15;
      }
      y -= 6;
    };

    novaPagina(true);

    const nome = `${c["nome_proprio"] ?? ""} ${c["sobrenome"] ?? ""}`.trim() || String(c["nome"] ?? "");
    pagina.drawText(limpar(nome), { x: MARGEM, y, size: 22, font: negrito, color: tinta });
    y -= 22;
    pagina.drawText(
      limpar(`${c["cidade"] ?? ""}/${c["uf"] ?? ""}  ·  protocolo ${c["protocolo"] ?? ""}`),
      { x: MARGEM, y, size: 10.5, font: regular, color: suave },
    );
    y -= 34;

    if (data.representanteNome) {
      pagina.drawRectangle({
        x: MARGEM,
        y: y - 8,
        width: LARGURA - MARGEM * 2,
        height: 30,
        color: marfim,
      });
      pagina.drawText(limpar(`Enviado para o representante: ${data.representanteNome}`), {
        x: MARGEM + 12,
        y: y + 2,
        size: 10,
        font: negrito,
        color: bronze,
      });
      y -= 42;
    }

    titulo("Identificação");
    if (c["nome_proprio"] || c["sobrenome"]) {
      campo("Nome", c["nome_proprio"] as string);
      campo("Sobrenome", c["sobrenome"] as string);
    } else {
      // Candidaturas anteriores ao campo separado guardam só o nome completo.
      campo("Nome completo", c["nome"] as string);
    }
    campo(c["cpf_visivel"] ? "CPF" : "CPF (mascarado)", c["cpf"] as string);
    campo("WhatsApp", telefoneBonito(String(c["whatsapp"] ?? "")));
    campo("E-mail", c["email"] as string);

    titulo("Endereço");
    const rua = [c["rua"], c["sem_numero"] ? "s/n" : c["numero"]].filter(Boolean).join(", ");
    campo("Logradouro", rua);
    campo("Cidade / UF", `${c["cidade"] ?? ""}/${c["uf"] ?? ""}`);
    campo("CEP", cepBonito(c["cep"] as string));

    titulo("Perfil da candidata");
    campo("Objetivo", c["objetivo"] as string);
    campo("Disponibilidade", c["disponibilidade"] as string);
    campo("Experiência", c["experiencia"] as string);
    campo("Canais", c["canais"] as string);

    const motivacao = (c["motivacao"] as string | null)?.trim();
    if (motivacao) {
      titulo("Motivação (palavras da candidata)");
      paragrafo(motivacao);
    }

    titulo("Candidatura");
    campo("Protocolo", c["protocolo"] as string);
    campo("Recebida em", dataBonita(c["criada_em"] as string));
    campo("Origem", rotuloOrigem((d.origem?.["normalizada"] as string) ?? (c["origem"] as string)));
    campo("Prioridade", rotuloOrigem(c["prioridade"] as string));
    campo("Responsável", c["responsavel"] as string);
    campo("Último contato", dataBonita(c["ultimo_contato"] as string));
    campo("Reenvios", String(c["reenvios"] ?? 0));

    const notas = (d.notas ?? []).slice(0, 5);
    if (notas.length > 0) {
      titulo("Notas internas");
      for (const n of notas) {
        paragrafo(`${dataBonita(n.em)}${n.autor ? ` — ${n.autor}` : ""}\n${n.texto}`);
      }
    }

    espaco(60);
    y -= 10;
    pagina.drawRectangle({
      x: MARGEM,
      y: y + 12,
      width: LARGURA - MARGEM * 2,
      height: 0.8,
      color: linhaCor,
    });
    const rodape = limpar(
      `Lardan Semijoias · documento interno gerado em ${dataBonita(new Date().toISOString())} · uso restrito, contém dados pessoais`,
    );
    pagina.drawText(rodape, { x: MARGEM, y: y - 4, size: 8, font: regular, color: suave });

    /* ------------------------------------------------------------ arquivo */
    const bytes = await pdf.save();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const caminho = `dossies/${data.leadId}/${Date.now()}-candidatura.pdf`;
    const { error: erroUpload } = await supabaseAdmin.storage
      .from("candidaturas")
      .upload(caminho, bytes, { contentType: "application/pdf", upsert: true });
    if (erroUpload) throw new Error(erroUpload.message);

    const validade = 60 * 60 * 24 * 30;
    const { data: assinado, error: erroLink } = await supabaseAdmin.storage
      .from("candidaturas")
      .createSignedUrl(caminho, validade);
    if (erroLink || !assinado?.signedUrl) throw new Error(erroLink?.message ?? "link indisponível");

    // Registro na linha do tempo: nunca derruba a geração se falhar.
    try {
      await context.supabase.rpc("crm_log", {
        _lead: data.leadId,
        _kind: "dossie_representante",
        _title: data.representanteNome
          ? `Dossiê enviado para ${data.representanteNome}`
          : "Dossiê em PDF gerado",
        _note: `arquivo ${caminho}`,
        _meta: { representante_id: data.representanteId ?? null, arquivo: caminho },
      });
    } catch {
      /* sem registro na timeline, o documento continua válido */
    }

    return {
      url: assinado.signedUrl,
      nome,
      protocolo: String(c["protocolo"] ?? ""),
      cidade: String(c["cidade"] ?? ""),
      uf: String(c["uf"] ?? ""),
      whatsapp: telefoneBonito(String(c["whatsapp"] ?? "")),
      expiraEm: new Date(Date.now() + validade * 1000).toISOString(),
    };
  });
