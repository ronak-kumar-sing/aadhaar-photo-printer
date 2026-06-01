/**
 * Aadhaar Photo Printer - Offline Enhancer
 *
 * Pure Sharp/histogram-based photo enhancement when Gemini AI is unavailable.
 * Provides auto-enhance, white balance, sharpening, and background whitening
 * using local image analysis — no API calls, works 100% offline.
 *
 * Quality preservation: all operations run in a single Sharp pipeline.
 */

'use strict';

const { applyEnhancementPipeline } = require('./imageProcessor');

// ============================================================================
// Public API
// ============================================================================

/**
 * Automatically enhances a photo using histogram analysis.
 * Detects exposure issues and applies conservative corrections.
 *
 * @param {Buffer} inputBuffer - Raw image buffer (any size)
 * @returns {Promise<{buffer: Buffer, width: number, height: number, format: string, params: Object}>}
 */
async function autoEnhanceOffline(inputBuffer) {
  const analysis = await analyzeHistogram(inputBuffer);

  const params = {
    brightness: analysis.brightness,
    contrast: analysis.contrast,
    saturation: analysis.saturation,
    sharpen: analysis.sharpen,
    normalize: true,
    quality: 95,
  };

  const result = await applyEnhancementPipeline(inputBuffer, params);
  return { ...result, params };
}

/**
 * Applies white balance correction using the gray-world assumption.
 *
 * @param {Buffer} inputBuffer - Raw image buffer
 * @returns {Promise<{buffer: Buffer, width: number, height: number, format: string}>}
 */
async function autoWhiteBalanceOffline(inputBuffer) {
  const wb = await computeGrayWorldWhiteBalance(inputBuffer);

  const params = {
    brightness: 1.0,
    contrast: 1.0,
    saturation: 1.0,
    sharpen: 0,
    whiteBalance: wb,
    normalize: false,
    quality: 95,
  };

  return await applyEnhancementPipeline(inputBuffer, params);
}

/**
 * Applies print-optimized sharpening.
 *
 * @param {Buffer} inputBuffer - Raw image buffer
 * @param {number} [sigma=0.8] - Sharpening strength
 * @returns {Promise<{buffer: Buffer, width: number, height: number, format: string}>}
 */
async function autoSharpenOffline(inputBuffer, sigma = 0.8) {
  const params = {
    brightness: 1.0,
    contrast: 1.0,
    saturation: 1.0,
    sharpen: sigma,
    normalize: false,
    quality: 95,
  };

  return await applyEnhancementPipeline(inputBuffer, params);
}

/**
 * Applies background whitening using a center-protected radial approach.
 * Lightens and desaturates edge/corner regions while preserving the center.
 *
 * @param {Buffer} inputBuffer - Raw image buffer
 * @param {number} [strength=0.5] - Whitening intensity 0-1
 * @returns {Promise<{buffer: Buffer, width: number, height: number, format: string}>}
 */
async function backgroundWhiteningOffline(inputBuffer, strength = 0.5) {
  const params = {
    brightness: 1.0,
    contrast: 1.0,
    saturation: 1.0,
    sharpen: 0,
    backgroundWhitening: strength,
    normalize: false,
    quality: 95,
  };

  return await applyEnhancementPipeline(inputBuffer, params);
}

// ============================================================================
// Histogram Analysis
// ============================================================================

/**
 * Analyzes image histogram to determine optimal correction parameters.
 *
 * @param {Buffer} inputBuffer
 * @returns {Promise<{brightness: number, contrast: number, saturation: number, sharpen: number}>}
 */
