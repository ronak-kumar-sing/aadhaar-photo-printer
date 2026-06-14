/**
 * Aadhaar Photo Printer - Scanner Watcher
 *
 * Watches a designated scans folder for new image files and notifies
 * the renderer process via IPC. Works with any scanner software that
 * saves files to a folder (e.g., Canon IJ Scan Utility).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');

// ============================================================================
// Constants
// ============================================================================

const SCAN_FOLDER_NAME = 'scans';
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tiff', '.tif']);
const DEBOUNCE_MS = 1500; // Wait for file write to complete

// ============================================================================
// Scanner Watcher
// ============================================================================

class ScannerWatcher {
  constructor(mainWindow) {
    this._mainWindow = mainWindow;
    this._scanDir = path.join(app.getPath('documents'), 'AadhaarPhotoPrinter', SCAN_FOLDER_NAME);
    this._watcher = null;
    this._knownFiles = new Set();
    this._pendingFiles = new Map(); // filepath -> timeoutId
    this._isWatching = false;
  }

  /**
   * Returns the path to the scans directory.
   */
  getScanDir() {
    return this._scanDir;
  }

  /**
   * Ensures the scans directory exists.
   */
  ensureScanDir() {
    try {
      if (!fs.existsSync(this._scanDir)) {
        fs.mkdirSync(this._scanDir, { recursive: true });
        console.log('[Scanner] Created scans directory:', this._scanDir);
      }
    } catch (err) {
      console.error('[Scanner] Failed to create scans directory:', err.message);
    }
  }

  /**
   * Opens the scans folder in the system file manager.
   */
  openScanFolder() {
    this.ensureScanDir();
    shell.openPath(this._scanDir);
  }

  /**
   * Scans the directory once and returns all image files.
   */
  getExistingScans() {
    this.ensureScanDir();
    try {
      const entries = fs.readdirSync(this._scanDir);
      return entries
        .filter((name) => {
          const ext = path.extname(name).toLowerCase();
          return SUPPORTED_EXTENSIONS.has(ext);
        })
        .map((name) => path.join(this._scanDir, name))
        .filter((fullPath) => fs.statSync(fullPath).isFile());
    } catch (err) {
      console.warn('[Scanner] Could not read scans directory:', err.message);
      return [];
    }
  }

  /**
   * Starts watching the scans folder for new files.
   */
  start() {
    if (this._isWatching) return;
    this.ensureScanDir();

    // Build initial known file set
    const existing = this.getExistingScans();
    existing.forEach((f) => this._knownFiles.add(f));

    try {
      this._watcher = fs.watch(this._scanDir, { persistent: false }, (eventType, filename) => {
        if (!filename) return;
        const ext = path.extname(filename).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) return;

        const fullPath = path.join(this._scanDir, filename);

        if (eventType === 'rename' || eventType === 'change') {
          // Debounce: scanners may write files in chunks
          if (this._pendingFiles.has(fullPath)) {
            clearTimeout(this._pendingFiles.get(fullPath));
          }

          this._pendingFiles.set(
            fullPath,
            setTimeout(() => {
              this._pendingFiles.delete(fullPath);
              this._handleFile(fullPath);
            }, DEBOUNCE_MS)
          );
        }
      });

      this._isWatching = true;
      console.log('[Scanner] Watching folder:', this._scanDir);
    } catch (err) {
      console.error('[Scanner] Failed to start watcher:', err.message);
    }
  }

  /**
   * Stops watching the scans folder.
   */
  stop() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
    this._pendingFiles.forEach((id) => clearTimeout(id));
    this._pendingFiles.clear();
    this._isWatching = false;
  }

  /**
   * Handles a potentially new file.
   */
  _handleFile(filePath) {
    if (this._knownFiles.has(filePath)) return;

    // Verify file exists and is readable
    try {
      const stats = fs.statSync(filePath);
      if (!stats.isFile() || stats.size === 0) return;
    } catch (err) {
      return;
    }

    this._knownFiles.add(filePath);
    console.log('[Scanner] New scan detected:', filePath);

    // Notify renderer
    if (this._mainWindow && !this._mainWindow.isDestroyed()) {
      this._mainWindow.webContents.send('scanner:newFile', {
        path: filePath,
        name: path.basename(filePath),
      });
    }
  }
}

module.exports = { ScannerWatcher };
