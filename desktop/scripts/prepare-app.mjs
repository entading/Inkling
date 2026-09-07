#!/usr/bin/env node
/**
 * 打包装配（E1）：把四类产物装配进 desktop/dist-app/（electron-builder 的 directories.app）：
 *   1. esbuild 壳产物  dist/main.cjs + dist/preload.cjs
 *   2. 服务端 tsc 产物  server/dist/**（原样落盘，import.meta 路径锚点在真实磁盘布局下成立）
 *   3. 服务端生产依赖  node_modules/**（装在 staging 根，见下）
 *   4. web 构建产物    web/dist/**
 *
 * 服务端生产依赖装配（设计方案 §4.3 的装配方式修订）：electron-builder 会按依赖树
 * 重算并过滤 node_modules——嵌套 node_modules 一律剥离（spike 实录：cn-font-split 发布包
 * 内 vendored 的 dist/node_modules/.pnpm 被剥掉 → 分片子进程 require 不到，exit 1）。
 * 故改为两段式装配：先按 server 依赖清单在 staging 根 npm ci/install，随后把
 * package.json 改写为无 dependencies 的纯元数据，node_modules 整体经 electron-builder
 * extraResources 原样直拷（不过滤、不重算）。Node 模块解析从 dist-app/server/dist 向上
 * 命中 dist-app/node_modules，语义与原方案等价。
 * 装配用 `npm install/ci --omit=dev --prefix`——--prefix 定死本地前缀，防止 npm 向上并入
 * 根 workspace。首次装配无 lock，用 install 生成并把 package-lock.json 拷回
 * desktop/server-lock.json 入库；之后走 ci 锁版本，消除语义化漂移。
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(desktopRoot, '..')
const distApp = path.join(desktopRoot, 'dist-app')

function fail(msg) {
  console.error(`[prepare-app] ${msg}`)
  process.exit(1)
}

// ---------- 前置产物检查（装配上游的构建必须已跑） ----------

const required = [
  ['壳 main.cjs', path.join(desktopRoot, 'dist', 'main.cjs')],
  ['壳 preload.cjs', path.join(desktopRoot, 'dist', 'preload.cjs')],
  ['server/dist/index.js', path.join(repoRoot, 'server', 'dist', 'index.js')],
  ['web/dist/index.html', path.join(repoRoot, 'web', 'dist', 'index.html')],
]
for (const [label, p] of required) {
  if (!existsSync(p)) fail(`缺少构建产物 ${label}：${p}\n请先在仓库根执行 npm run build，并在 desktop/ 执行 npm run build。`)
}

// ---------- staging：清空重建 ----------

rmSync(distApp, { force: true, recursive: true })
mkdirSync(distApp, { recursive: true })

copyFileSync(path.join(desktopRoot, 'dist', 'main.cjs'), path.join(distApp, 'main.cjs'))
copyFileSync(path.join(desktopRoot, 'dist', 'preload.cjs'), path.join(distApp, 'preload.cjs'))

// 托盘图标（E3）：主进程 Tray 专用小尺寸资源，prod 从 main.cjs 同目录加载；
// 缺失只降级托盘不可用，装配期直接报错拦住（避免打出托盘空白的包）
const trayIconSrc = path.join(desktopRoot, 'build', 'tray-icon.png')
if (!existsSync(trayIconSrc)) {
  fail('缺少托盘图标 desktop/build/tray-icon.png：先运行 node scripts/gen-icon.mjs 渲染。')
}
copyFileSync(trayIconSrc, path.join(distApp, 'tray-icon.png'))

// server/package.json 供 Node 判定 dist/*.js 的模块类型（"type":"module" 是 ESM dist 前提），
// 其 dependencies 同时并入下方 app package.json 驱动依赖安装
const serverPkg = JSON.parse(readFileSync(path.join(repoRoot, 'server', 'package.json'), 'utf8'))
cpSync(path.join(repoRoot, 'server', 'dist'), path.join(distApp, 'server', 'dist'), { recursive: true })
copyFileSync(path.join(repoRoot, 'server', 'package.json'), path.join(distApp, 'server', 'package.json'))
cpSync(path.join(repoRoot, 'server', 'scripts'), path.join(distApp, 'server', 'scripts'), { recursive: true })

// ---------- electron-builder 的 app package.json（先带 dependencies 驱动依赖安装） ----------

const repoPkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const appPkg = {
  name: 'inkling',
  productName: 'Inkling',
  version: repoPkg.version,
  description: repoPkg.description,
  author: 'Inkling',
  private: true,
  main: 'main.cjs',
  dependencies: serverPkg.dependencies,
}
writeFileSync(path.join(distApp, 'package.json'), `${JSON.stringify(appPkg, null, 2)}\n`)

// ---------- 服务端生产依赖（脱离 workspace，--prefix 定死前缀） ----------

const serverLockSrc = path.join(desktopRoot, 'server-lock.json')
const hasLock = existsSync(serverLockSrc)
if (hasLock) {
  // npm ci 要求 lock 与 package.json 同目录
  copyFileSync(serverLockSrc, path.join(distApp, 'package-lock.json'))
}

console.log(`[prepare-app] 安装服务端生产依赖（${hasLock ? 'npm ci（server-lock.json）' : 'npm install（首次，将生成 lock）'}）…`)
const npmArgs = hasLock ? ['ci', '--omit=dev'] : ['install', '--omit=dev']
const npmRes = spawnSync('npm', [...npmArgs, '--prefix', distApp, '--no-audit', '--no-fund', '--loglevel=error'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (npmRes.status !== 0) fail(`服务端生产依赖安装失败（exit ${npmRes.status}）`)

if (!existsSync(path.join(distApp, 'node_modules', 'cn-font-split'))) {
  fail('依赖装配异常：dist-app/node_modules/cn-font-split 缺失')
}

if (!hasLock) {
  const lockGenerated = path.join(distApp, 'package-lock.json')
  if (!existsSync(lockGenerated)) fail('npm install 未生成 package-lock.json，无法固化装配版本')
  copyFileSync(lockGenerated, serverLockSrc)
  console.log('[prepare-app] 已生成 desktop/server-lock.json（请入库，后续装配走 npm ci 锁版本）')
}

// ---------- 收尾：改写为无依赖元数据 + node_modules 交由 extraResources 原样直拷 ----------

delete appPkg.dependencies
writeFileSync(path.join(distApp, 'package.json'), `${JSON.stringify(appPkg, null, 2)}\n`)
rmSync(path.join(distApp, 'package-lock.json'), { force: true })

// ---------- web 构建产物 ----------

cpSync(path.join(repoRoot, 'web', 'dist'), path.join(distApp, 'web', 'dist'), { recursive: true })

console.log(`[prepare-app] 装配完成：${distApp}`)
