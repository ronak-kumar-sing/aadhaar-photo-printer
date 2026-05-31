/**
 * Aadhaar Photo Printer - File Manager
 *
 * Handles all file-system operations:
 * - Saving processed photos to a "recent" folder in appData
 * - Listing recent photos with thumbnails
 * - Creating customer-named backups in the Documents folder
 * - Periodic cleanup of old files
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// ============================================================================
// Constants
// ============================================================================

const APP_NAME = 'aadhaar-photo-printer';
const RECENT_FOLDER = 'recent';
const MAX_RECENT_FILES = 50;
const BACKUP_ROOT = 'AadhaarPhotoPrinter';

// ============================================================================
// Path Helpers
// ============================================================================

/**
 * Returns the path to the "recent" photos directory, creating it if needed.
 *
 * @returns {string} - Absolute path to the recent folder
 */
function getRecentDir() {
  const dir = path.join(app.getPath('userData'), RECENT_FOLDER);
  ensureDir(dir);
  return dir;
}

/**
 * Returns the backup root directory under the user's Documents folder.
 *
 * @returns {string} - Absolute path to the backup root
 */
function getBackupRootDir() {
  const dir = path.join(app.getPath('documents'), BACKUP_ROOT, 'backup');
  ensureDir(dir);
  return dir;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Saves an image buffer to the recent photos folder.
 * Enforces a maximum of MAX_RECENT_FILES by deleting the oldest when full.
 *
 * @param {Buffer} imageBuffer - The processed image data
 * @param {string} fileName    - Desired file name (e.g., "photo_001.jpg")
 * @returns {Promise<string>}  - Absolute path of the saved file
 */
async function saveToRecent(imageBuffer, fileName) {
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
    throw new Error('Invalid image buffer provided.');
  }

  const recentDir = getRecentDir();

  // Sanitize filename and add timestamp prefix to avoid collisions
  const safeName = sanitizeFileName(fileName || 'photo.jpg');
  const timestamp = Date.now();
  const finalName = `${timestamp}_${safeName}`;
  const filePath = path.join(recentDir, finalName);

  // Write the file
  fs.writeFileSync(filePath, imageBuffer);

  // Enforce the recent file limit
  await enforceRecentLimit(recentDir, MAX_RECENT_FILES);

  return filePath;
}

/**
 * Lists all photos in the recent folder with metadata and thumbnails.
 * Results are sorted by modification date, newest first.
 *
 * @returns {Promise<Array<{path: string, name: string, date: string, size: number, thumbnail: string}>>}
 */
async function getRecentPhotos() {
  const recentDir = getRecentDir();

  let entries;
  try {
    entries = fs.readdirSync(recentDir);
  } catch (err) {
    console.warn('[FileManager] Could not read recent dir:', err.message);
    return [];
  }

  // Filter to image files and gather stats
  const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tiff', '.tif']);
  const photos = [];

  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    if (!imageExtensions.has(ext)) continue;

    const fullPath = path.join(recentDir, entry);

    try {
      const stats = fs.statSync(fullPath);
      if (!stats.isFile()) continue;

      // Generate a lightweight base64 thumbnail
      let thumbnail = '';
      try {
        thumbnail = await generateSimpleThumbnail(fullPath);
      } catch (thumbErr) {
        // Thumbnail generation is non-critical
        console.warn(`[FileManager] Thumbnail failed for "${entry}":`, thumbErr.message);
      }

      photos.push({
        path: fullPath,
        name: entry,
        date: stats.mtime.toISOString(),
        size: stats.size,
        thumbnail,
      });
    } catch (statErr) {
      // Skip files we can't read
      continue;
    }
  }

  // Sort newest first
  photos.sort((a, b) => new Date(b.date) - new Date(a.date));

  return photos;
}

/**
 * Creates a customer-named backup of photos in the Documents folder.
 * Backup structure: Documents/AadhaarPhotoPrinter/backup/YYYY-MM-DD/[customerName]/
 *
 * @param {Array<{buffer: string, name: string}>} photos - Base64-encoded photos
 * @param {string} [customerName='unknown']                - Customer name for folder
 * @returns {Promise<string>}                              - Absolute path to the backup folder
 */
async function backupPhotos(photos, customerName = 'unknown') {
  if (!photos || !Array.isArray(photos) || photos.length === 0) {
    throw new Error('No photos to backup.');
  }

  // Build the backup directory path
  const dateStr = formatDate(new Date());
  const safeName = sanitizeFileName(customerName || 'unknown');
  const backupDir = path.join(getBackupRootDir(), dateStr, safeName);
  ensureDir(backupDir);

  // Handle potential name collisions if the folder already has files
  const existingFiles = fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];
  const startIndex = existingFiles.length;

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const fileName = photo.name || `photo_${String(startIndex + i + 1).padStart(3, '0')}.jpg`;
    const filePath = path.join(backupDir, sanitizeFileName(fileName));

    try {
      const buffer = Buffer.from(photo.buffer, 'base64');
      fs.writeFileSync(filePath, buffer);
    } catch (err) {
      console.error(`[FileManager] Failed to backup photo "${fileName}":`, err.message);
      // Continue with remaining photos rather than aborting
    }
  }

  return backupDir;
}

