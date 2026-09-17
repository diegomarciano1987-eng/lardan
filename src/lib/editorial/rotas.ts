/** Caminhos públicos dos guias editoriais (fonte única, sem depender do conteúdo). */
export const CAMINHOS_EDITORIAIS = [
  "/renda-extra-com-vendas",
  "/como-comecar-a-vender-semijoias",
  "/semijoias-consignadas-para-revenda",
  "/como-vender-semijoias-pelo-whatsapp",
] as const;

export type CaminhoEditorial = (typeof CAMINHOS_EDITORIAIS)[number];
