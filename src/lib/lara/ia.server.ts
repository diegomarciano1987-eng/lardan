/**
 * 0402 — IA só para ENTENDER a resposta da candidata quando a regra não entendeu.
 * Ela nunca escreve respostas para a candidata. O texto enviado é só a mensagem
 * recebida, sem nome, CPF ou telefone; qualquer falha passa a conversa para uma pessoa.
 */
import { generateResponse } from "@lovable.dev/ai-gateway";
import { z } from "zod";
import type { Leitura } from "./roteiro";

const LeituraIa = z.object({
  intencao: z.enum(["sim", "nao", "pensar", "nenhuma"]),
  duvida: z.boolean(),
  robo: z.boolean(),
  humano: z.boolean(),
  sair: z.boolean(),
  revisao: z.boolean(),
  como_conheceu: z.enum(["indicacao", "instagram", "google", "outro", "nenhum"]),
});

export async function lerComIa(texto: string, etapa: string): Promise<Partial<Leitura> | null> {
  if (!texto.trim()) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const resposta = await generateResponse({
      model: "openai/gpt-6-astra",
      reasoning: { effort: "low" },
      instructions:
        "Você classifica UMA mensagem de WhatsApp de uma candidata a revendedora de semijoias (venda consignada). " +
        `Contexto da conversa: ${etapa}. Responda só com o JSON pedido. ` +
        "intencao: 'sim' se ela confirma interesse/concorda, 'nao' se recusa, 'pensar' se vai pensar/adiar, 'nenhuma' se não dá para saber. " +
        "duvida: true se ela faz uma pergunta. robo: true se pergunta se fala com robô/IA. humano: true se pede uma pessoa. " +
        "sair: true se pede para parar de receber mensagens. revisao: true se pede para rever uma recusa. " +
        "como_conheceu: indicacao, instagram, google, outro ou nenhum.",
      input: texto.slice(0, 600),
      text: {
        format: {
          type: "json_schema",
          name: "leitura",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["intencao", "duvida", "robo", "humano", "sair", "revisao", "como_conheceu"],
            properties: {
              intencao: { type: "string", enum: ["sim", "nao", "pensar", "nenhuma"] },
              duvida: { type: "boolean" },
              robo: { type: "boolean" },
              humano: { type: "boolean" },
              sair: { type: "boolean" },
              revisao: { type: "boolean" },
              como_conheceu: { type: "string", enum: ["indicacao", "instagram", "google", "outro", "nenhum"] },
            },
          },
        },
      },
    }, { signal: ctrl.signal });
    const saida = resposta.output.map((item) => item.type === "message"
      ? item.content.map((conteudo) => conteudo.type === "output_text" ? conteudo.text : "").join("")
      : "").join("");
    const j = LeituraIa.parse(JSON.parse(saida));
    return {
      intencao: j.intencao === "nenhuma" ? null : j.intencao,
      duvida: j.duvida,
      robo: j.robo,
      humano: j.humano,
      sair: j.sair,
      revisao: j.revisao,
      comoConheceu: j.como_conheceu === "nenhum" ? null : j.como_conheceu,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
