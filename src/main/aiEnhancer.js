/**
 * Aadhaar Photo Printer - AI Enhancement Engine
 *
 * Coordinates Gemini Vision AI analysis with Sharp image processing
 * to provide one-click photo enhancement. All edits run in a single
 * Sharp pipeline to preserve pixel quality.
 *
 * Features:
 * - analyzeForEnhancement(): Gemini suggests optimal editing parameters
 * - applyEnhancements(): Single-pass Sharp pipeline with all AI-guided edits
 * - Graceful offline fallback via offlineEnhancer
 */

'use strict';

const fs = require('fs');
const { applyEnhancementPipeline } = require('./imageProcessor');
const { autoEnhanceOffline, autoWhiteBalanceOffline, autoSharpenOffline, backgroundWhiteningOffline } = require('./offlineEnhancer');

// ============================================================================
// Public API
// ============================================================================

/**
 * Analyzes a photo using Gemini AI and returns optimal editing parameters.
 * Falls back to offline histogram analysis if Gemini is unavailable.
 *
 * @param {string} filePath - Absolute path to the image
 * @param {GeminiPhotoAnalyzer} geminiAnalyzer - Instance from geminiAI.js
 * @returns {Promise<{available: boolean, params?: Object, offline?: boolean, reason?: string}>}
 */
async function analyzeForEnhancement(filePath, geminiAnalyzer) {
  if (!geminiAnalyzer) {
    return { available: false, reason: 'AI analyzer not initialized' };
  }

  const status = geminiAnalyzer.getStatus();
  if (!status.configured || !status.online) {
    return { available: false, reason: 'AI not configured or offline' };
  }

  if (!filePath || !fs.existsSync(filePath)) {
    return { available: false, reason: `File not found: ${filePath}` };
  }

  try {
    const result = await geminiAnalyzer.analyzeEnhancement(filePath);

    if (result.available) {
      return {
        available: true,
        params: result.params,
        reasoning: result.reasoning,
      };
    }

    // Gemini returned unavailable — try offline
    return await analyzeOffline(filePath);
  } catch (error) {
    console.error('[AIEnhancer] Analysis failed:', error.message);
    return await analyzeOffline(filePath);
  }
}

/**
 * Offline analysis fallback using histogram analysis.
 *
 * @param {string} filePath
 * @returns {Promise<{available: boolean, offline: true, params: Object}>}
 */
async function analyzeOffline(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const { autoEnhanceOffline } = require('./offlineEnhancer');
    const { params } = await autoEnhanceOffline(buffer);
    return {
      available: true,
      offline: true,
      params,
      reasoning: 'Offline histogram-based enhancement',
    };
  } catch (err) {
    console.error('[AIEnhancer] Offline analysis failed:', err.message);
    // Return safe neutral params
    return {
      available: true,
      offline: true,
      params: {
        brightness: 1.05,
        contrast: 1.05,
        saturation: 1.0,
        sharpen: 0.5,
        normalize: true,
        quality: 95,
      },
      reasoning: 'Conservative safe defaults (offline fallback failed)',
    };
  }
}

/**
 * Applies AI-guided enhancements to an image buffer in a single Sharp pipeline.
 *
 * @param {Buffer} inputBuffer - Raw image buffer
 * @param {Object} params - Enhancement parameters from analyzeForEnhancement
 * @returns {Promise<{buffer: Buffer, width: number, height: number, format: string, originalSize: number, processedSize: number}>}
 */
async function applyEnhancements(inputBuffer, params = {}) {
  const originalSize = inputBuffer.length;
  const result = await applyEnhancementPipeline(inputBuffer, params);
  return {
    ...result,
    originalSize,
    processedSize: result.buffer.length,
  };
}

/**
 * Applies white balance correction to an image buffer.
 * Uses AI-guided RGB multipliers if available, otherwise falls back to gray-world.
 *
 * @param {Buffer} inputBuffer
 * @param {Object} [wbParams] - Optional { r, g, b } multipliers
 * @returns {Promise<{buffer: Buffer, width: number, height: number, format: string}>}
 */
async function applyWhiteBalance(inputBuffer, wbParams = null) {
  if (wbParams && wbParams.r != null && wbParams.g != null && wbParams.b != null) {
    return await applyEnhancementPipeline(inputBuffer, {
      brightness: 1.0,
      contrast: 1.0,
      saturation: 1.0,
      sharpen: 0,
      whiteBalance: wbParams,
      normalize: false,
      quality: 95,
    });
  }

  // Fallback to offline gray-world
  return await autoWhiteBalanceOffline(inputBuffer);
}

/**
 * Applies print-optimized sharpening.
 *
 * @param {Buffer} inputBuffer
 * @param {number} [sigma] - Sharpening strength (auto-detected if omitted)
 * @returns {Promise<{buffer: Buffer, width: number, height: number, format: string}>}
 */
async function applySharpening(inputBuffer, sigma = 0.8) {
  return await applyEnhancementPipeline(inputBuffer, {
    brightness: 1.0,
    contrast: 1.0,
    saturation: 1.0,
    sharpen: sigma,
    normalize: false,
    quality: 95,
  });
}

/**
 * Applies background whitening to an image buffer.
 *
 * @param {Buffer} inputBuffer
 * @param {number} [strength=0.5] - Whitening intensity 0-1
 * @returns {Promise<{buffer: Buffer, width: number, height: number, format: string}>}
 */
async function applyBackgroundWhitening(inputBuffer, strength = 0.5) {
  return await applyEnhancementPipeline(inputBuffer, {
    brightness: 1.0,
    contrast: 1.0,
    saturation: 1.0,
    sharpen: 0,
    backgroundWhitening: strength,
    normalize: false,
    quality: 95,
  });
}

/**
 * Convenience: fully auto-enhance a photo file, choosing AI or offline path.
 *
 * @param {string} filePath
 * @param {GeminiPhotoAnalyzer} geminiAnalyzer
 * @returns {Promise<{success: boolean, buffer?: Buffer, params?: Object, offline?: boolean, error?: string}>}
 */
async function autoEnhancePhoto(filePath, geminiAnalyzer) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const buffer = fs.readFileSync(filePath);
    const analysis = await analyzeForEnhancement(filePath, geminiAnalyzer);

    if (!analysis.available) {
      // Even if analysis says not available, try offline enhancement
      const offlineResult = await autoEnhanceOffline(buffer);
      return {
        success: true,
        buffer: offlineResult.buffer,
        params: offlineResult.params,
        offline: true,
      };
    }

    const result = await applyEnhancements(buffer, analysis.params);
    return {
      success: true,
      buffer: result.buffer,
      params: analysis.params,
      offline: !!analysis.offline,
    };
  } catch (error) {
    console.error('[AIEnhancer] autoEnhancePhoto failed:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  analyzeForEnhancement,
  applyEnhancements,
  applyWhiteBalance,
  applySharpening,
  applyBackgroundWhitening,
  autoEnhancePhoto,
};
