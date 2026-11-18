// Copies Zama's browser SDK (JS + wasm) out of node_modules into /public so the app
// serves it from its own origin. Runs automatically on install, dev and build.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "node_modules", "@zama-fhe", "relayer-sdk", "bundle");
const pub = join(root, "public");

if (!existsSync(bundle)) {
  console.warn("[copy-sdk] Zama SDK bundle not found yet; skipping (run npm install first).");
  process.exit(0);
}

mkdirSync(join(pub, "relayer-sdk"), { recursive: true });
// .js (not .cjs) so every server sends a JavaScript MIME type.
cpSync(join(bundle, "relayer-sdk-js.umd.cjs"), join(pub, "relayer-sdk", "relayer-sdk-js.umd.js"));
// The SDK fetches its wasm files from the site root by default.
cpSync(join(bundle, "tfhe_bg.wasm"), join(pub, "tfhe_bg.wasm"));
cpSync(join(bundle, "kms_lib_bg.wasm"), join(pub, "kms_lib_bg.wasm"));
console.log("[copy-sdk] Zama SDK copied to /public");
