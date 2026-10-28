export interface PixPedido { account_id: string; qr_id: string; chave: string; payload: string; atualizado_em: string }
export function camposPix(payload: string): Record<string, string> {
  const campos: Record<string, string> = {};
  for (let pos = 0; pos < payload.length;) {
    const id = payload.slice(pos, pos + 2), tamanho = payload.slice(pos + 2, pos + 4);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(tamanho)) throw new Error("Formato Pix inválido.");
    const fim = pos + 4 + Number(tamanho);
    if (fim > payload.length) throw new Error("Pix incompleto.");
    campos[id] = payload.slice(pos + 4, fim); pos = fim;
  }
  return campos;
}
export function validarPixGlobal(payload: string, chave: string) {
  const c = camposPix(payload);
  if (c["00"] !== "01" || c["53"] !== "986" || c["58"] !== "BR" || c["54"] != null) throw new Error("Pix deve ser brasileiro e sem valor fixo.");
  const conta = camposPix(c["26"] ?? "");
  if (conta["00"]?.toLowerCase() !== "br.gov.bcb.pix" || conta["01"] !== chave) throw new Error("Pix não corresponde à chave oficial.");
  if (!/6304[0-9A-F]{4}$/i.test(payload)) throw new Error("Verificação Pix ausente.");
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(payload.slice(0, -4))) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
  }
  if (crc.toString(16).padStart(4, "0").toUpperCase() !== payload.slice(-4).toUpperCase()) throw new Error("Verificação Pix inválida.");
  return { favorecido: c["59"] ?? "", cidade: c["60"] ?? "" };
}