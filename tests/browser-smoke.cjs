// Runs production content scripts against a local DOM fixture in real Chrome.
// No personal browser profile, YouTube account, or external requests are used.
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const chromePath = process.env.CHROME_PATH || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium"
].find((candidate) => fs.existsSync(candidate));
if (!chromePath) throw new Error("Set CHROME_PATH to a Chrome or Chromium executable.");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ytta-browser-"));
  let browser;
  let client;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const file = path.resolve(root, `.${url.pathname === "/" || url.pathname === "/watch" ? "/tests/browser-fixture.html" : url.pathname}`);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    res.end(fs.readFileSync(file));
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const debugUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Chrome did not start in time")), 15000);
      browser = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-gpu", "--no-sandbox", "--window-size=1200,900", "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      browser.on("error", reject);
      browser.stderr.on("data", (data) => {
        const match = data.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
    });
    const debugOrigin = debugUrl.replace(/^ws:/, "http:").split("/devtools/")[0];
    const targets = await (await fetch(`${debugOrigin}/json/list`)).json();
    client = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { client.addEventListener("open", resolve, { once: true }); client.addEventListener("error", reject, { once: true }); });
    let id = 0;
    const pending = new Map();
    const errors = [];
    client.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (pending.has(message.id)) {
        const { resolve, reject, timer } = pending.get(message.id);
        clearTimeout(timer); pending.delete(message.id);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)); }, 10000);
      pending.set(requestId, { resolve, reject, timer });
      client.send(JSON.stringify({ id: requestId, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async (expression) => {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) { if (await evaluate(expression)) return; await pause(100); }
      throw new Error(`Timed out: ${expression}`);
    };
    await send("Runtime.enable");
    await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    await waitFor("Boolean(window.fixture)");
    await evaluate("fixture.navigate('abcdefghijk')");
    await waitFor("Boolean(document.querySelector('#ytta-inline-actions [data-role=transcript]')) && !document.querySelector('#ytta-inline-actions [data-role=default-send]').disabled");
    console.log("PASS homepage → watch navigation mounts working controls");
    const reads = await evaluate("fixture.syncReads");
    await pause(700);
    assert.equal(await evaluate("fixture.syncReads"), reads, "Rendering must settle without a mutation loop");
    await evaluate("fixture.blockSend = true; document.querySelector('[data-role=default-send]').click(); window.dispatchEvent(new Event('yt-page-data-updated'))");
    await pause(350);
    assert.equal(await evaluate("document.querySelector('[data-role=default-send]').disabled"), true);
    await evaluate("fixture.unblockSend()");
    console.log("PASS rendering settles and preserves busy button state");
    await evaluate("document.querySelector('[data-role=transcript]').click()");
    await waitFor("document.querySelectorAll('.ytta-cue').length === 3");
    assert.equal(await evaluate("fixture.fetches"), 1, "Caption data should be cached and bridge should avoid watch-page fetches");
    assert.equal(await evaluate("document.querySelector('.ytp-subtitles-button').getAttribute('aria-pressed')"), "false");
    await evaluate("const search = document.querySelector('[data-role=search]'); search.value = 'BANANAS'; search.dispatchEvent(new Event('input')); ");
    await waitFor("document.querySelectorAll('.ytta-cue').length === 1");
    await evaluate("document.querySelector('.ytta-cue').click()");
    assert.equal(await evaluate("document.querySelector('video').currentTime"), 65);
    console.log("PASS timestamp search, seeking, page-data bridge, and caption restoration");
    await evaluate("document.getElementById('movie_player').classList.add('ad-showing')");
    await pause(250);
    assert.equal(await evaluate("fixture.skips"), 0, "Ad skip is opt-in");
    await evaluate("fixture.settings({ autoSkipAds: true })");
    await waitFor("fixture.skips > 0");
    await evaluate("document.getElementById('movie_player').classList.remove('ad-showing')");
    console.log("PASS available ad Skip button is clicked only when enabled");
    assert.equal(await evaluate("fixture.sponsorLookups"), 0);
    await evaluate("fixture.settings({ sponsorBlockEnabled: true })");
    await waitFor("fixture.sponsorLookups === 1");
    await evaluate("document.querySelector('video').currentTime = 12; document.querySelector('video').dispatchEvent(new Event('timeupdate'))");
    await waitFor("document.querySelector('video').currentTime === 20");
    await evaluate("document.querySelector('#ytta-playback-notice button').click()");
    assert.equal(await evaluate("document.querySelector('video').currentTime"), 12);
    await evaluate("document.querySelector('video').dispatchEvent(new Event('timeupdate'))");
    assert.equal(await evaluate("document.querySelector('video').currentTime"), 12);
    console.log("PASS sponsorship skipping and Undo prevent repeat skipping");
    await evaluate("fixture.settings({ sponsorBlockEnabled: false }); fixture.timings = []; fixture.navigate('lmnopqrstuv'); document.querySelector('.ytp-subtitles-button').setAttribute('aria-pressed', 'true')");
    await waitFor("!document.querySelector('[data-role=default-send]').disabled");
    await evaluate("document.querySelector('[data-role=transcript]').click()");
    await waitFor("document.querySelectorAll('.ytta-cue').length === 3");
    assert.equal(await evaluate("document.querySelector('.ytp-subtitles-button').getAttribute('aria-pressed')"), "true");
    console.log("PASS video navigation resets transcript state and preserves enabled captions");
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    const screenshotPath = path.join(os.tmpdir(), "ytta-transcript-preview.png");
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    console.log(`Preview: ${screenshotPath}`);
    await evaluate("fixture.navigate(null)");
    await waitFor("!document.getElementById('ytta-inline-actions') && !document.getElementById('ytta-transcript-panel')");
    assert.deepEqual(errors, [], "No uncaught browser exceptions");
    console.log("PASS leaving watch page cleans up UI; no uncaught exceptions");
  } finally {
    client?.close();
    if (browser && browser.exitCode === null) {
      browser.kill();
      await Promise.race([new Promise((resolve) => browser.once("exit", resolve)), pause(3000)]);
    }
    server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may release profile locks shortly after exit. */ }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
