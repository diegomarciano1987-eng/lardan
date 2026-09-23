/** Imprime a chave anônima local (JWT assinado com o segredo LOCAL do isolado). */
import { createHmac } from "node:crypto";
const SEGREDO = "lardan-isolado-segredo-local-nao-e-credencial-0001";
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const tipo = process.argv[2] ?? "anon";
const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const p = b64(JSON.stringify({ role: tipo, iss: "lardan-isolado", iat: 1700000000, exp: 2000000000 }));
const s = createHmac("sha256", SEGREDO).update(`${h}.${p}`).digest("base64url");
console.log(`${h}.${p}.${s}`);
