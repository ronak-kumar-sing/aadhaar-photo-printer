/**
 * Aadhaar Photo Printer - Image Processor
 *
 * Handles all image processing using the Sharp library:
 * - Resize to Aadhaar photo dimensions (35mm × 45mm at 300 DPI = 413 × 531 px)
 * - Auto-rotate based on EXIF orientation
 * - Smart crop with face/attention detection
 * - Auto-correct brightness, contrast, and histogram normalization
 * - Thumbnail generation
 *
 * Sharp is loaded with a fallback for asar-unpacked paths in packaged builds.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// --- Sharp Loading (with asar-unpacked fallback) ---
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  try {
    // In packaged Electron apps, native modules may live in app.asar.unpacked
    sharp = require(
      path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sharp')
    );
  } catch (fallbackErr) {
    console.error(
      '[ImageProcessor] Failed to load Sharp. Image processing will not work.',
      fallbackErr.message
    );
    sharp = null;
  }
}

// --- Constants ---

/** Target photo dimensions: 35mm × 45mm at 300 DPI */
const TARGET_WIDTH = 413;   // Math.round(35 * 300 / 25.4) = 413
const TARGET_HEIGHT = 531;  // Math.round(45 * 300 / 25.4) = 531

/** Default JPEG output quality (1–100) */
const DEFAULT_QUALITY = 95;

// ============================================================================
// Public API
// ============================================================================

/**
 * Processes a single image to Aadhaar photo specifications.
 *
 * @param {string} filePath          - Absolute path to the source image
 * @param {Object} [options]         - Processing options
 * @param {number} [options.brightness] - Brightness adjustment factor (default 1.0)
 * @param {number} [options.contrast]   - Contrast multiplier (default 1.0)
 * @param {number} [options.saturation] - Saturation factor (default 1.0)
 * @param {boolean} [options.normalize] - Apply histogram normalization (default true)
 * @param {number} [options.quality]    - JPEG output quality 1–100 (default 95)
 * @param {number} [options.targetWidth]  - Override target width in px
 * @param {number} [options.targetHeight] - Override target height in px
 *
 * @returns {Promise<{buffer: Buffer, width: number, height: number, format: string, originalSize: number, processedSize: number}>}
 * @throws {Error} If Sharp is unavailable or the file cannot be processed
 */
async function processImage(filePath, options = {}) {
  ensureSharp();

  // Validate input file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const originalStats = fs.statSync(filePath);
  const originalSize = originalStats.size;

  const targetW = options.targetWidth || TARGET_WIDTH;
  const targetH = options.targetHeight || TARGET_HEIGHT;
  const quality = options.quality || DEFAULT_QUALITY;
  const shouldNormalize = options.normalize !== false; // default true

  // Build the Sharp pipeline
  let pipeline = sharp(filePath)
    // Auto-rotate based on EXIF orientation (no args = use EXIF data)
    .rotate()
    // Resize to target with smart crop (attention = focus on interesting regions)
    .resize(targetW, targetH, {
      fit: 'cover',
      position: 'attention',
      withoutEnlargement: false,
    });

  // Apply histogram normalization for consistent exposure
  if (shouldNormalize) {
    pipeline = pipeline.normalise();
  }

  // Apply brightness / saturation adjustments via modulate()
  const brightness = options.brightness || 1.0;
  const saturation = options.saturation || 1.0;
  if (brightness !== 1.0 || saturation !== 1.0) {
    pipeline = pipeline.modulate({
      brightness,
      saturation,
    });
  }

  // Apply contrast adjustment via linear()
  // linear(a, b) maps each pixel: output = a * input + b
  // For contrast-only: a = contrast, b = 128 * (1 - contrast) to keep midpoint stable
  const contrast = options.contrast || 1.0;
  if (contrast !== 1.0) {
    const offset = 128 * (1 - contrast);
    pipeline = pipeline.linear(contrast, offset);
  }

  // Output as high-quality JPEG
  pipeline = pipeline.jpeg({ quality, mozjpeg: true });

  // Execute the pipeline
  const { data: buffer, info } = await pipeline.toBuffer({ resolveWithObject: true });

  return {
    buffer,
    width: info.width,
    height: info.height,
    format: info.format,
    originalSize,
    processedSize: buffer.length,
  };
}

