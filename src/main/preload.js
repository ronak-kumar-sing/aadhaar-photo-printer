/**
 * Aadhaar Photo Printer - Preload Script
 *
 * Securely exposes a curated set of Electron IPC methods to the renderer
 * process via contextBridge. This is the ONLY bridge between the renderer
 * (untrusted) and the main process (privileged).
 *
 * Security Model:
 * - contextIsolation: true  → renderer cannot access Node.js or Electron APIs
 * - nodeIntegration: false   → no require() in the renderer
 * - Only explicitly listed channels are exposed
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Allowed IPC invoke channels (renderer → main, with response).
 * Any channel not in this list will be silently rejected.
 */
const ALLOWED_INVOKE_CHANNELS = new Set([
  // Dialog
  'dialog:openFile',
  'dialog:save',
  // Image processing
  'image:process',
  'image:processBatch',
  'image:info',
  // Print
  'print:execute',
  'print:toPDF',
  'print:getPrinters',
  // File
  'file:getRecent',
  'file:saveRecent',
  'file:backup',
  // Store
  'store:getSettings',
  'store:setSettings',
  'store:getDailyCount',
  'store:incrementCount',
  // Customer
  'customer:save',
  'customer:getRecent',
  'customer:search',
  // AI
  'ai:analyze',
  'ai:setKey',
  'ai:status',
  // Utility
  'app:getPath',
]);

/**
 * Allowed IPC receive channels (main → renderer, one-way).
 */
const ALLOWED_RECEIVE_CHANNELS = new Set([
  'processing:progress',
]);

/**
 * Safe invoke wrapper — only forwards to whitelisted channels.
 *
 * @param {string} channel - IPC channel name
 * @param  {...any} args   - Arguments to pass
 * @returns {Promise<any>} - Response from main process
 */
function safeInvoke(channel, ...args) {
  if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
    return Promise.reject(new Error(`IPC channel "${channel}" is not allowed.`));
  }
  return ipcRenderer.invoke(channel, ...args);
}

/**
 * Safe listener wrapper — only listens to whitelisted channels.
 * Returns an unsubscribe function for cleanup.
 *
 * @param {string} channel   - IPC channel name
 * @param {Function} callback - Listener function
 * @returns {Function} - Unsubscribe function
 */
function safeOn(channel, callback) {
  if (!ALLOWED_RECEIVE_CHANNELS.has(channel)) {
    console.warn(`[Preload] Blocked listener on disallowed channel: "${channel}"`);
    return () => {}; // no-op unsubscribe
  }

  // Wrap callback to strip the IpcRendererEvent (never expose it to renderer)
  const wrappedCallback = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, wrappedCallback);

  // Return unsubscribe function
  return () => {
    ipcRenderer.removeListener(channel, wrappedCallback);
  };
}

// ============================================================================
// Expose the API to the renderer via contextBridge
// ============================================================================

