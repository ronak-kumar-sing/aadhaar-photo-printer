/**
 * Aadhaar Photo Printer - Image Processor
 *
 * Handles all image processing using the Sharp library:
 * - Resize to Aadhaar photo dimensions (35mm × 45mm at 300 DPI = 413 × 531 px)
 * - Auto-rotate based on EXIF orientation
 * - Smart crop with face/attention detection
 * - Auto-correct brightness, contrast, and histogram normalization
 * - Thumbnail generation
 * - Process from Buffer (for drag-and-drop files without path)
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

  const buffer = fs.readFileSync(filePath);
  const result = await processBuffer(buffer, options, originalSize);
  return result;
}

/**
 * Processes an image from a Buffer (for drag-and-drop files without path).
 *
 * @param {Buffer} buffer            - Raw image buffer
 * @param {Object} [options]         - Processing options (same as processImage)
 * @returns {Promise<{buffer: Buffer, width: number, height: number, format: string, originalSize: number, processedSize: number}>}
 */
async function processImageFromBuffer(buffer, options = {}) {
  ensureSharp();

  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Invalid buffer provided. Expected a Buffer.');
  }

  const originalSize = buffer.length;
  return await processBuffer(buffer, options, originalSize);
}

/**
 * Shared processing logic for both file and buffer inputs.
 */
