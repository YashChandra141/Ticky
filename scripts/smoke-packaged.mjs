/**
 * Packaged-app smoke test: launches the real win-unpacked Ticky.exe with a
 * throwaway data directory and a fixed port, then walks the plan's
 * verification checklist over HTTP:
 *
 *   create → quit → relaunch → persisted? → PDF bytes? → backup →
 *   destroy → restore → back?
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const exe = path.join("dist-electron", "win-unpacked", "Ticky.exe");
if (!existsSync(exe)) {
  console.error("✗ packaged exe not found at", exe);
  process.exit(1);
}

const dataDir = path.join(os.tmpdir(), "opencode", "ticky-smoke-data");
const PORT = 3457;
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let app = null;

function launch() {
  app = spawn(exe, {
    env: { ...process.env, PORT: String(PORT), TICKY_DATA_DIR: dataDir },
    stdio: "ignore",
  });
}

async function stop() {
  if (!app || app.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/F", "/T", "/PID", String(app.pid)]);
  } else {
    app.kill();
  }
  await new Promise((resolve) => app.once("exit", resolve));
  app = null;
  await sleep(500);
}

async function waitHealthy(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/ai/models`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error("the packaged app server never became healthy");
}

async function json(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${options?.method ?? "GET"} ${url} → ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

const INVOICE = {
  number: "SMOKE-PKGD-1",
  status: "draft",
  issueDate: "2026-10-17",
  dueDate: "2026-11-16",
  customerId: null,
  customer: { name: "Packaged Smoke Co", email: "", address: "" },
  items: [{ id: "s-1", description: "Smoke test item", quantityMilli: 1000, unitPriceMinor: 12345 }],
  taxRateBps: 0,
  discountMinor: 0,
  currency: "USD",
  notes: "",
  terms: "",
};

const results = [];
const check = (label, ok, detail = "") => {
  results.push({ label, ok });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};

try {
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(path.dirname(dataDir), { recursive: true });

  console.log("• launching packaged app (first run)…");
  launch();
  await waitHealthy();
  check("first launch healthy", true);

  const created = await json(`${base}/api/invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(INVOICE),
  });
  check("invoice created", created.number === "SMOKE-PKGD-1", created.number);

  await stop();
  console.log("• app stopped; relaunching (second run)…");
  launch();
  await waitHealthy();

  const afterRelaunch = await json(`${base}/api/invoices`);
  const persisted = afterRelaunch.some((invoice) => invoice.number === "SMOKE-PKGD-1");
  check("invoice persisted across restarts", persisted);

  const pdfResponse = await fetch(`${base}/api/invoices/${created.id}/pdf`);
  const pdfBytes = await pdfResponse.arrayBuffer();
  check(
    "PDF export works in the packaged app",
    pdfResponse.ok && pdfBytes.byteLength > 1000,
    `${pdfBytes.byteLength} bytes`,
  );

  const backup = await json(`${base}/api/backup`, { method: "POST" });
  check("backup created", Boolean(backup.file), backup.file);

  await fetch(`${base}/api/invoices/${created.id}`, { method: "DELETE" });
  const emptied = await json(`${base}/api/invoices`);
  check("invoice deleted", !emptied.some((invoice) => invoice.number === "SMOKE-PKGD-1"));

  await json(`${base}/api/backup/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: backup.file }),
  });
  const restored = await json(`${base}/api/invoices`);
  const back = restored.some((invoice) => invoice.number === "SMOKE-PKGD-1");
  check("backup restore brings it back", back);
} catch (error) {
  check(error instanceof Error ? error.message : "unexpected failure", false);
} finally {
  await stop();
  rmSync(dataDir, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok).length;
console.log(failed === 0 ? "✓ smoke test passed" : `✗ ${failed} check(s) failed`);
