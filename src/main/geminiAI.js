/**
 * Aadhaar Photo Printer - Gemini AI Integration
 *
 * Uses Google's Gemini Vision API (gemini-2.0-flash model) to analyze photos
 * for Aadhaar/passport suitability. Provides structured feedback on:
 * - Face visibility and position
 * - Background quality
 * - Lighting conditions
 * - Orientation correctness
 * - Overall suitability score
 *
 * IMPORTANT: This module is entirely optional. The application functions
 * fully without AI. All API calls are wrapped in try-catch with timeouts.
 * If the API key is missing or the network is unavailable, graceful
 * fallback responses are returned.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// --- Gemini SDK Loading ---
let GoogleGenerativeAI;
try {
  ({ GoogleGenerativeAI } = require('@google/generative-ai'));
} catch (err) {
  console.warn(
    '[GeminiAI] @google/generative-ai package not installed. AI features will be unavailable.'
  );
  GoogleGenerativeAI = null;
}

// ============================================================================
// Constants
// ============================================================================

const MODEL_NAME = 'gemini-2.0-flash';
const API_TIMEOUT_MS = 10000; // 10 seconds

/**
 * The analysis prompt sent to Gemini Vision.
 * Asks for structured JSON output for reliable parsing.
 */
const ANALYSIS_PROMPT = `You are a photo quality analyzer for Indian Aadhaar card and passport photos.
Analyze the provided photo and respond ONLY with a valid JSON object (no markdown, no code fences) with exactly these fields:

{
  "faceVisible": "yes" or "no",
  "facePosition": "centered" or "left" or "right" or "top" or "bottom",
  "backgroundQuality": "plain" or "busy",
  "lightingQuality": "good" or "dark" or "overexposed",
  "correctOrientation": "yes" or "rotated",
  "suitabilityScore": <number from 1 to 10>,
  "suggestions": ["suggestion 1", "suggestion 2"]
}

Rules:
- suitabilityScore: 10 = perfect ID photo, 1 = completely unsuitable
- suggestions: array of short, actionable improvement tips (max 5)
- If the image is not a person's photo, set faceVisible to "no" and suitabilityScore to 1
- Be strict: Aadhaar photos require a plain white/light background, front-facing, neutral expression`;

/**
 * The enhancement prompt sent to Gemini Vision.
 * Asks for specific numeric editing parameters for photo enhancement.
 */
const ENHANCEMENT_PROMPT = `You are an expert photo editor specializing in passport and ID photo enhancement.
Analyze the provided photo and respond ONLY with a valid JSON object (no markdown, no code fences) with exactly these fields:

{
  "brightness": <number 0.7 to 1.3, default 1.0>,
  "contrast": <number 0.7 to 1.3, default 1.0>,
  "saturation": <number 0.5 to 1.5, default 1.0>,
  "sharpen": <number 0 to 2.0, default 0.5>,
  "whiteBalance": { "r": <number 0.7 to 1.3>, "g": <number 0.7 to 1.3>, "b": <number 0.7 to 1.3> },
  "backgroundWhitening": <number 0 to 1.0, default 0.0>,
  "reasoning": "<brief explanation of adjustments>"
}

Rules for each parameter:
- brightness: < 1.0 if overexposed/too bright, > 1.0 if underexposed/too dark. 1.0 = no change
- contrast: > 1.0 for flat/low-contrast photos, < 1.0 for harsh/over-contrasty photos. 1.0 = no change
- saturation: > 1.0 for dull/gray photos, < 1.0 for oversaturated photos. 1.0 = no change
- sharpen: higher (> 1.0) for soft/blurry photos, 0 for already sharp photos. Range 0-2.0
- whiteBalance: RGB multipliers to neutralize color casts. All 1.0 = no cast. > 1.0 = boost channel, < 1.0 = reduce channel
- backgroundWhitening: > 0 if background is dark, colored, or not plain white. 0.3-0.6 for light backgrounds, 0.7-1.0 for dark/colored backgrounds. 0 = no whitening
- Be conservative. Small adjustments (±0.1) are better than dramatic changes.
- For Aadhaar/passport photos: background should be plain white/light, face well-lit, natural skin tones.`;

