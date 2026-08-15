// SPEC: docs/native-app-plan.md D-025：PC 同时提供 Electron 与 Web。
// 同源复用：spawn 同仓 apps/controller/web/server.mjs（设备管理 + 隧道反代官方 UI），BrowserWindow 指向它。
// 运行：pnpm --dir apps/controller/electron start；冒烟（无窗口）：pnpm --dir apps/controller/electron smoke
const { spawn } = require('node:child_process')
const { join } = require('node:path')
const http = require('node:http')

const CONTROLLER_PORT = Number(process.env.CONTROLLER_PORT ?? 3210)
const WEB_SERVER = join(__dirname, '..', 'web', 'server.mjs')

function waitHealthy(port, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const poll = () => {
      const r = http.get(`http://127.0.0.1:${port}/`, (res) => { res.resume(); resolve() })
      r.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('controller-web 启动超时'))
        else setTimeout(poll, 300)
      })
    }
    poll()
  })
}

async function main() {
  const smoke = process.argv.includes('--smoke')
  const child = spawn(process.execPath, [WEB_SERVER], {
    env: { ...process.env, CONTROLLER_PORT: String(CONTROLLER_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (d) => process.stdout.write(`[web] ${d}`))
  child.stderr.on('data', (d) => process.stderr.write(`[web] ${d}`))

  try {
    await waitHealthy(CONTROLLER_PORT)
  } catch (e) {
    child.kill()
    throw e
  }

  if (smoke) {
    console.log(`[whalemaid-electron] smoke OK：controller-web 已就绪 http://127.0.0.1:${CONTROLLER_PORT}`)
    child.kill()
    process.exit(0)
  }

  const { app, BrowserWindow, shell } = require('electron')
  app.whenReady().then(() => {
    const win = new BrowserWindow({
      width: 1280,
      height: 860,
      title: 'WhaleMaid 主控端',
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    })
    // 外链一律交给系统浏览器；主界面永远留在控制器内
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
    win.loadURL(`http://127.0.0.1:${CONTROLLER_PORT}/`)
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) win.loadURL(`http://127.0.0.1:${CONTROLLER_PORT}/`) })
  })
  app.on('window-all-closed', () => {
    child.kill()
    app.quit()
  })
  process.on('exit', () => child.kill())
}

main().catch((e) => { console.error('[whalemaid-electron]', e.message); process.exit(1) })