contextBridge.exposeInMainWorld('electronAPI', {
  // --------------------------------------------------------------------------
  // Photo / Image Operations
  // --------------------------------------------------------------------------

  /**
   * Opens a native file dialog to select one or more image files.
   * @returns {Promise<{canceled: boolean, filePaths: string[]}>}
   */
  openFileDialog: () => safeInvoke('dialog:openFile'),

  /**
   * Processes a single image for Aadhaar photo format (35mm × 45mm at 300 DPI).
   * @param {string} filePath - Absolute path to the source image
   * @param {Object} [options] - Processing options (brightness, contrast, etc.)
   * @returns {Promise<{success: boolean, buffer?: string, width?: number, height?: number, error?: string}>}
   */
  processImage: (filePath, options) => safeInvoke('image:process', filePath, options),

  /**
   * Processes multiple images in batch with progress reporting.
   * Listen to onProcessingProgress for per-image updates.
   * @param {string[]} filePaths - Array of absolute file paths
   * @param {Object} [options]   - Processing options applied to all images
   * @returns {Promise<{success: boolean, results?: Array, error?: string}>}
   */
  processImages: (filePaths, options) => safeInvoke('image:processBatch', filePaths, options),

  /**
   * Retrieves metadata about an image file without processing it.
   * @param {string} filePath - Absolute path to the image
   * @returns {Promise<{success: boolean, width?: number, height?: number, format?: string, size?: number}>}
   */
  getImageInfo: (filePath) => safeInvoke('image:info', filePath),

  // --------------------------------------------------------------------------
  // Print Operations
  // --------------------------------------------------------------------------

  /**
   * Prints photos on A4 paper in the specified grid layout.
   * @param {Array<{buffer: string, name: string}>} photos - Base64 photo buffers
   * @param {Object} [options] - Print options (quality, copies, printerName, layout)
   * @returns {Promise<{success: boolean, pagesCount?: number, error?: string}>}
   */
  print: (photos, options) => safeInvoke('print:execute', photos, options),

  /**
   * Exports photos to a PDF file at the specified output path.
   * @param {Array<{buffer: string, name: string}>} photos - Base64 photo buffers
   * @param {string} outputPath - Where to save the PDF
   * @param {Object} [options]  - Print/layout options
   * @returns {Promise<{success: boolean, filePath?: string, fileSize?: number, error?: string}>}
   */
  printToPDF: (photos, outputPath, options) => safeInvoke('print:toPDF', photos, outputPath, options),

  /**
   * Retrieves the list of system printers.
   * @returns {Promise<{success: boolean, printers: Array}>}
   */
  getPrinters: () => safeInvoke('print:getPrinters'),

  // --------------------------------------------------------------------------
  // File Operations
  // --------------------------------------------------------------------------

  /**
   * Retrieves the list of recently saved photos.
   * @returns {Promise<{success: boolean, photos: Array}>}
   */
  getRecentPhotos: () => safeInvoke('file:getRecent'),

  /**
   * Saves a processed photo to the recent folder.
   * @param {{buffer: string, fileName: string}} photoData
   * @returns {Promise<{success: boolean, path?: string, error?: string}>}
   */
  saveToRecent: (photoData) => safeInvoke('file:saveRecent', photoData),

  /**
   * Creates a backup of photos under the customer's name.
   * @param {{items: Array, customerName: string}} photos
   * @returns {Promise<{success: boolean, path?: string, error?: string}>}
   */
  backupPhotos: (photos) => safeInvoke('file:backup', photos),

  // --------------------------------------------------------------------------
  // Store / Settings Operations
  // --------------------------------------------------------------------------

  /**
   * Retrieves all application settings.
   * @returns {Promise<{success: boolean, settings: Object}>}
   */
  getSettings: () => safeInvoke('store:getSettings'),

  /**
   * Merges partial settings into the store.
   * @param {Object} settings - Key-value pairs to update
   * @returns {Promise<{success: boolean}>}
   */
  setSettings: (settings) => safeInvoke('store:setSettings', settings),

  /**
   * Gets today's print count.
   * @returns {Promise<{success: boolean, count: number}>}
   */
  getDailyCount: () => safeInvoke('store:getDailyCount'),

  /**
   * Increments today's print count by the specified amount.
   * @param {number} count - Number of prints to add
   * @returns {Promise<{success: boolean, count: number}>}
   */
  incrementPrintCount: (count) => safeInvoke('store:incrementCount', count),

  // --------------------------------------------------------------------------
  // Customer Operations
  // --------------------------------------------------------------------------

  /**
   * Saves a customer record.
   * @param {{name: string, phone: string, photoCount: number, date: string}} customer
   * @returns {Promise<{success: boolean}>}
   */
  saveCustomer: (customer) => safeInvoke('customer:save', customer),

  /**
   * Retrieves the most recent customers.
   * @returns {Promise<{success: boolean, customers: Array}>}
   */
  getRecentCustomers: () => safeInvoke('customer:getRecent'),

  /**
   * Searches customers by name or phone number.
   * @param {string} query - Search term
   * @returns {Promise<{success: boolean, customers: Array}>}
   */
  searchCustomers: (query) => safeInvoke('customer:search', query),

  // --------------------------------------------------------------------------
  // AI Operations (Gemini Vision)
  // --------------------------------------------------------------------------

  /**
   * Analyzes a photo using Gemini Vision AI for Aadhaar suitability.
   * @param {string} filePath - Path to the photo to analyze
   * @returns {Promise<Object>} - Analysis results or { available: false, reason: '...' }
   */
  analyzePhoto: (filePath) => safeInvoke('ai:analyze', filePath),

  /**
   * Sets and validates the Gemini API key.
   * @param {string} key - Gemini API key
   * @returns {Promise<{valid: boolean, error?: string}>}
   */
  setApiKey: (key) => safeInvoke('ai:setKey', key),

  /**
   * Checks the current AI service status.
   * @returns {Promise<{configured: boolean, online: boolean}>}
   */
  getAiStatus: () => safeInvoke('ai:status'),

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  /**
   * Subscribes to batch processing progress updates.
   * @param {Function} callback - Called with ({ index, total }) on each image
   * @returns {Function} - Unsubscribe function
   */
  onProcessingProgress: (callback) => safeOn('processing:progress', callback),

  /**
   * Opens a native save dialog.
   * @param {Object} [options] - Dialog options (title, defaultPath, filters)
   * @returns {Promise<{canceled: boolean, filePath?: string}>}
   */
  showSaveDialog: (options) => safeInvoke('dialog:save', options),

  /**
   * Retrieves common application paths.
   * @returns {Promise<{success: boolean, userData: string, documents: string, temp: string, appPath: string}>}
   */
  getAppPath: () => safeInvoke('app:getPath'),
});