async function processBuffer(inputBuffer, options = {}, originalSize = 0) {
  const targetW = options.targetWidth || TARGET_WIDTH;
  const targetH = options.targetHeight || TARGET_HEIGHT;
  const quality = options.quality != null ? options.quality : DEFAULT_QUALITY;
  const shouldNormalize = options.normalize !== false; // default true

  // Build the Sharp pipeline
  let pipeline = sharp(inputBuffer)
    // Auto-rotate based on EXIF orientation (no args = use EXIF data)
    .rotate()
    // Resize to target with smart crop (attention = focus on interesting regions)
    .resize(targetW, targetH, {
      fit: options.fit || 'cover',
      position: options.position || 'attention',
      withoutEnlargement: false,
    });

  // Apply histogram normalization for consistent exposure
  if (shouldNormalize) {
    pipeline = pipeline.normalise();
  }

  // Apply brightness / saturation adjustments via modulate()
  // Use != null to allow 0 as a valid value
  const brightness = options.brightness != null ? options.brightness : 1.0;
  const saturation = options.saturation != null ? options.saturation : 1.0;
  if (brightness !== 1.0 || saturation !== 1.0) {
    pipeline = pipeline.modulate({
      brightness,
      saturation,
    });
  }

  // Apply contrast adjustment via linear()
  // linear(a, b) maps each pixel: output = a * input + b
  // For contrast-only: a = contrast, b = 128 * (1 - contrast) to keep midpoint stable
  const contrast = options.contrast != null ? options.contrast : 1.0;
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
// AI Enhancement Pipeline
// ============================================================================

/**
 * Applies a full enhancement pipeline in a single Sharp pass.
 * Supports: white balance, brightness, contrast, saturation, sharpening,
 * background whitening, and histogram normalization.
 *
 * @param {Buffer} inputBuffer - Raw image buffer
 * @param {Object} params - Enhancement parameters
 * @param {number} [params.brightness=1.0] - Brightness factor
 * @param {number} [params.contrast=1.0] - Contrast multiplier
 * @param {number} [params.saturation=1.0] - Saturation factor
 * @param {number} [params.sharpen=0] - Sharpen sigma (0 = off)
 * @param {Object} [params.whiteBalance] - RGB multipliers { r, g, b }
 * @param {number} [params.backgroundWhitening=0] - Whitening strength 0-1
 * @param {boolean} [params.normalize=true] - Histogram normalization
 * @param {number} [params.quality=95] - JPEG quality
 * @param {number} [params.targetWidth] - Override target width
 * @param {number} [params.targetHeight] - Override target height
 *
 * @returns {Promise<{buffer: Buffer, width: number, height: number, format: string}>}
 */
async function applyEnhancementPipeline(inputBuffer, params = {}) {
  ensureSharp();

  const targetW = params.targetWidth || TARGET_WIDTH;
  const targetH = params.targetHeight || TARGET_HEIGHT;
  const quality = params.quality != null ? params.quality : DEFAULT_QUALITY;
  const shouldNormalize = params.normalize !== false;

  let pipeline = sharp(inputBuffer)
    .rotate()
    .resize(targetW, targetH, {
      fit: params.fit || 'cover',
      position: params.position || 'attention',
      withoutEnlargement: false,
    });

  // Histogram normalization
  if (shouldNormalize) {
    pipeline = pipeline.normalise();
  }

  // White balance via channel multipliers (recomb matrix)
  if (params.whiteBalance && typeof params.whiteBalance === 'object') {
    const { r = 1, g = 1, b = 1 } = params.whiteBalance;
    if (r !== 1 || g !== 1 || b !== 1) {
      pipeline = pipeline.recomb([
        [r, 0, 0],
        [0, g, 0],
        [0, 0, b],
      ]);
    }
  }

  // Brightness + saturation
  const brightness = params.brightness != null ? params.brightness : 1.0;
  const saturation = params.saturation != null ? params.saturation : 1.0;
  if (brightness !== 1.0 || saturation !== 1.0) {
    pipeline = pipeline.modulate({ brightness, saturation });
  }

  // Contrast
  const contrast = params.contrast != null ? params.contrast : 1.0;
  if (contrast !== 1.0) {
    const offset = 128 * (1 - contrast);
    pipeline = pipeline.linear(contrast, offset);
  }

  // Sharpening
  if (params.sharpen && params.sharpen > 0) {
    pipeline = pipeline.sharpen({
      sigma: Math.min(params.sharpen, 2.0),
      flat: 1.5,
      jagged: 0.5,
    });
  }

  // Background whitening
  if (params.backgroundWhitening && params.backgroundWhitening > 0) {
    pipeline = await applyBackgroundWhitening(pipeline, params.backgroundWhitening, targetW, targetH);
  }

  // Output
  pipeline = pipeline.jpeg({ quality, mozjpeg: true });

  const { data: buffer, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return { buffer, width: info.width, height: info.height, format: info.format };
}

/**
 * Re-processes an already-processed image from its base64 buffer with new options.
 * Used for applying AI enhancements without re-reading the original file.
 *
 * @param {string} base64Buffer - Base64-encoded image data
 * @param {Object} options - Processing options (same as processImage)
 * @returns {Promise<{success: boolean, buffer?: string, width?: number, height?: number, format?: string, error?: string}>}
 */
async function reprocessFromBuffer(base64Buffer, options = {}) {
  try {
    ensureSharp();
    const buffer = Buffer.from(base64Buffer, 'base64');
    const result = await applyEnhancementPipeline(buffer, options);
    return {
      success: true,
      buffer: result.buffer.toString('base64'),
      width: result.width,
      height: result.height,
      format: result.format,
    };
  } catch (error) {
    console.error('[ImageProcessor] reprocessFromBuffer error:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// Background Whitening
// ============================================================================

/**
 * Applies center-protected background whitening using a radial gradient mask.
 * Lightens and desaturates edge regions while preserving the central face area.
 *
 * @param {Object} pipeline - Sharp pipeline instance
 * @param {number} strength - Whitening intensity 0-1
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Promise<Object>} - Modified Sharp pipeline
 */
async function applyBackgroundWhitening(pipeline, strength, width, height) {
  if (!strength || strength <= 0) return pipeline;

  try {
    // Get the current processed buffer from the pipeline
    const processedBuffer = await pipeline.clone().raw().toBuffer();

    // Create a brightened/desaturated version
    const brightened = await sharp(processedBuffer, {
      raw: { width, height, channels: 3 },
    })
      .modulate({
        brightness: 1 + strength * 0.3,
        saturation: Math.max(0.3, 1 - strength * 0.7),
      })
      .raw()
      .toBuffer();

    // Create radial gradient mask: 0 at center (keep original), 255 at edges (use brightened)
    const maskData = createRadialGradientMask(width, height);

    // Blend: for each pixel, result = original * (1 - mask/255) + brightened * (mask/255)
    const blended = blendWithMask(processedBuffer, brightened, maskData, width, height);

    // Return new sharp instance from blended buffer
    return sharp(Buffer.from(blended), {
      raw: { width, height, channels: 3 },
    });
  } catch (err) {
    console.warn('[ImageProcessor] Background whitening failed:', err.message);
    return pipeline;
  }
}

/**
 * Creates a radial gradient mask as a Uint8Array.
 * Center = 0 (protect), edges = 255 (whiten).
 *
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array}
 */
function createRadialGradientMask(width, height) {
  const cx = width / 2;
  const cy = height * 0.42; // Face is typically slightly above center
  const maxRadius = Math.sqrt(cx * cx + cy * cy);
  const data = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Normalize to 0-1, with smooth quadratic falloff
      const t = Math.min(1, dist / (maxRadius * 0.55));
      const value = Math.round(t * t * 255);
      data[y * width + x] = value;
    }
  }

  return data;
}

/**
 * Blends two RGB buffers using a grayscale mask.
 *
 * @param {Buffer} original - Original RGB buffer
 * @param {Buffer} modified - Modified RGB buffer
 * @param {Uint8Array} mask - Grayscale mask 0-255
 * @param {number} width
 * @param {number} height
 * @returns {Buffer} - Blended RGB buffer
 */
function blendWithMask(original, modified, mask, width, height) {
  const result = Buffer.alloc(width * height * 3);

  for (let i = 0; i < width * height; i++) {
    const m = mask[i] / 255; // 0 = original, 1 = modified
    const invM = 1 - m;

    result[i * 3] = Math.round(original[i * 3] * invM + modified[i * 3] * m);
    result[i * 3 + 1] = Math.round(original[i * 3 + 1] * invM + modified[i * 3 + 1] * m);
    result[i * 3 + 2] = Math.round(original[i * 3 + 2] * invM + modified[i * 3 + 2] * m);
  }

  return result;
}

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
  processImageFromBuffer,
  processImages,
  getImageInfo,
  generateThumbnail,
  rotateBase64Image,
  applyEnhancementPipeline,
  reprocessFromBuffer,
  createRadialGradientMask,
  TARGET_WIDTH,
  TARGET_HEIGHT,
};
