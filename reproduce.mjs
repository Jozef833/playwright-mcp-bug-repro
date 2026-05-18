import { spawn } from "node:child_process";
import { mkdtempSync, chmodSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mcpBin = join(__dirname, "node_modules", ".bin", "playwright-mcp");

// Create a read-only directory to simulate an immutable browser installation path
// (e.g. Nix store, read-only Docker mount, shared filesystem)
const readonlyDir = mkdtempSync(join(tmpdir(), "pw-browsers-readonly-"));

function cleanup() {
  try { chmodSync(readonlyDir, 0o755); } catch {}
  try { rmSync(readonlyDir, { recursive: true }); } catch {}
}
process.on("exit", cleanup);

chmodSync(readonlyDir, 0o555);

console.log(`Created read-only directory: ${readonlyDir}`);
console.log(`Starting playwright-mcp with PLAYWRIGHT_BROWSERS_PATH=${readonlyDir}\n`);

const server = spawn(mcpBin, ["--headless", "--browser", "chromium"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: readonlyDir,
  },
});

let stderr = "";
server.stderr.on("data", (data) => (stderr += data.toString()));

// Collect stdout lines as newline-delimited JSON responses
const responses = [];
let stdoutBuf = "";
server.stdout.on("data", (data) => {
  stdoutBuf += data.toString();
  const lines = stdoutBuf.split("\n");
  stdoutBuf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try { responses.push(JSON.parse(line)); } catch {}
  }
});

function waitForResponse(id, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`Timed out waiting for response id=${id}`)), timeoutMs);
    const interval = setInterval(() => {
      const idx = responses.findIndex((r) => r.id === id);
      if (idx !== -1) {
        clearTimeout(deadline);
        clearInterval(interval);
        resolve(responses.splice(idx, 1)[0]);
      }
    }, 100);
  });
}

function send(obj) {
  server.stdin.write(JSON.stringify(obj) + "\n");
}

try {
  // Initialize
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "repro", version: "1.0.0" },
    },
  });

  const initResp = await waitForResponse(1);
  console.log("Initialized:", initResp.result?.serverInfo?.name, initResp.result?.serverInfo?.version);

  // Navigate — this triggers createUserDataDir
  send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "browser_navigate",
      arguments: { url: "https://example.com" },
    },
  });

  const navResp = await waitForResponse(2);
  const text = navResp.result?.content?.[0]?.text ?? "";

  console.log("\n=== Response ===");
  console.log(text);

  if (navResp.result?.isError && (text.includes("ENOENT") || text.includes("EACCES") || text.includes("EROFS"))) {
    console.log("\n[REPRODUCED] createUserDataDir failed trying to mkdir inside read-only PLAYWRIGHT_BROWSERS_PATH");
    process.exit(1);
  } else {
    console.log("\n[NOT REPRODUCED] Did not see expected filesystem error");
    process.exit(0);
  }
} finally {
  server.kill();
}
