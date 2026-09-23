/**
 * Configuração da SEGUNDA instância (porta 8090), ligada só ao ambiente isolado.
 * Não lê o .env do projeto: as variáveis vêm de LARDAN_ISO_ENVDIR, montado por
 * subir-app.sh com o gateway local. A pré-visualização (8080) não é tocada.
 */
import path from "node:path";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const raiz = path.resolve(import.meta.dirname, "../../..");

export default defineConfig({
  tanstackStart: { server: { entry: "server" } },
  vite: {
    root: raiz,
    envDir: process.env["LARDAN_ISO_ENVDIR"] ?? "/tmp/lardan-app-iso/env",
    cacheDir: "/tmp/lardan-app-iso/vite-cache",
    server: { port: 8090, strictPort: true, host: "127.0.0.1", hmr: false },
    resolve: {
      alias: {
        "entities/lib/decode.js": path.resolve(raiz, "node_modules/entities/lib/decode.js"),
        "entities/lib/encode.js": path.resolve(raiz, "node_modules/entities/lib/encode.js"),
        entities: path.resolve(raiz, "node_modules/entities"),
      },
    },
  },
});
