'use strict';

// Talks to keyhelper.exe (native/keyhelper.c), which sends one Ctrl+C to the game per request.

const fs = require('fs');
const { spawn } = require('child_process');

function createKeys({ exe, log = () => {} }) {
  let proc = null;
  let buf = '';
  const queue = [];

  function start() {
    if (process.platform !== 'win32' || !fs.existsSync(exe)) return false;
    proc = spawn(exe, [], { windowsHide: true });
    buf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line === 'ready') continue;
        const w = queue.shift();
        if (w) w(line);
      }
    });
    const p = proc;
    proc.on('exit', () => { if (proc === p) proc = null; while (queue.length) queue.shift()('error'); });
    proc.on('error', (e) => log(`keys: ${e.message}`));
    return true;
  }

  // 'ok' | 'notgame' | 'error' | 'unavailable'
  function send(cmd) {
    if (!proc && !start()) return Promise.resolve('unavailable');
    return new Promise((resolve) => {
      const entry = (r) => { clearTimeout(t); resolve(r); };
      // on timeout the helper is out of step with us: restart it
      const t = setTimeout(() => {
        const i = queue.indexOf(entry);
        if (i >= 0) queue.splice(i, 1);
        if (proc) { try { proc.kill(); } catch {} proc = null; }
        resolve('error');
      }, 2000);
      queue.push(entry);
      proc.stdin.write(cmd + '\n');
    });
  }

  return {
    copy: (advanced) => send(advanced ? 'copyadv' : 'copy'),
    foreground: () => send('fg'),
    stop: () => { if (proc) { try { proc.stdin.write('quit\n'); } catch {} } proc = null; },
  };
}

module.exports = { createKeys };
