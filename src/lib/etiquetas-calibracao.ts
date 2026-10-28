import { supabase } from "@/integrations/supabase/client";
import { CALIBRACAO_KEY, completarConfig, lerCalibracao, validarCalibracao, type EtiquetaConfig } from "@/lib/etiquetas";

/** Calibração Argox única da empresa (vale para todas as colaboradoras); cópia local só como reserva sem internet. */
export async function lerCalibracaoGlobal(): Promise<Required<EtiquetaConfig>> {
  const { data, error } = await supabase.rpc("etiqueta_calibracao_ler" as never);
  if (error || !data) return lerCalibracao();
  const cfg = completarConfig(data as Partial<EtiquetaConfig>);
  try { localStorage.setItem(CALIBRACAO_KEY, JSON.stringify(cfg)); } catch { /* sem armazenamento */ }
  return cfg;
}

export async function salvarCalibracaoGlobal(c: EtiquetaConfig) {
  const erro = validarCalibracao(c); if (erro) throw new Error(erro);
  const cfg = completarConfig(c);
  const { error } = await supabase.rpc("etiqueta_calibracao_salvar" as never, { _cfg: cfg } as never);
  if (error) throw new Error(error.message);
  try { localStorage.setItem(CALIBRACAO_KEY, JSON.stringify(cfg)); } catch { /* sem armazenamento */ }
}
