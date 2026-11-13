// A browser audit of the served web app, with no dependency: it drives the installed Chrome over CDP.
//
// Usage: node tools/audit-web.mjs [baseUrl] [outDir] [--status <24 words>]
//
// For every route at a phone width and a desktop width it records the CSP header each document got, every
// origin the page touched, console errors, and whether any inline script lacked a nonce — then writes a
// screenshot and `report.json`. That is the evidence S-10.1 and S-10.11 rest on, and it needs nothing that
// `pnpm install` does not already put on disk.
//
// `--status <words>` additionally fills the /status form with a real Tip ID 0 and those 24 words and prints
// what the page renders, which is the only way to call that page "working" rather than "rendering".
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const args = process.argv.slice(2);
const statusIndex = args.indexOf("--status");
const WORDS = statusIndex === -1 ? undefined : args[statusIndex + 1];
const positional = args.filter((value, index) => {
  if (value === "--status") return false;
  if (statusIndex !== -1 && index === statusIndex + 1) return false;
  return true;
});
const BASE = positional[0] ?? "http://127.0.0.1:3000";
const OUT = positional[1] ?? "docs/p12/audit";
const PORT = 9377;

const ROUTES = (process.env.ROUTES ?? "/,/status,/claim,/panel,/programmes/new,/p/0,/submit/0").split(",");
const VIEWPORTS = (process.env.WIDTHS ?? "390,1440").split(",").map((raw) => {
  const width = Number(raw);
  return width < 600
    ? { name: `mobile-${width}`, width, height: 844, mobile: true }
    : { name: `desktop-${width}`, width, height: 900, mobile: false };
});
const WAIT_MS = 9000;

mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  "--user-data-dir=/tmp/chrome-sealedtip-audit",
  "--no-first-run",
  "--no-default-browser-check",
  "--no-sandbox",
  "--disable-gpu",
  "--hide-scrollbars",
]);

const waitFor = async (url, tries = 80) => {
  for (let i = 0; i < tries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {}
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url} — is Chrome installed at ${CHROME}?`);
};

await waitFor(`http://127.0.0.1:${PORT}/json/version`);

const connect = (url) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.onopen = () => resolve(socket);
    socket.onerror = (event) => reject(new Error(`websocket error ${event.message ?? ""}`));
  });