// ============================================================================
// GeminiPhotoAnalyzer Class
// ============================================================================

class GeminiPhotoAnalyzer {
  /**
   * @param {string} [apiKey=''] - Gemini API key (can be set later via setApiKey)
   */
  constructor(apiKey = '') {
    this._apiKey = apiKey || '';
    this._genAI = null;
    this._model = null;

    if (this._apiKey && GoogleGenerativeAI) {
      this._initializeClient();
    }
  }

  // --------------------------------------------------------------------------
  // Public Methods
  // --------------------------------------------------------------------------

  /**
   * Analyzes a photo for Aadhaar/passport suitability using Gemini Vision.
   *
   * @param {string} filePath - Absolute path to the image file
   * @returns {Promise<Object>} - Analysis result or { available: false, reason: '...' }
   */
  async analyzePhoto(filePath) {
    // Pre-flight checks
    if (!GoogleGenerativeAI) {
      return {
        available: false,
        reason: 'Gemini AI SDK is not installed. Install @google/generative-ai to enable AI features.',
      };
    }

    if (!this._apiKey) {
      return {
        available: false,
        reason: 'No API key configured. Set your Gemini API key in Settings to enable AI analysis.',
      };
    }

    if (!this._model) {
      this._initializeClient();
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return {
        available: false,
        reason: `Image file not found: ${filePath}`,
      };
    }

    try {
      // Read the image file
      const imageBuffer = fs.readFileSync(filePath);
      const base64Image = imageBuffer.toString('base64');

      // Determine MIME type from extension
      const mimeType = getMimeType(filePath);

      // Build the request
      const imagePart = {
        inlineData: {
          data: base64Image,
          mimeType,
        },
      };

      // Call Gemini with timeout
      const result = await withTimeout(
        this._model.generateContent([ANALYSIS_PROMPT, imagePart]),
        API_TIMEOUT_MS
      );

      const response = result.response;
      const text = response.text();

      // Parse the JSON response
      const analysis = parseAnalysisResponse(text);

      return {
        available: true,
        ...analysis,
      };
    } catch (error) {
      console.error('[GeminiAI] analyzePhoto error:', error.message);

      // Classify the error for the user
      const reason = classifyError(error);
      return { available: false, reason };
    }
  }

  /**
   * Sets or updates the Gemini API key and validates it.
   *
   * @param {string} key - New API key
   * @returns {Promise<{valid: boolean, error?: string}>}
   */
  async setApiKey(key) {
    if (!GoogleGenerativeAI) {
      return {
        valid: false,
        error: 'Gemini AI SDK is not installed. Install @google/generative-ai first.',
      };
    }

    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      return { valid: false, error: 'API key cannot be empty.' };
    }

    const trimmedKey = key.trim();

