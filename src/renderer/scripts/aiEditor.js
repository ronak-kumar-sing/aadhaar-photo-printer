/* ═══════════════════════════════════════════════════════════════════
   AADHAAR PHOTO PRINTER — AI Editor Controller
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

const AIEditor = (() => {
  /* ──────────── State ──────────── */
  let _selectedPhotoId = null;
  let _enhancementCache = {}; // photoId -> params
  let _isEnhancing = false;

  /* ──────────── Init ──────────── */
  function init() {
    setupButtonHandlers();
    setupStrengthSlider();
    setupAutoEnhanceToggle();
    updateButtonState();
  }

  /* ──────────── Button Handlers ──────────── */
  function setupButtonHandlers() {
    document.getElementById('btn-ai-auto-enhance').addEventListener('click', () => {
      if (_selectedPhotoId) {
        handleAutoEnhance(_selectedPhotoId);
      } else if (window.appState && window.appState.photos.length > 0) {
        // Enhance all photos
        window.appState.photos.forEach((p) => handleAutoEnhance(p.id));
      }
    });

    document.getElementById('btn-ai-white-balance').addEventListener('click', () => {
      const photoId = _selectedPhotoId || (window.appState?.photos[0]?.id);
      if (photoId) handleWhiteBalance(photoId);
    });

    document.getElementById('btn-ai-sharpen').addEventListener('click', () => {
      const photoId = _selectedPhotoId || (window.appState?.photos[0]?.id);
      if (photoId) handleSharpen(photoId);
    });

    document.getElementById('btn-ai-whiten-bg').addEventListener('click', () => {
      const photoId = _selectedPhotoId || (window.appState?.photos[0]?.id);
      if (photoId) handleWhitenBackground(photoId);
    });
  }

  /* ──────────── Strength Slider ──────────── */
  function setupStrengthSlider() {
    const slider = document.getElementById('enhance-strength');
    const valueLabel = document.getElementById('enhance-strength-value');
    if (!slider || !valueLabel) return;

    slider.addEventListener('input', () => {
      valueLabel.textContent = `${slider.value}%`;
    });
  }

  /* ──────────── Auto Enhance Toggle ──────────── */
  function setupAutoEnhanceToggle() {
    const toggle = document.getElementById('chk-auto-enhance');
    if (!toggle) return;

    // Load saved preference
    const saved = localStorage.getItem('autoEnhanceOnUpload');
    if (saved !== null) {
      toggle.checked = saved === 'true';
    }

    toggle.addEventListener('change', () => {
      localStorage.setItem('autoEnhanceOnUpload', toggle.checked);
    });
  }

  function getAutoEnhanceEnabled() {
    const toggle = document.getElementById('chk-auto-enhance');
    return toggle ? toggle.checked : true;
  }

  /* ──────────── Selection ──────────── */
  function selectPhoto(photoId) {
    _selectedPhotoId = photoId;

    // Update UI
    document.querySelectorAll('.photo-card').forEach((card) => {
      card.classList.toggle('selected', card.id === `photo-card-${photoId}`);
    });

    updateButtonState();
  }

  function getSelectedPhotoId() {
    return _selectedPhotoId;
  }

  /* ──────────── Button State ──────────── */
  function updateButtonState() {
    const hasPhotos = window.appState && window.appState.photos.length > 0;
    const buttons = [
      'btn-ai-auto-enhance',
      'btn-ai-white-balance',
      'btn-ai-sharpen',
      'btn-ai-whiten-bg',
    ];

    buttons.forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !hasPhotos;
    });
  }

  /* ──────────── Enhancement Actions ──────────── */

  async function handleAutoEnhance(photoId) {
    if (_isEnhancing) return;
    const photo = findPhoto(photoId);
    if (!photo) return;

    _isEnhancing = true;
    window.updateProcessingStatus && window.updateProcessingStatus(true, 'AI Enhancing…');
    PhotoGrid.showProcessing(photoId);

    try {
      const api = window.electronAPI || {};

      // Check if we have cached params
      let params = _enhancementCache[photoId];
      let offline = false;

      if (!params) {
        if (api.enhancePhoto) {
          const result = await api.enhancePhoto(photo.originalPath);
          if (result && result.available && result.params) {
            params = result.params;
            _enhancementCache[photoId] = params;
            offline = !!result.offline;
          }
        }
      }

      // Apply strength modifier from slider
      const strengthSlider = document.getElementById('enhance-strength');
      const strength = strengthSlider ? (parseInt(strengthSlider.value, 10) / 100) : 0.5;

      if (params) {
        // Scale params by strength
        const scaledParams = scaleParamsByStrength(params, strength);
        await applyEnhancement(photoId, scaledParams);

        if (offline) {
          showOfflineBadge(true);
          UIManager.showToast('Enhanced (offline mode)', 'success');
        } else {
          showOfflineBadge(false);
          UIManager.showToast('AI Enhanced', 'success');
        }
      } else {
        // Try offline fallback
        await handleOfflineEnhance(photoId);
      }
    } catch (err) {
      console.error('[AIEditor] Auto enhance failed:', err);
      // Fallback to offline
      await handleOfflineEnhance(photoId);
    } finally {
      _isEnhancing = false;
      PhotoGrid.hideProcessing(photoId);
      window.updateProcessingStatus && window.updateProcessingStatus(false);
    }
  }

  async function handleWhiteBalance(photoId) {
    const photo = findPhoto(photoId);
    if (!photo || !photo.processedBuffer) return;

    PhotoGrid.showProcessing(photoId);
    window.updateProcessingStatus && window.updateProcessingStatus(true, 'White Balance…');

    try {
      const api = window.electronAPI || {};

      if (api.whiteBalancePhoto && photo.originalPath) {
        const result = await api.whiteBalancePhoto(photo.originalPath);
        if (result && result.success) {
          updatePhotoBuffer(photoId, result.buffer);
          UIManager.showToast('White balance applied', 'success');
        } else {
          throw new Error(result?.error || 'Failed');
        }
      } else {
        // Offline fallback via reprocess
        const wbResult = await api.enhancePhotoOffline(photo.processedBuffer);
        if (wbResult && wbResult.success && wbResult.params) {
          const params = { ...wbResult.params, brightness: 1, contrast: 1, saturation: 1, sharpen: 0 };
          await applyEnhancement(photoId, params);
          UIManager.showToast('White balance applied (offline)', 'success');
        }
      }
    } catch (err) {
      console.error('[AIEditor] White balance failed:', err);
      UIManager.showToast('White balance failed', 'error');
    } finally {
      PhotoGrid.hideProcessing(photoId);
      window.updateProcessingStatus && window.updateProcessingStatus(false);
    }
  }

  async function handleSharpen(photoId) {
    const photo = findPhoto(photoId);
    if (!photo || !photo.processedBuffer) return;

    PhotoGrid.showProcessing(photoId);
    window.updateProcessingStatus && window.updateProcessingStatus(true, 'Sharpening…');

    try {
      const api = window.electronAPI || {};

      if (api.sharpenPhoto && photo.originalPath) {
        const result = await api.sharpenPhoto(photo.originalPath);
        if (result && result.success) {
          updatePhotoBuffer(photoId, result.buffer);
          UIManager.showToast('Sharpened', 'success');
        } else {
          throw new Error(result?.error || 'Failed');
        }
      } else {
        // Reprocess with sharpen
        await applyEnhancement(photoId, { brightness: 1, contrast: 1, saturation: 1, sharpen: 0.8, normalize: false });
        UIManager.showToast('Sharpened (offline)', 'success');
      }
    } catch (err) {
      console.error('[AIEditor] Sharpen failed:', err);
      UIManager.showToast('Sharpen failed', 'error');
    } finally {
      PhotoGrid.hideProcessing(photoId);
      window.updateProcessingStatus && window.updateProcessingStatus(false);
    }
  }

  async function handleWhitenBackground(photoId) {
    const photo = findPhoto(photoId);
    if (!photo || !photo.processedBuffer) return;

    PhotoGrid.showProcessing(photoId);
    window.updateProcessingStatus && window.updateProcessingStatus(true, 'Whitening…');

    try {
      const api = window.electronAPI || {};
      const strengthSlider = document.getElementById('enhance-strength');
      const strength = strengthSlider ? (parseInt(strengthSlider.value, 10) / 100) : 0.5;

      if (api.whitenBackground && photo.originalPath) {
        const result = await api.whitenBackground(photo.originalPath, strength);
        if (result && result.success) {
          updatePhotoBuffer(photoId, result.buffer);
          UIManager.showToast('Background whitened', 'success');
        } else {
          throw new Error(result?.error || 'Failed');
        }
      } else {
        // Reprocess with background whitening
        await applyEnhancement(photoId, { brightness: 1, contrast: 1, saturation: 1, sharpen: 0, backgroundWhitening: strength, normalize: false });
        UIManager.showToast('Background whitened (offline)', 'success');
      }
    } catch (err) {
      console.error('[AIEditor] Background whiten failed:', err);
      UIManager.showToast('Background whiten failed', 'error');
    } finally {
      PhotoGrid.hideProcessing(photoId);
      window.updateProcessingStatus && window.updateProcessingStatus(false);
    }
  }

  async function handleOfflineEnhance(photoId) {
    const photo = findPhoto(photoId);
    if (!photo || !photo.processedBuffer) return;

    try {
      const api = window.electronAPI || {};
      if (api.enhancePhotoOffline) {
        const result = await api.enhancePhotoOffline(photo.processedBuffer);
        if (result && result.success) {
          updatePhotoBuffer(photoId, result.buffer);
          _enhancementCache[photoId] = result.params;
          showOfflineBadge(true);
          UIManager.showToast('Enhanced (offline mode)', 'success');
        } else {
          throw new Error(result?.error || 'Offline enhance failed');
        }
      }
    } catch (err) {
      console.error('[AIEditor] Offline enhance failed:', err);
      UIManager.showToast('Enhancement failed', 'error');
    }
  }

  /* ──────────── Core: Apply Enhancement ──────────── */
  async function applyEnhancement(photoId, params) {
    const photo = findPhoto(photoId);
    if (!photo || !photo.processedBuffer) return;

    const api = window.electronAPI || {};
    if (!api.reprocessImage) return;

    const result = await api.reprocessImage(photo.processedBuffer, {
      ...params,
      quality: 95,
      normalize: params.normalize !== false,
    });

    if (result && result.success) {
      updatePhotoBuffer(photoId, result.buffer);
      photo.enhancementParams = params;
    } else {
      throw new Error(result?.error || 'Reprocess failed');
    }
  }

  /* ──────────── Helpers ──────────── */
  function findPhoto(photoId) {
    if (!window.appState || !window.appState.photos) return null;
    return window.appState.photos.find((p) => p.id === photoId);
  }

  function updatePhotoBuffer(photoId, base64Buffer) {
    const photo = findPhoto(photoId);
    if (!photo) return;

    photo.processedBuffer = base64Buffer;
    photo.thumbnail = `data:image/jpeg;base64,${base64Buffer}`;
    PhotoGrid.updateThumbnail(photoId, photo.thumbnail);

    // Refresh preview
    if (typeof window.refreshPreview === 'function') {
      window.refreshPreview();
    }
  }

  function scaleParamsByStrength(params, strength) {
    // strength: 0 = subtle, 0.5 = normal, 1.0 = strong
    const neutralize = (val, neutral) => neutral + (val - neutral) * strength;

    return {
      brightness: neutralize(params.brightness, 1.0),
      contrast: neutralize(params.contrast, 1.0),
      saturation: neutralize(params.saturation, 1.0),
      sharpen: params.sharpen * strength,
      whiteBalance: params.whiteBalance || { r: 1, g: 1, b: 1 },
      backgroundWhitening: (params.backgroundWhitening || 0) * strength,
      normalize: params.normalize,
      quality: params.quality || 95,
    };
  }

  function showOfflineBadge(show) {
    const badge = document.getElementById('ai-enhance-offline-badge');
    if (badge) badge.hidden = !show;
  }

  function clearCache(photoId) {
    if (photoId) {
      delete _enhancementCache[photoId];
    } else {
      _enhancementCache = {};
    }
  }

  /* ──────────── Public API ──────────── */
  return {
    init,
    selectPhoto,
    getSelectedPhotoId,
    updateButtonState,
    handleAutoEnhance,
    handleWhiteBalance,
    handleSharpen,
    handleWhitenBackground,
    getAutoEnhanceEnabled,
    showOfflineBadge,
    clearCache,
  };
})();

// Expose globally
window.AIEditor = AIEditor;