/**
 * Processes multiple images in batch with progress reporting.
 *
 * @param {string[]} filePaths              - Array of absolute file paths
 * @param {Object} [options]                - Processing options (same as processImage)
 * @param {Function} [progressCallback]     - Called with (currentIndex, totalCount) after each image
 *
 * @returns {Promise<Array<{success: boolean, buffer?: Buffer, width?: number, height?: number, format?: string, originalSize?: number, processedSize?: number, filePath: string, error?: string}>>}
 */
async function processImages(filePaths, options = {}, progressCallback = null) {
  ensureSharp();

  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return [];
  }

  const total = filePaths.length;
  const results = [];

  for (let i = 0; i < total; i++) {
    const filePath = filePaths[i];

    try {
      const result = await processImage(filePath, options);
      results.push({
        success: true,
        ...result,
        filePath,
      });
    } catch (error) {
      console.error(`[ImageProcessor] Failed to process "${path.basename(filePath)}":`, error.message);
      results.push({
        success: false,
        error: error.message,
        filePath,
      });
    }

    // Report progress
    if (typeof progressCallback === 'function') {
      try {
        progressCallback(i + 1, total);
      } catch (cbErr) {
        // Never let a callback error break the batch
        console.warn('[ImageProcessor] Progress callback error:', cbErr.message);
      }
    }
  }

  return results;
}

/**
 * Retrieves metadata about an image without processing it.
 *
 * @param {string} filePath - Absolute path to the image
 * @returns {Promise<{width: number, height: number, format: string, size: number, orientation: number|undefined}>}
 */
async function getImageInfo(filePath) {
  ensureSharp();

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = fs.statSync(filePath);
  const metadata = await sharp(filePath).metadata();

  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    size: stats.size,
    orientation: metadata.orientation || 1,
    space: metadata.space,
    channels: metadata.channels,
    hasAlpha: metadata.hasAlpha,
    density: metadata.density,
  };
}

/**
 * Generates a small JPEG thumbnail from an image file.
 *
 * @param {string} filePath           - Absolute path to the source image
 * @param {number} [maxWidth=300]     - Maximum thumbnail width in pixels
 * @returns {Promise<string>}         - Base64-encoded data URL (image/jpeg)
 */
async function generateThumbnail(filePath, maxWidth = 300) {
  ensureSharp();

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const buffer = await sharp(filePath)
    .rotate()
    .resize(maxWidth, null, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 70 })
    .toBuffer();

  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Throws a descriptive error if Sharp is not available.
 */
function ensureSharp() {
  if (!sharp) {
    throw new Error(
      'Sharp image library is not available. Please ensure the "sharp" npm package ' +
      'is installed correctly. On Windows, you may need to run: npm install sharp --platform=win32'
    );
  }
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Rotates a base64-encoded image buffer by the specified angle.
 *
 * @param {string} base64Buffer - Base64-encoded image data
 * @param {number} angle - Rotation angle in degrees (90, 180, 270, or -90)
 * @returns {Promise<string>} - Base64-encoded rotated image
 */
async function rotateBase64Image(base64Buffer, angle) {
  ensureSharp();

  const buffer = Buffer.from(base64Buffer, 'base64');
  const rotated = await sharp(buffer)
    .rotate(angle)
    .jpeg({ quality: DEFAULT_QUALITY, mozjpeg: true })
    .toBuffer();

  return rotated.toString('base64');
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  processImage,
  processImages,
  getImageInfo,
  generateThumbnail,
  rotateBase64Image,
  TARGET_WIDTH,
  TARGET_HEIGHT,
};