/**
 * Deletes files older than maxAge days from the recent folder.
 *
 * @param {number} [maxAgeDays=30] - Maximum age in days
 * @returns {Promise<{deleted: number, errors: number}>}
 */
async function cleanupOldRecent(maxAgeDays = 30) {
  const recentDir = getRecentDir();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);

  let deleted = 0;
  let errors = 0;

  let entries;
  try {
    entries = fs.readdirSync(recentDir);
  } catch (err) {
    console.warn('[FileManager] Could not read recent dir for cleanup:', err.message);
    return { deleted: 0, errors: 0 };
  }

  for (const entry of entries) {
    const fullPath = path.join(recentDir, entry);

    try {
      const stats = fs.statSync(fullPath);
      if (stats.isFile() && stats.mtime < cutoff) {
        fs.unlinkSync(fullPath);
        deleted++;
      }
    } catch (err) {
      errors++;
      console.warn(`[FileManager] Failed to clean up "${entry}":`, err.message);
    }
  }

  if (deleted > 0) {
    console.log(`[FileManager] Cleaned up ${deleted} old file(s) from recent folder.`);
  }

  return { deleted, errors };
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Generates a simple base64 thumbnail by reading the file and (if Sharp is
 * available) resizing it. Falls back to a small-quality re-read if Sharp
 * is not available.
 *
 * @param {string} filePath - Path to the image file
 * @returns {Promise<string>} - Base64 data URL or empty string
 */
async function generateSimpleThumbnail(filePath) {
  // Try to use the imageProcessor's generateThumbnail if available
  try {
    const { generateThumbnail } = require('./imageProcessor');
    return await generateThumbnail(filePath, 200);
  } catch (err) {
    // Sharp not available — fall back to reading raw file as base64
    // This is larger but still works for display purposes
    try {
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch (readErr) {
      return '';
    }
  }
}

/**
 * Enforces a maximum file count in a directory by deleting the oldest files.
 *
 * @param {string} dir   - Directory path
 * @param {number} maxCount - Maximum number of files to keep
 */
async function enforceRecentLimit(dir, maxCount) {
  try {
    const entries = fs.readdirSync(dir);
    if (entries.length <= maxCount) return;

    // Build list with stats
    const filesWithStats = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      try {
        const stats = fs.statSync(fullPath);
        if (stats.isFile()) {
          filesWithStats.push({ path: fullPath, mtime: stats.mtime });
        }
      } catch (e) {
        // Skip unreadable files
      }
    }

    // Sort oldest first
    filesWithStats.sort((a, b) => a.mtime - b.mtime);

    // Delete oldest until we're at the limit
    const toDelete = filesWithStats.length - maxCount;
    for (let i = 0; i < toDelete; i++) {
      try {
        fs.unlinkSync(filesWithStats[i].path);
      } catch (e) {
        console.warn('[FileManager] Could not delete old file:', filesWithStats[i].path);
      }
    }
  } catch (err) {
    console.warn('[FileManager] enforceRecentLimit error:', err.message);
  }
}

/**
 * Sanitizes a filename by removing unsafe characters.
 *
 * @param {string} name - Original filename
 * @returns {string}    - Sanitized filename
 */
function sanitizeFileName(name) {
  if (!name || typeof name !== 'string') return 'file';

  // Remove path separators, null bytes, and other unsafe characters
  let sanitized = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') // Replace unsafe chars with underscore
    .replace(/\.{2,}/g, '.')                  // Collapse multiple dots
    .replace(/^\.+/, '')                      // Remove leading dots
    .trim();

  // Ensure we have something
  if (sanitized.length === 0) sanitized = 'file';

  // Limit length (255 is typical max on Windows/NTFS)
  if (sanitized.length > 200) {
    const ext = path.extname(sanitized);
    sanitized = sanitized.slice(0, 200 - ext.length) + ext;
  }

  return sanitized;
}

/**
 * Formats a Date object as YYYY-MM-DD.
 *
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Creates a directory (and parents) if it does not exist.
 *
 * @param {string} dirPath - Directory path to create
 */
function ensureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch (err) {
    console.error(`[FileManager] Failed to create directory "${dirPath}":`, err.message);
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  saveToRecent,
  getRecentPhotos,
  backupPhotos,
  cleanupOldRecent,
};
