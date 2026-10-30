#!/usr/bin/env node
// electron-runner.js
// Ensures ELECTRON_RUN_AS_NODE is stripped so Electron runs as a desktop app,
// avoiding Node runtime mode when spawned from VS Code / Antigravity IDE terminals.

delete process.env.ELECTRON_RUN_AS_NODE;

const proc = require('child_process');
const electron = require('electron');

const args = process.argv.slice(2);
const child = proc.spawn(electron, args, {
  stdio: 'inherit',
  windowsHide: false,
  env: {
    ...process.env,
  },
});

child.on('close', (code, signal) => {
  if (code === null) {
    process.exit(1);
  }
  process.exit(code);
});

['SIGINT', 'SIGTERM', 'SIGUSR2'].forEach((sig) => {
  process.on(sig, () => {
    if (!child.killed) {
      child.kill(sig);
    }
  });
});
