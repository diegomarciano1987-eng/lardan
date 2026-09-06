import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * As baterias de homologação compartilham as mesmas contas e o mesmo prefixo
 * sintético no banco real. Rodar arquivos em paralelo faria uma bateria apagar
 * os dados da outra, então a execução é sempre sequencial.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
