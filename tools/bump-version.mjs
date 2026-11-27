#!/usr/bin/env node
/**
 * 改一处代码就把 package.json 的补丁号 +1。
 *
 * 用法：
 *   node tools/bump-version.mjs          只升号
 *   node tools/bump-version.mjs --dry    只打印，不写文件
 *
 * 为什么要有这个：DSH 的插件管理器按 package.json 的 version 判断有没有更新，
 * 本地目录安装的插件改完文件但版本没动，管理器不会认为有变化。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(here, '..', 'package.json');

const raw = readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(raw);
const dry = process.argv.includes('--dry');

const current = String(pkg.version || '0.0.0');
const parts = current.split('.');
if (parts.length < 2 || parts.some((p) => !/^\d+$/.test(p))) {
  console.error(`版本号不是 x.y.z 形式：${current}`);
  process.exit(1);
}
while (parts.length < 3) parts.push('0');
const next = `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`;

if (dry) {
  console.log(`${current} -> ${next}（未写入）`);
  process.exit(0);
}

// 只替换 version 那一行，保持文件其余格式（缩进、字段顺序）不动
const updated = raw.replace(/("version"\s*:\s*")([^"]*)(")/, `$1${next}$3`);
if (!updated.includes(`"${next}"`)) {
  console.error('替换 version 失败，package.json 结构可能变了');
  process.exit(1);
}
writeFileSync(pkgPath, updated, 'utf8');
console.log(`${current} -> ${next}`);
