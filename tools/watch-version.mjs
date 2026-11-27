#!/usr/bin/env node
/**
 * 盯着源码文件，改完一批就自动把补丁号 +1。
 *
 * 用法：node tools/watch-version.mjs
 *
 * 规则：
 *   - 只看会被打包的源码：index.js / client.js / README.md / icon.svg / locale / cordis.patch.yml
 *   - 忽略 package.json 自己，否则升号会触发下一轮
 *   - 连续改动按「停手 8 秒」算一批，一批只升一次号，避免每敲一个字都跳版本
 */
import { watch, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const bump = path.join(here, 'bump-version.mjs');
const QUIET_MS = 8000;

const watched = ['index.js', 'client.js', 'README.md', 'icon.svg', 'cordis.patch.yml'];
const dirs = ['locale'];

let timer = null;
let busy = false;

const bumpNow = () => {
  if (busy) return;
  busy = true;
  const r = spawnSync(process.execPath, [bump], { cwd: root, encoding: 'utf8' });
  busy = false;
  const stamp = new Date().toLocaleTimeString();
  if (r.status === 0) console.log(`[${stamp}] 版本 ${String(r.stdout).trim()}`);
  else console.error(`[${stamp}] 升号失败：${String(r.stderr || r.stdout).trim()}`);
};

const schedule = (reason) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    bumpNow();
  }, QUIET_MS);
  console.log(`改动：${reason}（${QUIET_MS / 1000}s 后升号）`);
};

const attach = (file) => {
  try {
    watch(file, { persistent: true }, (_event, filename) => {
      schedule(filename ? path.relative(root, path.join(path.dirname(file), filename)) : file);
    });
  } catch (err) {
    console.error(`监听失败 ${file}: ${err.message}`);
  }
};

for (const name of watched) attach(path.join(root, name));
for (const dir of dirs) {
  const full = path.join(root, dir);
  try {
    readdirSync(full);
  } catch {
    continue;
  }
  attach(full);
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
console.log(`监听中：${watched.join(', ')} + ${dirs.join('/')}，当前版本 ${pkg.version}`);
console.log('改完一批（停手 8 秒）自动 +1 补丁号，Ctrl+C 退出。');
