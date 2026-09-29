'use strict';
// Feastfall desktop app: starts the game server inside the app and shows the game in its own window.
// Friends on the same network can join the lobby at this computer's address (shown in the game's
// online panel), and "Join a server" in the game connects to someone else's.
//
//   npm run desktop   run from source
//   npm run dist      build the Windows installer and portable .exe into dist/
//   npm run dist:mac  build the Mac .dmg and .zip into dist/ (run it on a Mac)
const { app, BrowserWindow, shell } = require('electron');
const { start } = require('../server.js');

const PORT = 47800; // fixed, so friends know which port to type
const SMOKE = process.argv.includes('--smoke'); // start hidden, check the game loaded, print the result, quit

let win = null, srv = null;

async function boot() {
  // Listen on the network so friends can join (Windows and macOS ask once to allow it). The smoke test stays on this computer.
  const host = SMOKE ? '127.0.0.1' : '0.0.0.0';
  try { srv = await start({ port: PORT, host }); }
  catch (e) { srv = await start({ port: 0, host }); } // port taken (a second copy of the app is open): use any free one

  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 600,
    title: 'Feastfall', backgroundColor: '#0f1411', autoHideMenuBar: true, show: !SMOKE,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.setMenuBarVisibility(false);
  // F11 toggles fullscreen, like a browser (on a Mac, Ctrl+Cmd+F from the default menu works too)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  // Links to other sites open in the normal browser, never inside the game window
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://127.0.0.1:${srv.port}/`)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });

  await win.loadURL(`http://127.0.0.1:${srv.port}/`);

  if (SMOKE) {
    await new Promise(r => setTimeout(r, 4000));
    const result = await win.webContents.executeJavaScript(`JSON.stringify({
      title: document.title, three: typeof THREE, landmarks: world && world.landmarks.length,
      online: !!(NET.lobby && NET.lobby.connected()), lan: document.getElementById('lan-info').textContent,
      fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '') + ' ' + f.weight) })`);
    console.log('SMOKE ' + result + ' port ' + srv.port);
    app.quit();
  }
}

app.whenReady().then(boot).catch(e => { console.error(e); app.quit(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (srv) srv.close(); });
