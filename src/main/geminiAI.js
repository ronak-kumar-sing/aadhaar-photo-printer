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
