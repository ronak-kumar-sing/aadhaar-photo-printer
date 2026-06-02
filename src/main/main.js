/**
 * Aadhaar Photo Printer - Main Process Entry Point
 *
 * Creates the main application window, enforces single-instance lock,
 * registers all IPC handlers, and manages the application lifecycle.
 *
 * Security: contextIsolation enabled, nodeIntegration disabled.
 */

'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, Tray } = require('electron');
const path = require('path');
const fs = require('fs');

// --- Module Imports ---
const { processImage, processImageFromBuffer, processImages, getImageInfo, rotateBase64Image, reprocessFromBuffer } = require('./imageProcessor');
const { printPhotos, exportToPDF, getPrinters } = require('./printManager');
const { DataStore } = require('./dataStore');
const { saveToRecent, getRecentPhotos, backupPhotos, cleanupOldRecent } = require('./fileManager');
const { GeminiPhotoAnalyzer } = require('./geminiAI');
const { analyzeForEnhancement, applyEnhancements, applyWhiteBalance, applySharpening, applyBackgroundWhitening } = require('./aiEnhancer');
const { autoEnhanceOffline, autoWhiteBalanceOffline, autoSharpenOffline, backgroundWhiteningOffline } = require('./offlineEnhancer');
const { Logger } = require('./logger');

// --- Globals ---
let mainWindow = null;
let dataStore = null;
let geminiAnalyzer = null;
let tray = null;
let logger = null;

