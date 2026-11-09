'use strict';

// Runs Path of Building's calculations in a child process: pob/server.lua inside PoB's own
// LuaJIT (pobhost.exe on Windows; on other systems set POB_LUAJIT to a compatible luajit).
//
//   const eng = createEngine({ pobDir, serverLua, log })
//   await eng.load(xml)     -> { ok, summary } | { ok:false, error }
//   await eng.eval(text)    -> { ok, item, results } | { ok:false, error }
//
// The process starts on first use, is restarted (with the build loaded again) if it dies.

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

function createEngine({ pobDir, serverLua, log = () => {} }) {
  const srcDir = path.join(pobDir, 'src');
  const runtimeDir = path.join(pobDir, 'runtime');

  let proc = null;
  let ready = null; // Promise resolved when the server says ready
  let buf = '';
  let nextId = 1;
  const waiting = new Map();
  let buildXml = null;
  let selftestBuild = false; // the selftest makes its build inside the process (no XML)

  function command() {
    // paths relative to PoB's src folder (the working directory), see pobhost.c
    const script = path.relative(srcDir, serverLua);
    if (process.env.POB_LUAJIT) return { cmd: process.env.POB_LUAJIT, args: [script] };
    return { cmd: path.join(runtimeDir, 'pobhost.exe'), args: [script] };
  }

  function available() {
    const c = command();
    const missing = [process.env.POB_LUAJIT ? null : c.cmd, path.join(srcDir, 'HeadlessWrapper.lua'), serverLua].filter(Boolean).filter((f) => !fs.existsSync(f));
    return missing.length ? `Missing files: ${missing.join(', ')}` : null;
  }

  function failAll(err) {
    for (const [, w] of waiting) w.reject(err);
    waiting.clear();
  }

  function start() {
    const problem = available();
    if (problem) return Promise.reject(new Error(problem));
    const c = command();
    log(`pob: starting ${c.cmd}`);
    proc = spawn(c.cmd, c.args, {
      cwd: srcDir,
      env: { ...process.env, POB_RUNTIME: path.relative(srcDir, runtimeDir).split(path.sep).join('/') },
      windowsHide: true,
    });
    buf = '';
    let readyResolve; let readyReject;
    ready = new Promise((res, rej) => { readyResolve = res; readyReject = rej; });
    const startTimer = setTimeout(() => readyReject(new Error('Path of Building took too long to start')), 120000);

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (!line.startsWith('@@')) { if (line.trim()) log(`pob(out): ${line}`); continue; }
        let msg;
        try { msg = JSON.parse(line.slice(2)); } catch { log(`pob: bad reply ${line.slice(0, 200)}`); continue; }
        if (msg.id === 0) {
          clearTimeout(startTimer);
          if (msg.ready) readyResolve(); else readyReject(new Error(msg.error || 'Path of Building failed to start'));
          continue;
        }
        const w = waiting.get(msg.id);
        if (w) { waiting.delete(msg.id); w.resolve(msg); }
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) log(`pob(err): ${l}`); });
    const thisProc = proc;
    proc.on('exit', (code) => {
      log(`pob: exited with ${code}`);
      clearTimeout(startTimer);
      readyReject(new Error(`Path of Building stopped (code ${code})`));
      if (proc === thisProc) { proc = null; ready = null; }
      failAll(new Error('Path of Building stopped while working'));
    });
    proc.on('error', (e) => { log(`pob: ${e.message}`); readyReject(e); });
    return ready;
  }

  function send(req, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Path of Building did not answer in time')); }, timeoutMs);
      waiting.set(id, {
        resolve: (m) => { clearTimeout(timer); resolve(m); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      proc.stdin.write(JSON.stringify({ ...req, id }) + '\n');
    });
  }

  // starts the process if needed and loads the build into a fresh process
  async function ensure() {
    if (proc && ready) { await ready; return; }
    await start();
    if (buildXml) {
      const r = await send({ cmd: 'load', xml: buildXml }, 120000);
      if (!r.ok) throw new Error(r.error || 'Could not load the build');
    }
  }

  async function load(xml) {
    const fresh = !proc;
    if (fresh) { buildXml = null; await ensure(); } else await ready;
    const r = await send({ cmd: 'load', xml }, 120000);
    if (r.ok) buildXml = xml;
    return r;
  }

  async function evalItem(text) {
    if (!buildXml && !(selftestBuild && proc)) return { ok: false, error: 'No build loaded' };
    await ensure();
    return send({ cmd: 'eval', text });
  }

  async function selftest() {
    await ensure();
    const r = await send({ cmd: 'selftest' }, 120000);
    selftestBuild = true;
    return r;
  }

  async function exportXml() {
    await ensure();
    return send({ cmd: 'export' });
  }

  function stop() {
    if (proc) { try { proc.stdin.write('{"cmd":"quit"}\n'); } catch {} const p = proc; setTimeout(() => { try { p.kill(); } catch {} }, 1500); }
    proc = null; ready = null;
  }

  return { load, eval: evalItem, selftest, exportXml, stop, available, hasBuild: () => !!buildXml };
}

module.exports = { createEngine };
