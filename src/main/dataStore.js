/**
 * Aadhaar Photo Printer - Data Store
 *
 * A simple, reliable JSON-file-based persistent storage system.
 * Avoids ESM/CJS compatibility issues with electron-store v10+ by using
 * plain fs reads/writes to a `settings.json` file in the Electron userData folder.
 *
 * Manages:
 * - Application settings (shop name, pricing, theme, etc.)
 * - Daily print counts (keyed by date string)
 * - Customer records (last 100)
 * - Recent photo paths (last 50)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ============================================================================
// Default Settings
// ============================================================================

const DEFAULTS = {
  shopName: 'Aadhaar Print Shop',
  pricePerPhoto: 10,          // INR
  defaultQuality: 'standard', // 'draft' | 'standard' | 'high'
  darkMode: false,
  language: 'en',
  geminiApiKey: '',
  defaultLayout: '4x3',
  layoutMode: 'grid',          // 'grid' | 'aadhaar-card'
  layoutCols: 4,
  layoutRows: 3,
  showCutGuides: false,
  halfPage: false,
  printerName: '',
  aadhaarCardPositions: {
    front: { xPct: 15, yPct: 10, wPct: 40, hPct: 25 },
    back:  { xPct: 15, yPct: 55, wPct: 40, hPct: 25 },
  },
  dailyCounts: {},             // { '2026-05-31': 42, ... }
  customers: [],               // Last 100 customer records
  recentPhotos: [],            // Last 50 file paths
};

const MAX_CUSTOMERS = 100;
const MAX_RECENT_PHOTOS = 50;

// ============================================================================
// DataStore Class
// ============================================================================

class DataStore {
  /**
   * @param {string} userDataPath - Electron's app.getPath('userData') result
   */
  constructor(userDataPath) {
    this._filePath = path.join(userDataPath, 'settings.json');
    this._data = null;

    // Ensure the userData directory exists
    try {
      if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
      }
    } catch (err) {
      console.warn('[DataStore] Could not create userData dir:', err.message);
    }

    // Load existing data or initialize with defaults
    this._load();
  }

  // --------------------------------------------------------------------------
  // Settings
  // --------------------------------------------------------------------------

  /**
   * Returns all settings (excluding internal arrays like customers/recentPhotos
   * from the "settings" view, but they are included here for completeness).
   *
   * @returns {Object} - Full settings object
   */
  getSettings() {
    return {
      shopName: this._data.shopName,
      pricePerPhoto: this._data.pricePerPhoto,
      defaultQuality: this._data.defaultQuality,
      darkMode: this._data.darkMode,
      language: this._data.language,
      geminiApiKey: this._data.geminiApiKey,
      defaultLayout: this._data.defaultLayout,
      layoutMode: this._data.layoutMode,
      layoutCols: this._data.layoutCols,
      layoutRows: this._data.layoutRows,
      showCutGuides: this._data.showCutGuides,
      halfPage: this._data.halfPage,
      printerName: this._data.printerName,
      aadhaarCardPositions: this._data.aadhaarCardPositions,
    };
  }

  /**
   * Merges partial settings into the store and persists to disk.
   *
   * @param {Object} partial - Key-value pairs to update
   */
  setSettings(partial) {
    if (!partial || typeof partial !== 'object') return;

    // Only allow known setting keys to be updated
    const allowedKeys = [
      'shopName', 'pricePerPhoto', 'defaultQuality',
      'darkMode', 'language', 'geminiApiKey', 'defaultLayout',
      'layoutMode', 'layoutCols', 'layoutRows',
      'showCutGuides', 'halfPage', 'printerName',
      'aadhaarCardPositions',
    ];

    for (const key of allowedKeys) {
      if (key in partial) {
        this._data[key] = partial[key];
      }
    }

    this._save();
  }

  // --------------------------------------------------------------------------
  // Daily Print Counts
  // --------------------------------------------------------------------------

  /**
   * Returns today's print count.
   *
   * @returns {number}
   */
  getDailyCount() {
    const today = this._todayKey();
    return this._data.dailyCounts[today] || 0;
  }

  /**
   * Increments today's print count by the specified amount.
   *
   * @param {number} count - Number of prints to add (default 1)
   * @returns {number} - New total for today
   */
  incrementPrintCount(count = 1) {
    const today = this._todayKey();
    const current = this._data.dailyCounts[today] || 0;
    this._data.dailyCounts[today] = current + Math.max(0, count);

    // Prune old daily counts (keep last 90 days to avoid unbounded growth)
    this._pruneOldDailyCounts(90);

    this._save();
    return this._data.dailyCounts[today];
  }

  // --------------------------------------------------------------------------
  // Customers
  // --------------------------------------------------------------------------

  /**
   * Saves a customer record, prepending it to the list and capping at MAX_CUSTOMERS.
   *
   * @param {{name: string, phone: string, photoCount: number, date?: string}} customer
   */
  saveCustomer(customer) {
    if (!customer || !customer.name) return;

    const record = {
      name: String(customer.name).trim(),
      phone: String(customer.phone || '').trim(),
      photoCount: parseInt(customer.photoCount, 10) || 0,
      date: customer.date || new Date().toISOString(),
    };

    // Prepend new customer (most recent first)
    this._data.customers.unshift(record);

    // Cap the array
    if (this._data.customers.length > MAX_CUSTOMERS) {
      this._data.customers = this._data.customers.slice(0, MAX_CUSTOMERS);
    }

    this._save();
  }

  /**
   * Returns the most recent customers.
   *
   * @param {number} [limit=20] - Maximum number to return
   * @returns {Array<{name: string, phone: string, photoCount: number, date: string}>}
   */
  getRecentCustomers(limit = 20) {
    return this._data.customers.slice(0, Math.max(1, limit));
  }

  /**
   * Searches customers by name or phone number (case-insensitive partial match).
   *
   * @param {string} query - Search term
   * @returns {Array<{name: string, phone: string, photoCount: number, date: string}>}
   */
  searchCustomers(query) {
    if (!query || typeof query !== 'string') return [];

    const q = query.toLowerCase().trim();
    if (q.length === 0) return [];

    return this._data.customers.filter((c) => {
      const name = (c.name || '').toLowerCase();
      const phone = (c.phone || '').toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }

  // --------------------------------------------------------------------------
  // Recent Photos
  // --------------------------------------------------------------------------

  /**
   * Adds a file path to the recent photos list (at the beginning).
   * Removes duplicates and caps at MAX_RECENT_PHOTOS.
   *
   * @param {string} filePath - Absolute path to the photo
   */
  addRecentPhoto(filePath) {
    if (!filePath || typeof filePath !== 'string') return;

    // Remove existing occurrence (if any) to avoid duplicates
    this._data.recentPhotos = this._data.recentPhotos.filter(
      (p) => p !== filePath
    );

    // Prepend
    this._data.recentPhotos.unshift(filePath);

    // Cap
    if (this._data.recentPhotos.length > MAX_RECENT_PHOTOS) {
      this._data.recentPhotos = this._data.recentPhotos.slice(0, MAX_RECENT_PHOTOS);
    }

    this._save();
  }

  /**
   * Returns the list of recent photo paths.
   *
   * @returns {string[]}
   */
  getRecentPhotos() {
    return [...this._data.recentPhotos];
  }

  // --------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------

  /**
   * Loads data from the JSON file, merging with defaults for any missing keys.
   */
  _load() {
    try {
      if (fs.existsSync(this._filePath)) {
        const raw = fs.readFileSync(this._filePath, 'utf-8');
        const parsed = JSON.parse(raw);

        // Deep-merge with defaults so newly added keys get their defaults
        this._data = { ...DEFAULTS, ...parsed };

        // Ensure arrays are actually arrays (handle corrupt data)
        if (!Array.isArray(this._data.customers)) this._data.customers = [];
        if (!Array.isArray(this._data.recentPhotos)) this._data.recentPhotos = [];
        if (typeof this._data.dailyCounts !== 'object' || this._data.dailyCounts === null) {
          this._data.dailyCounts = {};
        }
      } else {
        // First launch — start with defaults
        this._data = { ...DEFAULTS, customers: [], recentPhotos: [], dailyCounts: {} };
        this._save();
      }
    } catch (error) {
      console.error('[DataStore] Failed to load settings, using defaults:', error.message);
      this._data = { ...DEFAULTS, customers: [], recentPhotos: [], dailyCounts: {} };
      this._save();
    }
  }

  /**
   * Persists current data to the JSON file.
   * Uses write-to-temp-then-rename for atomicity.
   */
  _save() {
    try {
      const json = JSON.stringify(this._data, null, 2);
      const tmpPath = this._filePath + '.tmp';

      // Write to temp file first, then rename for atomic operation
      fs.writeFileSync(tmpPath, json, 'utf-8');
      fs.renameSync(tmpPath, this._filePath);
    } catch (error) {
      console.error('[DataStore] Failed to save settings:', error.message);

      // Fallback: try direct write
      try {
        fs.writeFileSync(this._filePath, JSON.stringify(this._data, null, 2), 'utf-8');
      } catch (fallbackErr) {
        console.error('[DataStore] Fallback save also failed:', fallbackErr.message);
      }
    }
  }

  /**
   * Returns today's date as a string key (YYYY-MM-DD).
   *
   * @returns {string}
   */
  _todayKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Removes daily count entries older than the specified number of days.
   *
   * @param {number} maxDays - Maximum age in days to keep
   */
  _pruneOldDailyCounts(maxDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10); // 'YYYY-MM-DD'

    const counts = this._data.dailyCounts;
    for (const dateKey of Object.keys(counts)) {
      if (dateKey < cutoffStr) {
        delete counts[dateKey];
      }
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = { DataStore };