// ============================================================================
// Single Instance Lock
// ============================================================================

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running — quit immediately
  app.quit();
} else {
  app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
    // Someone tried to run a second instance — focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ============================================================================
// App Configuration
// ============================================================================

app.setName('Aadhaar Photo Printer');

// Disable hardware acceleration if it causes issues on older machines
// app.disableHardwareAcceleration();

// ============================================================================
// Window Creation
// ============================================================================

/**
 * Creates the main application window with secure defaults.
 */
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'Aadhaar Photo Printer',
    icon: path.join(__dirname, '..', '..', 'resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    show: false, // Show after ready-to-show to avoid visual flash
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for preload script to use Node APIs
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Remove the application menu bar
  Menu.setApplicationMenu(null);

  // Load the renderer HTML
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Show window only when fully loaded to avoid white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Clean up reference on close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open DevTools in development mode only
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

/**
 * Registers all IPC handlers for communication with the renderer process.
 * Each handler is wrapped in try-catch for robust error handling.
 */
function registerIPCHandlers() {
  // --------------------------------------------------------------------------
  // Dialog Operations
  // --------------------------------------------------------------------------

  ipcMain.handle('dialog:openFile', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Aadhaar Photos',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'tiff', 'tif'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled) return { canceled: true, filePaths: [] };
      return { canceled: false, filePaths: result.filePaths };
    } catch (error) {
      console.error('[IPC] dialog:openFile error:', error);
      return { canceled: true, filePaths: [], error: error.message };
    }
  });

  ipcMain.handle('dialog:save', async (_event, options = {}) => {
    try {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: options.title || 'Save File',
        defaultPath: options.defaultPath || 'output.pdf',
        filters: options.filters || [
          { name: 'PDF Files', extensions: ['pdf'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled) return { canceled: true, filePath: null };
      return { canceled: false, filePath: result.filePath };
    } catch (error) {
      console.error('[IPC] dialog:save error:', error);
      return { canceled: true, filePath: null, error: error.message };
    }
  });

  // --------------------------------------------------------------------------
  // Image Processing Operations
  // --------------------------------------------------------------------------

  ipcMain.handle('image:process', async (_event, filePath, options = {}) => {
    try {
      const result = await processImage(filePath, options);
      return {
        success: true,
        buffer: result.buffer.toString('base64'),
        width: result.width,
        height: result.height,
        format: result.format,
        originalSize: result.originalSize,
        processedSize: result.processedSize,
      };
    } catch (error) {
      console.error('[IPC] image:process error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('image:processBuffer', async (_event, base64Data, options = {}) => {
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      const result = await processImageFromBuffer(buffer, options);
      return {
        success: true,
        buffer: result.buffer.toString('base64'),
        width: result.width,
        height: result.height,
        format: result.format,
        originalSize: result.originalSize,
        processedSize: result.processedSize,
      };
    } catch (error) {
      console.error('[IPC] image:processBuffer error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('image:processBatch', async (event, filePaths, options = {}) => {
    try {
      const progressCallback = (index, total) => {
        // Send progress updates to the renderer process
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('processing:progress', { index, total });
        }
      };

      const results = await processImages(filePaths, options, progressCallback);

      // Convert buffers to base64 for IPC transfer
      const serialized = results.map((r) => {
        if (r.success) {
          return {
            success: true,
            buffer: r.buffer.toString('base64'),
            width: r.width,
            height: r.height,
            format: r.format,
            originalSize: r.originalSize,
            processedSize: r.processedSize,
            filePath: r.filePath,
          };
        }
        return { success: false, error: r.error, filePath: r.filePath };
      });

      return { success: true, results: serialized };
    } catch (error) {
      console.error('[IPC] image:processBatch error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('image:info', async (_event, filePath) => {
    try {
      const info = await getImageInfo(filePath);
      return { success: true, ...info };
    } catch (error) {
      console.error('[IPC] image:info error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('image:rotate', async (_event, base64Buffer, angle) => {
    try {
      const rotated = await rotateBase64Image(base64Buffer, angle);
      return { success: true, buffer: rotated };
    } catch (error) {
      console.error('[IPC] image:rotate error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('image:reprocess', async (_event, base64Buffer, options = {}) => {
    try {
      const result = await reprocessFromBuffer(base64Buffer, options);
      return result;
    } catch (error) {
      console.error('[IPC] image:reprocess error:', error);
      return { success: false, error: error.message };
    }
  });

  // --------------------------------------------------------------------------
  // Print Operations
  // --------------------------------------------------------------------------

  ipcMain.handle('print:execute', async (_event, photos, options = {}) => {
    try {
      const result = await printPhotos(mainWindow, photos, options);
      return result;
    } catch (error) {
      console.error('[IPC] print:execute error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('print:toPDF', async (_event, photos, outputPath, options = {}) => {
    try {
      const result = await exportToPDF(mainWindow, photos, outputPath, options);
      return result;
    } catch (error) {
      console.error('[IPC] print:toPDF error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('print:getPrinters', async () => {
    try {
      const printers = await getPrinters(mainWindow);
      return { success: true, printers };
    } catch (error) {
      console.error('[IPC] print:getPrinters error:', error);
      return { success: false, printers: [], error: error.message };
    }
  });

  // --------------------------------------------------------------------------
  // File Operations
  // --------------------------------------------------------------------------

  ipcMain.handle('file:getRecent', async () => {
    try {
      const photos = await getRecentPhotos();
      return { success: true, photos };
    } catch (error) {
      console.error('[IPC] file:getRecent error:', error);
      return { success: false, photos: [], error: error.message };
    }
  });

  ipcMain.handle('file:saveRecent', async (_event, photoData) => {
    try {
      const savedPath = await saveToRecent(
        Buffer.from(photoData.buffer, 'base64'),
        photoData.fileName
      );
      return { success: true, path: savedPath };
    } catch (error) {
      console.error('[IPC] file:saveRecent error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('file:backup', async (_event, photos) => {
    try {
      const backupPath = await backupPhotos(photos.items, photos.customerName);
      return { success: true, path: backupPath };
    } catch (error) {
      console.error('[IPC] file:backup error:', error);
      return { success: false, error: error.message };
    }
  });

  // --------------------------------------------------------------------------
  // Store Operations
  // --------------------------------------------------------------------------

  ipcMain.handle('store:getSettings', async () => {
    try {
      const settings = dataStore.getSettings();
      return { success: true, settings };
    } catch (error) {
      console.error('[IPC] store:getSettings error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('store:setSettings', async (_event, settings) => {
    try {
      dataStore.setSettings(settings);
      return { success: true };
    } catch (error) {
      console.error('[IPC] store:setSettings error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('store:getDailyCount', async () => {
    try {
      const count = dataStore.getDailyCount();
      return { success: true, count };
    } catch (error) {
      console.error('[IPC] store:getDailyCount error:', error);
      return { success: false, count: 0, error: error.message };
    }
  });

  ipcMain.handle('store:incrementCount', async (_event, count) => {
    try {
      const newCount = dataStore.incrementPrintCount(count);
      return { success: true, count: newCount };
    } catch (error) {
      console.error('[IPC] store:incrementCount error:', error);
      return { success: false, error: error.message };
    }
  });

  // --------------------------------------------------------------------------
  // Customer Operations
  // --------------------------------------------------------------------------

  ipcMain.handle('customer:save', async (_event, customer) => {
    try {
      dataStore.saveCustomer(customer);
      return { success: true };
    } catch (error) {
      console.error('[IPC] customer:save error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('customer:getRecent', async () => {
    try {
      const customers = dataStore.getRecentCustomers();
      return { success: true, customers };
    } catch (error) {
      console.error('[IPC] customer:getRecent error:', error);
      return { success: false, customers: [], error: error.message };
    }
  });

  ipcMain.handle('customer:search', async (_event, query) => {
    try {
      const customers = dataStore.searchCustomers(query);
      return { success: true, customers };
    } catch (error) {
      console.error('[IPC] customer:search error:', error);
      return { success: false, customers: [], error: error.message };
    }
  });

  // --------------------------------------------------------------------------
  // AI Operations
  // --------------------------------------------------------------------------

  ipcMain.handle('ai:analyze', async (_event, filePath) => {
    try {
      const result = await geminiAnalyzer.analyzePhoto(filePath);
      return result;
    } catch (error) {
      console.error('[IPC] ai:analyze error:', error);
      return { available: false, reason: error.message };
    }
  });

  ipcMain.handle('ai:setKey', async (_event, key) => {
    try {
      const result = await geminiAnalyzer.setApiKey(key);
      // Persist the key in settings
      if (result.valid) {
        dataStore.setSettings({ geminiApiKey: key });
      }
      return result;
    } catch (error) {
      console.error('[IPC] ai:setKey error:', error);
      return { valid: false, error: error.message };
    }
  });

  ipcMain.handle('ai:status', async () => {
    try {
      const status = geminiAnalyzer.getStatus();
      return { success: true, ...status };
    } catch (error) {
      console.error('[IPC] ai:status error:', error);
      return { success: false, configured: false, online: false };
    }
  });

  // AI Enhancement Operations
  ipcMain.handle('ai:enhance', async (_event, filePath) => {
    try {
      const result = await analyzeForEnhancement(filePath, geminiAnalyzer);
      return result;
    } catch (error) {
      console.error('[IPC] ai:enhance error:', error);
      return { available: false, reason: error.message };
    }
  });

  ipcMain.handle('ai:whiteBalance', async (_event, filePath) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File not found' };
      }
      const buffer = fs.readFileSync(filePath);
      const result = await applyWhiteBalance(buffer);
      return {
        success: true,
        buffer: result.buffer.toString('base64'),
        width: result.width,
        height: result.height,
        format: result.format,
      };
    } catch (error) {
      console.error('[IPC] ai:whiteBalance error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ai:sharpen', async (_event, filePath) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File not found' };
      }
      const buffer = fs.readFileSync(filePath);
      const result = await applySharpening(buffer);
      return {
        success: true,
        buffer: result.buffer.toString('base64'),
        width: result.width,
        height: result.height,
        format: result.format,
      };
    } catch (error) {
      console.error('[IPC] ai:sharpen error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ai:whitenBg', async (_event, filePath, strength = 0.5) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File not found' };
      }
      const buffer = fs.readFileSync(filePath);
      const result = await applyBackgroundWhitening(buffer, strength);
      return {
        success: true,
        buffer: result.buffer.toString('base64'),
        width: result.width,
        height: result.height,
        format: result.format,
      };
    } catch (error) {
      console.error('[IPC] ai:whitenBg error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ai:enhanceOffline', async (_event, base64Buffer) => {
    try {
      const buffer = Buffer.from(base64Buffer, 'base64');
      const result = await autoEnhanceOffline(buffer);
      return {
        success: true,
        buffer: result.buffer.toString('base64'),
        width: result.width,
        height: result.height,
        format: result.format,
        params: result.params,
      };
    } catch (error) {
      console.error('[IPC] ai:enhanceOffline error:', error);
      return { success: false, error: error.message };
    }
  });

  // --------------------------------------------------------------------------
  // Utility Operations
  // --------------------------------------------------------------------------

  ipcMain.handle('app:getPath', async () => {
    try {
      return {
        success: true,
        userData: app.getPath('userData'),
        documents: app.getPath('documents'),
        temp: app.getPath('temp'),
        appPath: app.getAppPath(),
      };
    } catch (error) {
      logger.error(`[IPC] app:getPath error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('app:about', async () => {
    try {
      return {
        success: true,
        name: app.getName(),
        version: app.getVersion(),
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node,
      };
    } catch (error) {
      logger.error(`[IPC] app:about error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
}

// ============================================================================
// System Tray
// ============================================================================

function createTray() {
  const iconPath = path.join(__dirname, '..', '..', 'resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  if (!fs.existsSync(iconPath)) {
    logger.warn(`[Tray] Icon not found at ${iconPath}, skipping tray creation.`);
    return;
  }

  tray = new Tray(iconPath);
  tray.setToolTip('Aadhaar Photo Printer');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });

  logger.info('[Tray] System tray icon created.');
}

// ============================================================================
// Application Lifecycle
// ============================================================================

app.whenReady().then(() => {
  // Initialize structured logger
  logger = new Logger();
  logger.info('[Main] Application starting...');

  // Initialize data store
  dataStore = new DataStore(app.getPath('userData'));

  // Initialize Gemini AI with saved API key (if any)
  const settings = dataStore.getSettings();
  geminiAnalyzer = new GeminiPhotoAnalyzer(settings.geminiApiKey || '');

  // Register all IPC handlers
  registerIPCHandlers();

  // Create the main window
  createMainWindow();

  // Create system tray icon
  createTray();

  // Periodic cleanup of old recent files (run once at startup)
  cleanupOldRecent(30).catch((err) => {
    logger.warn(`[Main] Cleanup of old recent photos failed: ${err.message}`);
  });
});

app.on('window-all-closed', () => {
  // On macOS, apps typically stay active until Cmd+Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create the window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

// Graceful shutdown
app.on('before-quit', () => {
  if (logger) logger.info('[Main] Application shutting down...');
});

// Handle uncaught errors to prevent silent crashes
process.on('uncaughtException', (error) => {
  if (logger) logger.error(`[Main] Uncaught exception: ${error.stack || error.message}`);
  dialog.showErrorBox(
    'Unexpected Error',
    `An unexpected error occurred:\n\n${error.message}\n\nThe application will continue running, but you may want to restart it.`
  );
});

process.on('unhandledRejection', (reason) => {
  if (logger) logger.error(`[Main] Unhandled promise rejection: ${reason}`);
});