    try {
      // Initialize with the new key
      const testAI = new GoogleGenerativeAI(trimmedKey);
      const testModel = testAI.getGenerativeModel({ model: MODEL_NAME });

      // Send a minimal test request to validate the key
      const result = await withTimeout(
        testModel.generateContent('Respond with exactly: OK'),
        API_TIMEOUT_MS
      );

      const text = result.response.text().trim();

      // If we got a response, the key is valid
      this._apiKey = trimmedKey;
      this._initializeClient();

      return { valid: true };
    } catch (error) {
      console.error('[GeminiAI] setApiKey validation error:', error.message);

      // Check for specific API key errors
      if (error.message && error.message.includes('API_KEY_INVALID')) {
        return { valid: false, error: 'Invalid API key. Please check and try again.' };
      }

      if (error.message && error.message.includes('PERMISSION_DENIED')) {
        return { valid: false, error: 'API key does not have permission to use Gemini. Check your Google Cloud project settings.' };
      }

      if (error.message && error.message.includes('timeout')) {
        return { valid: false, error: 'Connection timed out. Please check your internet connection.' };
      }

      return { valid: false, error: `Validation failed: ${error.message}` };
    }
  }

  /**
   * Analyzes a photo for optimal editing parameters using Gemini Vision.
   *
   * @param {string} filePath - Absolute path to the image file
   * @returns {Promise<{available: boolean, params?: Object, reasoning?: string, reason?: string}>}
   */
  async analyzeEnhancement(filePath) {
    if (!GoogleGenerativeAI) {
      return {
        available: false,
        reason: 'Gemini AI SDK is not installed.',
      };
    }

    if (!this._apiKey) {
      return {
        available: false,
        reason: 'No API key configured.',
      };
    }

    if (!this._model) {
      this._initializeClient();
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return {
        available: false,
        reason: `Image file not found: ${filePath}`,
      };
    }

    try {
      const imageBuffer = fs.readFileSync(filePath);
      const base64Image = imageBuffer.toString('base64');
      const mimeType = getMimeType(filePath);

      const imagePart = {
        inlineData: {
          data: base64Image,
          mimeType,
        },
      };

      const result = await withTimeout(
        this._model.generateContent([ENHANCEMENT_PROMPT, imagePart]),
        API_TIMEOUT_MS
      );

      const response = result.response;
      const text = response.text();
      const parsed = parseEnhancementResponse(text);

      return {
        available: true,
        params: parsed,
        reasoning: parsed.reasoning || 'AI-enhanced',
      };
    } catch (error) {
      console.error('[GeminiAI] analyzeEnhancement error:', error.message);
      const reason = classifyError(error);
      return { available: false, reason };
    }
  }

  /**
   * Returns the current AI service status.
   *
   * @returns {{configured: boolean, online: boolean}}
   */
  getStatus() {
    return {
      configured: !!(this._apiKey && this._model),
      online: !!(GoogleGenerativeAI && this._apiKey),
      sdkInstalled: !!GoogleGenerativeAI,
    };
  }

  // --------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------

  /**
   * Initializes (or re-initializes) the Gemini client with the current API key.
   */
  _initializeClient() {
    try {
      this._genAI = new GoogleGenerativeAI(this._apiKey);
      this._model = this._genAI.getGenerativeModel({ model: MODEL_NAME });
    } catch (err) {
      console.error('[GeminiAI] Failed to initialize client:', err.message);
      this._genAI = null;
      this._model = null;
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Wraps a promise with a timeout. Rejects if the promise doesn't resolve
 * within the specified duration.
 *
 * @param {Promise} promise    - The promise to wrap
 * @param {number} timeoutMs   - Timeout in milliseconds
 * @returns {Promise}
 */
function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Request timed out after ${timeoutMs / 1000} seconds.`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Parses the raw text response from Gemini into a structured analysis object.
 * Handles cases where the model wraps JSON in markdown code fences.
 *
 * @param {string} text - Raw response text
 * @returns {Object} - Parsed analysis object
 */
function parseAnalysisResponse(text) {
  // Default fallback structure
  const fallback = {
    faceVisible: 'unknown',
    facePosition: 'unknown',
    backgroundQuality: 'unknown',
    lightingQuality: 'unknown',
    correctOrientation: 'unknown',
    suitabilityScore: 0,
    suggestions: ['Could not parse AI response. Please try again.'],
    rawResponse: text,
  };

  if (!text || typeof text !== 'string') return fallback;

  try {
    // Strip markdown code fences if present (```json ... ```)
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

    const parsed = JSON.parse(cleaned);

    // Validate and normalize the response
    return {
      faceVisible: normalizeEnum(parsed.faceVisible, ['yes', 'no'], 'unknown'),
      facePosition: normalizeEnum(parsed.facePosition, ['centered', 'left', 'right', 'top', 'bottom'], 'unknown'),
      backgroundQuality: normalizeEnum(parsed.backgroundQuality, ['plain', 'busy'], 'unknown'),
      lightingQuality: normalizeEnum(parsed.lightingQuality, ['good', 'dark', 'overexposed'], 'unknown'),
      correctOrientation: normalizeEnum(parsed.correctOrientation, ['yes', 'rotated'], 'unknown'),
      suitabilityScore: clamp(parseInt(parsed.suitabilityScore, 10) || 0, 0, 10),
      suggestions: Array.isArray(parsed.suggestions)
        ? parsed.suggestions.filter((s) => typeof s === 'string').slice(0, 5)
        : [],
    };
  } catch (parseErr) {
    console.warn('[GeminiAI] Failed to parse analysis response:', parseErr.message);
    return fallback;
  }
}

/**
 * Normalizes a value to one of the allowed enum values.
 *
 * @param {any} value       - Input value
 * @param {string[]} allowed - Allowed string values
 * @param {string} fallback  - Default if value is not in allowed list
 * @returns {string}
 */
function normalizeEnum(value, allowed, fallback) {
  if (typeof value !== 'string') return fallback;
  const lower = value.toLowerCase().trim();
  return allowed.includes(lower) ? lower : fallback;
}

/**
 * Clamps a number between min and max (inclusive).
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Determines the MIME type from a file extension.
 *
 * @param {string} filePath
 * @returns {string}
 */
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
  };
  return mimeMap[ext] || 'image/jpeg';
}

/**
 * Parses the raw enhancement response from Gemini into structured editing parameters.
 *
 * @param {string} text - Raw response text
 * @returns {Object} - Parsed enhancement parameters
 */
function parseEnhancementResponse(text) {
  const fallback = {
    brightness: 1.0,
    contrast: 1.0,
    saturation: 1.0,
    sharpen: 0,
    whiteBalance: { r: 1.0, g: 1.0, b: 1.0 },
    backgroundWhitening: 0,
    reasoning: 'Could not parse AI response. Using defaults.',
  };

  if (!text || typeof text !== 'string') return fallback;

  try {
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

    const parsed = JSON.parse(cleaned);

    // Clamp and validate all numeric parameters
    const clamped = {
      brightness: clamp(parseFloat(parsed.brightness) || 1.0, 0.7, 1.3),
      contrast: clamp(parseFloat(parsed.contrast) || 1.0, 0.7, 1.3),
      saturation: clamp(parseFloat(parsed.saturation) || 1.0, 0.5, 1.5),
      sharpen: clamp(parseFloat(parsed.sharpen) || 0, 0, 2.0),
      whiteBalance: parseWhiteBalance(parsed.whiteBalance),
      backgroundWhitening: clamp(parseFloat(parsed.backgroundWhitening) || 0, 0, 1.0),
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'AI-enhanced',
    };

    return clamped;
  } catch (parseErr) {
    console.warn('[GeminiAI] Failed to parse enhancement response:', parseErr.message);
    return fallback;
  }
}

/**
 * Parses and validates white balance multipliers.
 *
 * @param {any} wb
 * @returns {{r: number, g: number, b: number}}
 */
function parseWhiteBalance(wb) {
  if (!wb || typeof wb !== 'object') {
    return { r: 1.0, g: 1.0, b: 1.0 };
  }

  return {
    r: clamp(parseFloat(wb.r) || 1.0, 0.7, 1.3),
    g: clamp(parseFloat(wb.g) || 1.0, 0.7, 1.3),
    b: clamp(parseFloat(wb.b) || 1.0, 0.7, 1.3),
  };
}

/**
 * Classifies an error into a user-friendly reason string.
 *
 * @param {Error} error
 * @returns {string}
 */
function classifyError(error) {
  const msg = error.message || '';

  if (msg.includes('timeout')) {
    return 'Request timed out. The AI service may be slow or your internet connection is unstable.';
  }
  if (msg.includes('API_KEY_INVALID') || msg.includes('UNAUTHENTICATED')) {
    return 'Invalid API key. Please update your Gemini API key in Settings.';
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
    return 'API quota exceeded. Please wait a moment and try again, or check your Google Cloud billing.';
  }
  if (msg.includes('SAFETY')) {
    return 'The photo was blocked by safety filters. Please try a different photo.';
  }
  if (msg.includes('fetch') || msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED')) {
    return 'Network error. Please check your internet connection.';
  }
  if (msg.includes('PERMISSION_DENIED')) {
    return 'Permission denied. Your API key may not have access to the Gemini API.';
  }

  return `AI analysis failed: ${msg}`;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = { GeminiPhotoAnalyzer };