const page = async () => {
  const created = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" });
  if (!created.ok) throw new Error(`/json/new answered ${created.status}`);
  const target = await created.json();
  const socket = await connect(target.webSocketDebuggerUrl);

  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    } else {
      for (const listener of listeners) listener(message);
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timed out on ${method}`));
      }, 25000);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });

  await send("Runtime.enable");
  await send("Log.enable");
  await send("Network.enable");
  await send("Page.enable");

  return {
    send,
    on: (listener) => listeners.add(listener),
    close: () => {
      socket.close();
      void fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
    },
  };
};

const report = [];

for (const viewport of VIEWPORTS) {
  for (const route of ROUTES) {
    const tab = await page();
    const consoleErrors = [];
    const cspViolations = [];
    const origins = new Set();
    const documents = [];
    const failures = [];

    tab.on(({ method, params }) => {
      if (method === "Runtime.consoleAPICalled" && params.type === "error") {
        consoleErrors.push(params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
      }
      if (method === "Log.entryAdded" && params.entry.level === "error") {
        const text = params.entry.text ?? "";
        (text.includes("Content Security Policy") ? cspViolations : consoleErrors).push(text);
      }
      if (method === "Network.loadingFailed") failures.push(params.errorText ?? "failed");
      if (method === "Network.requestWillBeSent") {
        try {
          origins.add(new URL(params.request.url).origin);
        } catch {}
      }
      if (method === "Network.responseReceived" && params.type === "Document") {
        const headers = params.response.headers ?? {};
        documents.push(headers["content-security-policy"] ?? headers["Content-Security-Policy"]);
      }
    });

    try {
      await tab.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.mobile,
        screenWidth: viewport.width,
        screenHeight: viewport.height,
      });

      const loaded = new Promise((resolve) => {
        const timer = setTimeout(resolve, 20000);
        tab.on((message) => {
          if (message.method === "Page.loadEventFired") {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      await tab.send("Page.navigate", { url: `${BASE}${route}` });
      await loaded;
      await sleep(WAIT_MS);

      const dom = await tab.send("Runtime.evaluate", {
        expression: `(() => {
          const text = document.body ? document.body.innerText : "";
          const scripts = [...document.querySelectorAll("script")].map((s) => ({ src: s.src || null, nonce: s.nonce || null }));
          const external = [...document.querySelectorAll("img,link,script,iframe,source,video")]
            .map((e) => e.src || e.href)
            .filter((u) => u && !u.startsWith(location.origin) && !u.startsWith("data:") && !u.startsWith("blob:"));
          return {
            title: document.title,
            textLength: text.length,
            text: text.slice(0, 1400),
            scriptCount: scripts.length,
            scriptsWithoutNonce: scripts.filter((s) => !s.src && !s.nonce).length,
            external,
          };
        })()`,
        returnByValue: true,
      });

      const shot = await tab.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      const file = `${OUT}/${viewport.name}${route.replace(/[^a-z0-9]+/gi, "_") || "_root"}.png`;
      writeFileSync(file, Buffer.from(shot.data, "base64"));

      report.push({
        route,
        viewport: viewport.name,
        title: dom.result.value?.title,
        textLength: dom.result.value?.textLength,
        text: dom.result.value?.text,
        scriptCount: dom.result.value?.scriptCount,
        scriptsWithoutNonce: dom.result.value?.scriptsWithoutNonce,
        externalReferences: dom.result.value?.external,
        cspHeaders: documents,
        origins: [...origins],
        thirdPartyOrigins: [...origins].filter((origin) => origin !== BASE),
        consoleErrors,
        cspViolations,
        networkFailures: failures,
        screenshot: file,
      });
      console.log(
        `${viewport.name.padEnd(13)} ${route.padEnd(16)} errors=${consoleErrors.length} csp=${cspViolations.length} ` +
          `origins=${[...origins].length} nonce-less=${dom.result.value?.scriptsWithoutNonce} text=${dom.result.value?.textLength}`,
      );
    } catch (error) {
      console.log(`${viewport.name.padEnd(13)} ${route.padEnd(16)} FAILED: ${error.message}`);
      report.push({ route, viewport: viewport.name, failed: error.message });
    } finally {
      tab.close();
    }
  }
}

if (WORDS !== undefined) {
  const tab = await page();
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await tab.send("Page.navigate", { url: `${BASE}/status` });
  await sleep(4000);
  // A synthetic `value = x` plus a dispatched input event does not move React's state; typing through
  // the browser does, because the page's onChange then sees a real insertText.
  await tab.send("Runtime.evaluate", { expression: 'document.querySelector("#tipId").focus()' });
  await tab.send("Input.insertText", { text: "0" });
  await tab.send("Runtime.evaluate", { expression: 'document.querySelector("#words").focus()' });
  await tab.send("Input.insertText", { text: WORDS });
  await sleep(600);
  const counter = await tab.send("Runtime.evaluate", {
    expression: 'document.body.innerText.match(/\\d+ \\/ 24 words/)?.[0]',
    returnByValue: true,
  });
  await tab.send("Runtime.evaluate", { expression: 'document.querySelector("form").requestSubmit()' });
  await sleep(9000);
  const rendered = await tab.send("Runtime.evaluate", {
    expression: "document.body.innerText.slice(0, 2000)",
    returnByValue: true,
  });
  const shot = await tab.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(`${OUT}/mobile-390_status_after_lookup.png`, Buffer.from(shot.data, "base64"));
  report.push({
    route: "/status (after lookup)",
    viewport: "mobile-390",
    wordCounter: counter.result.value,
    text: rendered.result.value,
    screenshot: `${OUT}/mobile-390_status_after_lookup.png`,
  });
  console.log("\n--- /status after lookup ---\n" + rendered.result.value);
  tab.close();
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(`\nreport: ${OUT}/report.json`);
chrome.kill();
process.exit(0);
