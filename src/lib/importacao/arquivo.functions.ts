/**
 * Identidade canônica do arquivo recebido.
 *
 * A impressão digital (SHA-256), o tamanho, a contagem de linhas e a estrutura
 * de cabeçalhos são calculados NO SERVIDOR. O navegador não escolhe a
 * identidade do arquivo — ele apenas entrega o conteúdo.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LIMITES, PARSER_VERSION, lerPlanilha } from "./parser";

export interface ArquivoRegistrado {
  id: string;
  novo: boolean;
  sha256: string;
  linhas: number;
  colunas: number;
  cabecalhos: string[];
  avisos: string[];
}

const entrada = z.object({
  nome: z.string().min(1).max(300),
  tipo: z.string().max(200).default(""),
  conteudo: z.string().min(8),
});

export const registrarArquivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => entrada.parse(data))
  .handler(async ({ data, context }): Promise<ArquivoRegistrado> => {
    const bytes = Buffer.from(data.conteudo, "base64");
    if (bytes.byteLength === 0) throw new Error("Arquivo vazio.");
    if (bytes.byteLength > LIMITES.bytes) {
      throw new Error(`Arquivo grande demais. O limite é ${LIMITES.bytes / 1048576} MB.`);
    }
    const extensao = data.nome.toLowerCase().split(".").pop() ?? "";
    if (!["xlsx", "xls", "csv"].includes(extensao)) {
      throw new Error("Formato não aceito. Envie .xlsx, .xls ou .csv.");
    }

    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update(bytes).digest("hex");

    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const lida = await lerPlanilha(ab);
    if (lida.linhas.length === 0) throw new Error("Não encontrei nenhuma linha preenchida nesta planilha.");

    const { data: reg, error } = await context.supabase.rpc("import_file_register", {
      _sha: sha,
      _file_name: data.nome,
      _byte_size: bytes.byteLength,
      _content_type: data.tipo || null,
      _headers: lida.cabecalhos,
      _row_count: lida.linhas.length,
      _column_count: lida.cabecalhos.length,
      _parser: PARSER_VERSION,
    } as never);
    if (error) throw new Error(error.message);
    const r = reg as { id: string; novo: boolean; sha256: string };

    return {
      id: r.id,
      novo: r.novo,
      sha256: r.sha256,
      linhas: lida.linhas.length,
      colunas: lida.cabecalhos.length,
      cabecalhos: lida.cabecalhos,
      avisos: lida.avisos,
    };
  });
