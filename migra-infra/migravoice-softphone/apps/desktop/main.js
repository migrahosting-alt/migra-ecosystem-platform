const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { autoUpdater } = require('electron-updater');

// Determine if we're in dev vs production
const isDev = process.env.NODE_ENV === 'development';

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) { app.quit(); }

let mainWindow = null;
let tray = null;
let isQuitting = false;
let localServer = null;
let localPort = 0;

// Use a single PNG brand icon across platforms.
const appIconPath = path.join(__dirname, 'build', 'icon.png');

// ─── Local HTTP server for production ─────────────────────────────
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.webp': 'image/webp',
  '.map': 'application/json',
};

function startLocalServer(webDistDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';

      let filePath = path.join(webDistDir, urlPath);

      // Security: don't escape webDistDir
      if (!filePath.startsWith(webDistDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      // If file doesn't exist, serve index.html (SPA routing)
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(webDistDir, 'index.html');
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      try {
        const data = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      } catch (err) {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    // Listen on random available port on localhost only
    server.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 600,
    title: 'MigraVoice',
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    titleBarStyle: 'hiddenInset', // macOS native title bar
    backgroundColor: '#0f172a',
    show: false, // Show after ready-to-show
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${localPort}/`);
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Handle close – minimize to tray instead of quitting
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();

      // Show system notification
      if (Notification.isSupported()) {
        new Notification({
          title: 'MigraVoice',
          body: 'MigraVoice is still running in the system tray. You will receive incoming calls.',
          icon: appIconPath,
          silent: true,
        }).show();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Grant microphone/camera permissions automatically
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'microphone', 'notifications'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  // ─── CORS bypass for Electron ──────────────────────────────────
  // The app runs on http://127.0.0.1:PORT but API is at https://call.migrahosting.com
  // Inject CORS headers so cross-origin fetch works
  if (!isDev) {
    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
      { urls: ['https://call.migrahosting.com/*'] },
      (details, callback) => {
        // Remove Origin header so server doesn't see cross-origin
        delete details.requestHeaders['Origin'];
        callback({ requestHeaders: details.requestHeaders });
      }
    );

    mainWindow.webContents.session.webRequest.onHeadersReceived(
      { urls: ['https://call.migrahosting.com/*'] },
      (details, callback) => {
        // Add permissive CORS headers to every response
        details.responseHeaders['Access-Control-Allow-Origin'] = ['*'];
        details.responseHeaders['Access-Control-Allow-Headers'] = ['*'];
        details.responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, PUT, PATCH, DELETE, OPTIONS'];
        callback({ responseHeaders: details.responseHeaders });
      }
    );
  }
}

function createTray() {
  const iconPath = appIconPath;
  try {
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
  } catch (e) {
    // Fallback if icon doesn't exist
    tray = new Tray(nativeImage.createEmpty());
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show MigraVoice',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Status: Ready',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'New Call',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send('navigate', '/dialer');
        }
      },
    },
    {
      label: 'Call History',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send('navigate', '/calls');
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Check for Updates',
      click: () => autoUpdater.checkForUpdatesAndNotify(),
    },
    { type: 'separator' },
    {
      label: 'Quit MigraVoice',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('MigraVoice – Enterprise Softphone');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ─── App lifecycle ─────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Start local HTTP server for production to serve web-dist files
  if (!isDev) {
    const webDistDir = path.join(process.resourcesPath, 'web-dist');
    localServer = await startLocalServer(webDistDir);
    localPort = localServer.address().port;
    console.log(`[MigraVoice] Local server running at http://127.0.0.1:${localPort}`);
  }

  createWindow();
  createTray();

  // Check for updates in production
  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  if (localServer) localServer.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle second instance launch
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// ─── IPC Handlers ──────────────────────────────────────────────────

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('show-notification', (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: appIconPath }).show();
  }
});

ipcMain.handle('incoming-call', (event, callerName) => {
  // Bring window to front for incoming calls
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    // Flash taskbar on Windows/Linux when window isn't focused
    mainWindow.flashFrame(true);
    // Stop flashing after 5 seconds
    setTimeout(() => {
      if (mainWindow) mainWindow.flashFrame(false);
    }, 5000);
  }
  // Show OS notification
  if (Notification.isSupported()) {
    const notif = new Notification({
      title: '📞 Incoming Call',
      body: `From ${callerName || 'Unknown'}`,
      icon: appIconPath,
      urgency: 'critical',
    });
    notif.on('click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    notif.show();
  }
});

ipcMain.handle('set-badge-count', (event, count) => {
  if (process.platform === 'darwin') {
    app.dock.setBadge(count > 0 ? String(count) : '');
  }
});

// ─── Auto-updater events ──────────────────────────────────────────

autoUpdater.on('update-available', (info) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-available', info);
  }
});

autoUpdater.on('update-downloaded', (info) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-downloaded', info);
  }
  // Install on next restart
  autoUpdater.quitAndInstall(false, true);
});

autoUpdater.on('error', (err) => {
  console.error('Auto-updater error:', err);
});