async function analyzeHistogram(inputBuffer) {
  // We need sharp here, but we can't import it directly to avoid circular deps
  // Instead, use the imageProcessor's getImageInfo or just require sharp locally
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    try {
      const path = require('path');
      sharp = require(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sharp'));
    } catch (fallbackErr) {
      // Return neutral params if sharp unavailable
      return { brightness: 1.0, contrast: 1.0, saturation: 1.0, sharpen: 0 };
    }
  }

  try {
    // Get raw pixel data for histogram analysis
    // We work on a downscaled version for speed
    const { data, info } = await sharp(inputBuffer)
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const pixelCount = info.width * info.height;

    // Compute per-channel histograms and statistics
    let sumR = 0, sumG = 0, sumB = 0;
    let minV = 255, maxV = 0;
    const luminance = [];

    for (let i = 0; i < pixelCount; i++) {
      const r = data[i * channels];
      const g = data[i * channels + 1];
      const b = data[i * channels + 2];
      const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

      sumR += r;
      sumG += g;
      sumB += b;
      minV = Math.min(minV, lum);
      maxV = Math.max(maxV, lum);
      luminance.push(lum);
    }

    luminance.sort((a, b) => a - b);
    const median = luminance[Math.floor(pixelCount / 2)];
    const p10 = luminance[Math.floor(pixelCount * 0.1)];
    const p90 = luminance[Math.floor(pixelCount * 0.9)];

    // Exposure detection
    let brightness = 1.0;
    if (median < 60) {
      brightness = 1.18; // Underexposed
    } else if (median < 100) {
      brightness = 1.08; // Slightly dark
    } else if (median > 200) {
      brightness = 0.92; // Overexposed
    } else if (median > 180) {
      brightness = 0.97; // Slightly bright
    }

    // Contrast detection
    const range = p90 - p10;
    let contrast = 1.0;
    if (range < 60) {
      contrast = 1.12; // Very flat
    } else if (range < 100) {
      contrast = 1.06; // Slightly flat
    } else if (range > 220) {
      contrast = 0.96; // Harsh
    }

    // Saturation detection via color variance
    const meanR = sumR / pixelCount;
    const meanG = sumG / pixelCount;
    const meanB = sumB / pixelCount;
    const avgMean = (meanR + meanG + meanB) / 3;
    const colorVariance = (Math.abs(meanR - avgMean) + Math.abs(meanG - avgMean) + Math.abs(meanB - avgMean)) / 3;

    let saturation = 1.0;
    if (colorVariance < 8) {
      saturation = 1.15; // Very desaturated
    } else if (colorVariance < 15) {
      saturation = 1.08; // Slightly dull
    } else if (colorVariance > 50) {
      saturation = 0.92; // Oversaturated
    }

    // Sharpness estimation: higher contrast images need less sharpening
    let sharpen = 0.6;
    if (range > 180) {
      sharpen = 0.4; // Already sharp
    } else if (range < 80) {
      sharpen = 0.9; // Soft/blurry
    }

    return {
      brightness: round2(brightness),
      contrast: round2(contrast),
      saturation: round2(saturation),
      sharpen: round2(sharpen),
    };
  } catch (err) {
    console.warn('[OfflineEnhancer] Histogram analysis failed:', err.message);
    return { brightness: 1.0, contrast: 1.0, saturation: 1.0, sharpen: 0 };
  }
}

/**
 * Computes white balance multipliers using the gray-world assumption.
 * Assumes the average color of the scene is gray (equal R, G, B).
 *
 * @param {Buffer} inputBuffer
 * @returns {Promise<{r: number, g: number, b: number}>}
 */
async function computeGrayWorldWhiteBalance(inputBuffer) {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    try {
      const path = require('path');
      sharp = require(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sharp'));
    } catch (fallbackErr) {
      return { r: 1.0, g: 1.0, b: 1.0 };
    }
  }

  try {
    const { data, info } = await sharp(inputBuffer)
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const pixelCount = info.width * info.height;

    let sumR = 0, sumG = 0, sumB = 0;
    for (let i = 0; i < pixelCount; i++) {
      sumR += data[i * channels];
      sumG += data[i * channels + 1];
      sumB += data[i * channels + 2];
    }

    const meanR = sumR / pixelCount;
    const meanG = sumG / pixelCount;
    const meanB = sumB / pixelCount;

    // Avoid division by zero
    const safeMeanR = meanR < 1 ? 1 : meanR;
    const safeMeanB = meanB < 1 ? 1 : meanB;

    // Gray world: scale channels so their means are equal
    // Use green as reference (usually most reliable)
    let r = meanG / safeMeanR;
    let g = 1.0;
    let b = meanG / safeMeanB;

    // Clamp to reasonable range
    r = Math.max(0.5, Math.min(2.0, r));
    b = Math.max(0.5, Math.min(2.0, b));

    return { r: round2(r), g: 1.0, b: round2(b) };
  } catch (err) {
    console.warn('[OfflineEnhancer] White balance computation failed:', err.message);
    return { r: 1.0, g: 1.0, b: 1.0 };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  autoEnhanceOffline,
  autoWhiteBalanceOffline,
  autoSharpenOffline,
  backgroundWhiteningOffline,
};
