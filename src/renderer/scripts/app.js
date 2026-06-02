/* ═══════════════════════════════════════════════════════════════════
   AADHAAR PHOTO PRINTER — Main Application Controller
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ──────────────────── Photo Size Presets ──────────────────── */
const PHOTO_SIZE_PRESETS = [
  { id: 'passport',      name: 'Passport (35×45 mm)',   mmW: 35,  mmH: 45,  pxW: 413,  pxH: 531 },
  { id: 'passport_us',   name: 'Passport US (50×50 mm)', mmW: 50,  mmH: 50,  pxW: 591,  pxH: 591 },
  { id: 'visa_schengen', name: 'Visa Schengen (35×45)',  mmW: 35,  mmH: 45,  pxW: 413,  pxH: 531 },
  { id: 'pan_card',      name: 'PAN Card (25×35 mm)',    mmW: 25,  mmH: 35,  pxW: 295,  pxH: 413 },
  { id: 'stamp',         name: 'Stamp (20×25 mm)',       mmW: 20,  mmH: 25,  pxW: 236,  pxH: 295 },
  { id: 'id_card',       name: 'ID Card (35×45 mm)',     mmW: 35,  mmH: 45,  pxW: 413,  pxH: 531 },
  { id: 'wallet',        name: 'Wallet (63×88 mm)',      mmW: 63,  mmH: 88,  pxW: 744,  pxH: 1039 },
  { id: 'print_3r',      name: '3R Print (89×127 mm)',   mmW: 89,  mmH: 127, pxW: 1050, pxH: 1500 },
  { id: 'print_4r',      name: '4R Print (102×152 mm)',  mmW: 102, mmH: 152, pxW: 1200, pxH: 1800 },
  { id: 'print_5r',      name: '5R Print (127×178 mm)',  mmW: 127, mmH: 178, pxW: 1500, pxH: 2100 },
];

/* ──────────────────── State ──────────────────── */
const appState = {
  photos: [],
  // Each photo: { id, name, originalPath, thumbnail, processedBuffer, aiAnalysis, fileSize, originalBuffer, enhancementParams }
  settings: {
    shopName: 'Aadhaar Print Shop',
    pricePerPhoto: 10,
    apiKey: '',
    language: 'en',
    darkMode: false,
  },
  dailyCount: 0,
  selectedQuality: 'standard',
  layoutMode: 'grid',          // 'grid' | 'aadhaar-card'
  layoutCols: 4,
  layoutRows: 3,
  currentPage: 1,
  zoomLevel: 100,
  isProcessing: false,
  isPrinting: false,
  showCutGuides: false,
  copies: 1,                   // How many copies of each photo to print
  printerName: '',
  photoSizeId: 'passport',     // Selected photo size preset ID
  aadhaarFront: null,          // { id, name, originalPath, thumbnail, processedBuffer }
  aadhaarBack: null,           // { id, name, originalPath, thumbnail, processedBuffer }
  aadhaarCardPositions: {
    front: { xPct: 15, yPct: 10, wPct: 40, hPct: 25 },
    back:  { xPct: 15, yPct: 55, wPct: 40, hPct: 25 },
  },
};

/* ──────────────────── Helpers ──────────────────── */
function uid() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function truncate(str, len = 18) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

/** Returns the currently selected photo size preset */
function getPhotoSizePreset() {
  return PHOTO_SIZE_PRESETS.find((p) => p.id === appState.photoSizeId) || PHOTO_SIZE_PRESETS[0];
}

/** Calculates optimal cols × rows for A4 based on photo dimensions in mm */
function calculateOptimalLayout(mmW, mmH) {
  const A4_W = 210;
  const A4_H = 297;
  const MARGIN = 10;
  const GAP = 3;
  const usableW = A4_W - 2 * MARGIN;
  const usableH = A4_H - 2 * MARGIN;

  // Try both orientations (portrait and landscape photo on portrait A4)
  const layouts = [];

  // Portrait orientation: photo width along A4 width
  const colsP = Math.floor((usableW + GAP) / (mmW + GAP));
  const rowsP = Math.floor((usableH + GAP) / (mmH + GAP));
  if (colsP > 0 && rowsP > 0) layouts.push({ cols: colsP, rows: rowsP, total: colsP * rowsP });

  // Landscape orientation: photo width along A4 height (rotated)
  const colsL = Math.floor((usableW + GAP) / (mmH + GAP));
  const rowsL = Math.floor((usableH + GAP) / (mmW + GAP));
  if (colsL > 0 && rowsL > 0) layouts.push({ cols: colsL, rows: rowsL, total: colsL * rowsL });

  // Pick the layout that fits the most photos
  const best = layouts.sort((a, b) => b.total - a.total)[0];
  if (best) return { cols: best.cols, rows: best.rows };

  // Fallback: 1×1
  return { cols: 1, rows: 1 };
}

/** Updates the photo size display text in the right panel */
function updatePhotoSizeDisplay() {
  const preset = getPhotoSizePreset();
  const mmEl = document.getElementById('photo-size-mm');
  const pxEl = document.getElementById('photo-size-px');
  if (!mmEl || !pxEl) return;

  if (appState.layoutMode === 'aadhaar-card') {
    mmEl.textContent = 'Custom size (draggable)';
    pxEl.textContent = 'Resize and position on the preview';
    return;
  }

  mmEl.textContent = `${preset.mmW} mm × ${preset.mmH} mm`;
  pxEl.textContent = `(${preset.pxW} × ${preset.pxH} px @ 300 DPI)`;
}

/** Re-processes all current photos with the new target dimensions */
async function reprocessAllPhotos() {
  if (appState.photos.length === 0) return;
  const preset = getPhotoSizePreset();

  appState.isProcessing = true;
  updateProcessingStatus(true, 'Re-processing…');

  for (const photo of appState.photos) {
    if (!photo.originalPath) continue;
    try {
      PhotoGrid.showProcessing(photo.id);
      const result = await api().processImage(photo.originalPath, {
        targetWidth: preset.pxW,
        targetHeight: preset.pxH,
      });
      if (result && result.success) {
        photo.processedBuffer = result.buffer || null;
        photo.thumbnail = `data:image/jpeg;base64,${photo.processedBuffer}`;
        PhotoGrid.updateThumbnail(photo.id, photo.thumbnail, photo.aiAnalysis);
      }
      PhotoGrid.hideProcessing(photo.id);
    } catch (err) {
      console.warn('Re-process failed for', photo.name, err.message);
      PhotoGrid.hideProcessing(photo.id);
    }
  }

  appState.isProcessing = false;
  updateProcessingStatus(false);
  refreshPreview();
}

/** Handles photo size selection change */
function handlePhotoSizeChange(sizeId) {
  const preset = PHOTO_SIZE_PRESETS.find((p) => p.id === sizeId);
  if (!preset) return;

  appState.photoSizeId = sizeId;

  // Calculate optimal A4 layout for this size
  const layout = calculateOptimalLayout(preset.mmW, preset.mmH);
  appState.layoutCols = layout.cols;
  appState.layoutRows = layout.rows;

  // Update UI inputs
  const colsInput = document.getElementById('input-cols');
  const rowsInput = document.getElementById('input-rows');
  if (colsInput) colsInput.value = layout.cols;
  if (rowsInput) rowsInput.value = layout.rows;

  // Update display
  updatePhotoSizeDisplay();
  updatePhotoSizeBadge();

  // Re-process existing photos with new dimensions
  if (appState.photos.length > 0) {
    reprocessAllPhotos();
  } else {
    refreshPreview();
  }

  // Persist selection
  if (api().setSettings) {
    api().setSettings({ photoSizeId: sizeId }).catch(() => {});
  }
}

/** Updates the small badge next to the photo size label */
function updatePhotoSizeBadge() {
  const preset = getPhotoSizePreset();
  const badge = document.getElementById('photo-size-badge');
  if (badge) {
    badge.textContent = `${preset.mmW}×${preset.mmH}`;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

/** Safe accessor for the Electron IPC bridge */
function api() {
  return window.electronAPI || {};
}

/* ──────────────────── Init ──────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadDailyCount();
  await loadPrinterList();
  applyTheme(appState.settings.darkMode);
  setupUploadZone();
  setupAadhaarUploads();
  setupKeyboardShortcuts();
  setupButtonHandlers();
  setupLayoutMode();
  setupPrintOptions();
  setupPrinterSelect();
  setupQualitySelector();
  setupZoomControls();
  setupPageNavigation();
  setupAadhaarDragResize();
  setupCopiesInput();
  if (window.AIEditor) AIEditor.init();
  loadRecentPhotos();
  updateFooter();
  updatePhotoSizeDisplay();
  refreshPreview();

  // Hide splash screen after initialization
  const splash = document.getElementById('splash-overlay');
  if (splash) {
    splash.classList.add('hiding');
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
  }
});

/* ──────────────────── Settings ──────────────────── */
async function loadSettings() {
  try {
    const res = api().getSettings ? await api().getSettings() : null;
    if (res && res.success && res.settings) {
      Object.assign(appState.settings, res.settings);
      if (res.settings.geminiApiKey) {
        appState.settings.apiKey = res.settings.geminiApiKey;
      }
      // Load new settings
      if (res.settings.layoutMode) appState.layoutMode = res.settings.layoutMode;
      if (res.settings.layoutCols != null) appState.layoutCols = res.settings.layoutCols;
      if (res.settings.layoutRows != null) appState.layoutRows = res.settings.layoutRows;
      if (res.settings.showCutGuides != null) appState.showCutGuides = res.settings.showCutGuides;
      if (res.settings.copies != null) appState.copies = res.settings.copies;
      if (res.settings.printerName != null) appState.printerName = res.settings.printerName;
      if (res.settings.photoSizeId) appState.photoSizeId = res.settings.photoSizeId;
      if (res.settings.aadhaarCardPositions) {
        appState.aadhaarCardPositions = res.settings.aadhaarCardPositions;
      }
    }
  } catch (err) {
    console.warn('Failed to load settings:', err);
  }

  // Reflect in UI
  const badge = document.getElementById('header-shop-badge');
  if (badge) badge.textContent = appState.settings.shopName || 'Aadhaar Print Shop';

  // Reflect print options
  document.getElementById('chk-cut-guides').checked = appState.showCutGuides;
  document.getElementById('input-cols').value = appState.layoutCols;
  document.getElementById('input-rows').value = appState.layoutRows;
  const copiesInput = document.getElementById('input-copies');
  if (copiesInput) copiesInput.value = appState.copies;

  // Setup photo size selector with restored value
  setupPhotoSizeSelector();
  updatePhotoSizeDisplay();
  updatePhotoSizeBadge();

  // Update layout mode UI
  const modeSelect = document.getElementById('layout-mode-select');
  if (modeSelect) modeSelect.value = appState.layoutMode;
  updateLayoutModeUI();
}

async function saveSettings() {
  const shopName = document.getElementById('input-shop-name').value.trim() || 'Aadhaar Print Shop';
  const price = parseInt(document.getElementById('input-price').value, 10) || 10;
  const apiKey = document.getElementById('input-api-key').value.trim();

  appState.settings.shopName = shopName;
  appState.settings.pricePerPhoto = price;
  appState.settings.apiKey = apiKey;

  const activeLang = document.querySelector('.lang-pill.active');
  if (activeLang) appState.settings.language = activeLang.dataset.lang;

  try {
    if (api().setSettings) {
      const payload = {
        shopName: appState.settings.shopName,
        pricePerPhoto: appState.settings.pricePerPhoto,
        geminiApiKey: appState.settings.apiKey,
        language: appState.settings.language,
        darkMode: appState.settings.darkMode,
        layoutMode: appState.layoutMode,
        layoutCols: appState.layoutCols,
        layoutRows: appState.layoutRows,
        showCutGuides: appState.showCutGuides,
        copies: appState.copies,
        printerName: appState.printerName,
        photoSizeId: appState.photoSizeId,
        aadhaarCardPositions: appState.aadhaarCardPositions,
      };
      await api().setSettings(payload);
    }
    document.getElementById('header-shop-badge').textContent = shopName;
    UIManager.hideModal('settings-modal');
    UIManager.showToast('Settings saved', 'success');
    updateFooter();
  } catch (err) {
    UIManager.showToast('Failed to save settings', 'error');
  }
}

/* ──────────────────── Daily Count ──────────────────── */
async function loadDailyCount() {
  try {
    const res = api().getDailyCount ? await api().getDailyCount() : null;
    appState.dailyCount = (res && res.success) ? res.count : 0;
  } catch (err) {
    console.warn('Failed to load daily count:', err);
    appState.dailyCount = 0;
  }
}

/* ──────────────────── Theme ──────────────────── */
function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

/* ──────────────────── Upload Zone ──────────────────── */
function setupUploadZone() {
  const zone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  const addBtn = document.getElementById('btn-add-photos');

  if (!zone || !fileInput) return;

  UIManager.setupDragDropZone(zone, handleDroppedFiles);

  zone.addEventListener('click', (e) => {
    if (e.target === addBtn || addBtn.contains(e.target)) return;
    if (appState.layoutMode === 'aadhaar-card') return;
    fileInput.click();
  });
  zone.addEventListener('keydown', (e) => {
    if (appState.layoutMode === 'aadhaar-card') return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) {
      handleFilesSelected(Array.from(fileInput.files));
      fileInput.value = '';
    }
  });
}

/* ──────────────────── Aadhaar Card Uploads ──────────────────── */
function setupAadhaarUploads() {
  const frontInput = document.getElementById('file-input-front');
  const backInput = document.getElementById('file-input-back');
  const frontBtn = document.getElementById('btn-upload-front');
  const backBtn = document.getElementById('btn-upload-back');

  if (frontBtn) frontBtn.addEventListener('click', (e) => { e.stopPropagation(); frontInput.click(); });
  if (backBtn) backBtn.addEventListener('click', (e) => { e.stopPropagation(); backInput.click(); });

  if (frontInput) {
    frontInput.addEventListener('change', () => {
      if (frontInput.files.length) {
        handleAadhaarFile(frontInput.files[0], 'front');
        frontInput.value = '';
      }
    });
  }
  if (backInput) {
    backInput.addEventListener('change', () => {
      if (backInput.files.length) {
        handleAadhaarFile(backInput.files[0], 'back');
        backInput.value = '';
      }
    });
  }
}

async function handleAadhaarFile(file, side) {
  const id = uid();
  const name = file.name || 'photo';

  const photo = {
    id,
    name,
    originalPath: file.path || '',
    thumbnail: null,
    processedBuffer: null,
  };

  try {
    const dataUrl = await readFileAsDataURL(file);
    photo.thumbnail = dataUrl;

    // Try file path first, fallback to buffer processing for drag-and-drop
    const sizeOpts = getPhotoSizePreset();
    const processOptions = {
      targetWidth: sizeOpts.pxW,
      targetHeight: sizeOpts.pxH,
    };
    if (api().processImage && file.path) {
      const result = await api().processImage(file.path, processOptions);
      if (result && result.success) {
        photo.processedBuffer = result.buffer || null;
      }
    } else if (api().processImageFromBuffer && dataUrl) {
      // Extract base64 from data URL and process via buffer
      const base64 = dataUrl.split(',')[1];
      if (base64) {
        const result = await api().processImageFromBuffer(base64, processOptions);
        if (result && result.success) {
          photo.processedBuffer = result.buffer || null;
        }
      }
    }

    if (photo.processedBuffer) {
      photo.thumbnail = `data:image/jpeg;base64,${photo.processedBuffer}`;
    }
  } catch (err) {
    console.error(`Error processing ${side}:`, err);
    UIManager.showToast(`Failed to process ${side} photo`, 'error');
    return;
  }

  if (side === 'front') appState.aadhaarFront = photo;
  else appState.aadhaarBack = photo;

  refreshPreview();
  updatePrintButton();
  UIManager.showToast(`${side === 'front' ? 'Front' : 'Back'} photo added`, 'success');
}

async function handleDroppedFiles(files) {
  if (appState.layoutMode === 'aadhaar-card') {
    const imageFiles = Array.from(files).filter((f) => f.type && f.type.startsWith('image/'));
    if (imageFiles.length > 0) {
      if (!appState.aadhaarFront) await handleAadhaarFile(imageFiles[0], 'front');
      else if (!appState.aadhaarBack) await handleAadhaarFile(imageFiles[0], 'back');
    }
    return;
  }
  await handleFilesSelected(files);
}

async function handleFilesSelected(files) {
  if (!files || files.length === 0) return;

  appState.isProcessing = true;
  updateProcessingStatus(true);

  const total = files.length;
  let processed = 0;

  for (const file of files) {
    const id = uid();
    const name = file.name || (typeof file === 'string' ? file.split(/[\\/]/).pop() : 'photo');
    const fileSize = file.size || 0;

    const photo = {
      id,
      name,
      originalPath: file.path || '',
      thumbnail: null,
      processedBuffer: null,
      originalBuffer: null,
      enhancementParams: null,
      aiAnalysis: null,
      fileSize,
    };

    appState.photos.push(photo);
    PhotoGrid.addPhoto(photo);

    try {
      const dataUrl = await readFileAsDataURL(file);
      photo.thumbnail = dataUrl;

      // Try file path first, fallback to buffer processing for drag-and-drop
      const sizeOpts = getPhotoSizePreset();
      const processOptions = {
        targetWidth: sizeOpts.pxW,
        targetHeight: sizeOpts.pxH,
      };
      let result = null;
      if (api().processImage && file.path) {
        result = await api().processImage(file.path, processOptions);
      } else if (api().processImageFromBuffer && dataUrl) {
        const base64 = dataUrl.split(',')[1];
        if (base64) {
          result = await api().processImageFromBuffer(base64, processOptions);
        }
      }

      if (result && result.success) {
        photo.processedBuffer = result.buffer || null;
        photo.originalBuffer = result.buffer || null; // Save original for reset
        if (photo.processedBuffer) {
          photo.thumbnail = `data:image/jpeg;base64,${photo.processedBuffer}`;
          if (api().saveToRecent) {
            try {
              await api().saveToRecent({ buffer: photo.processedBuffer, fileName: photo.name });
              loadRecentPhotos();
            } catch (recentErr) {
              console.warn('Failed to save to recent:', recentErr);
            }
          }
        }
      }

      PhotoGrid.hideProcessing(id);
      PhotoGrid.updateThumbnail(id, photo.thumbnail, photo.aiAnalysis);

      // ── Auto-enhance after initial processing ──
      if (window.AIEditor && window.AIEditor.getAutoEnhanceEnabled && photo.processedBuffer) {
        try {
          await window.AIEditor.handleAutoEnhance(id);
        } catch (enhanceErr) {
          console.warn('Auto-enhance failed for', name, enhanceErr.message);
          // Non-fatal: photo is still usable without enhancement
        }
      }
    } catch (err) {
      console.error('Error processing', name, err);
      UIManager.showToast(`Failed to process ${truncate(name)}`, 'error');
      removePhotoById(id);
    }

    processed++;
  }

  appState.isProcessing = false;
  updateProcessingStatus(false);
  refreshPreview();
  updatePrintButton();
  updatePhotoCountBadge();
  if (window.AIEditor) window.AIEditor.updateButtonState();

  UIManager.showToast(`${processed} photo${processed > 1 ? 's' : ''} added`, 'success');
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    if (typeof file === 'string') { resolve(null); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/* ──────────────────── Photo Management ──────────────────── */
function handleRemovePhoto(id) {
  removePhotoById(id);
  PhotoGrid.removePhoto(id);
  refreshPreview();
  updatePrintButton();
  updatePhotoCountBadge();
}

function removePhotoById(id) {
  const idx = appState.photos.findIndex((p) => p.id === id);
  if (idx !== -1) appState.photos.splice(idx, 1);
}

function handleClearAll() {
  appState.photos = [];
  appState.aadhaarFront = null;
  appState.aadhaarBack = null;
  appState.currentPage = 1;
  PhotoGrid.renderPhotoList([]);
  if (window.AIEditor) {
    window.AIEditor.clearCache();
    window.AIEditor.updateButtonState();
  }
  refreshPreview();
  updatePrintButton();
  updatePhotoCountBadge();
  UIManager.showToast('All photos cleared', 'info');
}

/* ──────────────────── Shared Validation ──────────────────── */
function validatePhotosBeforeAction(actionName) {
  const isGridEmpty = appState.layoutMode === 'grid' && appState.photos.length === 0;
  const isCardEmpty = appState.layoutMode === 'aadhaar-card' && !appState.aadhaarFront && !appState.aadhaarBack;

  if (isGridEmpty || isCardEmpty) {
    UIManager.showToast(`Add photos before ${actionName}`, 'warning');
    return false;
  }
  return true;
}

/* ──────────────────── Build Print Photos List ──────────────────── */
function buildPrintPhotosList() {
  const copies = Math.max(1, appState.copies || 1);

  if (appState.layoutMode === 'grid') {
    // Repeat each photo 'copies' times
    const repeated = [];
    for (const p of appState.photos) {
      for (let i = 0; i < copies; i++) {
        repeated.push({
          buffer: p.processedBuffer || '',
          name: p.name || 'photo.jpg',
        });
      }
    }
    return repeated;
  } else {
    // Aadhaar card mode
    const cardPhotos = [];
    if (appState.aadhaarFront) {
      cardPhotos.push({ buffer: appState.aadhaarFront.processedBuffer || '', name: 'front.jpg', side: 'front' });
    }
    if (appState.aadhaarBack) {
      cardPhotos.push({ buffer: appState.aadhaarBack.processedBuffer || '', name: 'back.jpg', side: 'back' });
    }
    return cardPhotos;
  }
}

/* ──────────────────── Print ──────────────────── */
async function handlePrint() {
  if (!validatePhotosBeforeAction('printing')) return;
  if (appState.isPrinting) return;

  // Overflow guard
  const totalPhotos = appState.layoutMode === 'grid'
    ? appState.photos.length * Math.max(1, appState.copies || 1)
    : ((appState.aadhaarFront ? 1 : 0) + (appState.aadhaarBack ? 1 : 0));
  if (totalPhotos > 200) {
    UIManager.showToast('Too many photos to print. Maximum 200 total.', 'warning');
    return;
  }

  appState.isPrinting = true;
  updateProcessingStatus(true, 'Printing…');

  try {
    const customerName = document.getElementById('input-customer-name').value.trim();
    const customerPhone = document.getElementById('input-customer-phone').value.trim();

    let printResult = null;
    if (api().print) {
      const printPhotos = buildPrintPhotosList();
      const preset = getPhotoSizePreset();
      const printOptions = {
        layout: `${appState.layoutCols}x${appState.layoutRows}`,
        layoutMode: appState.layoutMode,
        quality: appState.selectedQuality,
        copies: 1,
        showCutGuides: appState.showCutGuides,
        printerName: appState.printerName || undefined,
        photoWidthMM: preset.mmW,
        photoHeightMM: preset.mmH,
      };

      if (appState.layoutMode === 'aadhaar-card') {
        printOptions.aadhaarCardPositions = appState.aadhaarCardPositions;
      }

      printResult = await api().print(printPhotos, printOptions);
      if (!printResult || !printResult.success) {
        throw new Error(printResult?.error || 'Print failed or was cancelled');
      }
    }

    // Increment daily count
    const countToAdd = appState.layoutMode === 'grid'
      ? appState.photos.length * Math.max(1, appState.copies || 1)
      : ((appState.aadhaarFront ? 1 : 0) + (appState.aadhaarBack ? 1 : 0));

    if (api().incrementPrintCount) {
      const res = await api().incrementPrintCount(countToAdd);
      if (res && res.success) appState.dailyCount = res.count;
    } else {
      appState.dailyCount += countToAdd;
    }

    // Save customer record
    if (api().saveCustomer && (customerName || customerPhone)) {
      try {
        await api().saveCustomer({
          name: customerName || 'Walk-in',
          phone: customerPhone || '',
          photoCount: countToAdd,
          date: new Date().toISOString(),
        });
      } catch (custErr) {
        console.warn('Failed to save customer:', custErr);
      }
    }

    UIManager.showSuccessAnimation();
    updateFooter();
  } catch (err) {
    console.error('Print failed', err);
    UIManager.showToast('Printing failed. Please try again.', 'error');
  } finally {
    appState.isPrinting = false;
    updateProcessingStatus(false);
  }
}

/* ──────────────────── Export PDF ──────────────────── */
async function handleExportPDF() {
  if (!validatePhotosBeforeAction('exporting')) return;

  try {
    if (api().printToPDF && api().showSaveDialog) {
      const dialogResult = await api().showSaveDialog({
        title: 'Export Photos to PDF',
        defaultPath: 'aadhaar_photos.pdf',
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      });

      if (dialogResult && !dialogResult.canceled && dialogResult.filePath) {
        const printPhotos = buildPrintPhotosList();
        const preset = getPhotoSizePreset();
        const printOptions = {
          layout: `${appState.layoutCols}x${appState.layoutRows}`,
          layoutMode: appState.layoutMode,
          showCutGuides: appState.showCutGuides,
          printerName: appState.printerName || undefined,
          photoWidthMM: preset.mmW,
          photoHeightMM: preset.mmH,
        };

        if (appState.layoutMode === 'aadhaar-card') {
          printOptions.aadhaarCardPositions = appState.aadhaarCardPositions;
        }

        const result = await api().printToPDF(printPhotos, dialogResult.filePath, printOptions);
        if (result && result.success) {
          UIManager.showToast(`PDF saved: ${truncate(dialogResult.filePath, 40)}`, 'success', 4000);
        } else {
          throw new Error(result ? result.error : 'Failed to generate PDF');
        }
      }
    } else {
      UIManager.showToast('PDF export not available', 'info');
    }
  } catch (err) {
    console.error('PDF export error:', err);
    UIManager.showToast('PDF export failed', 'error');
  }
}

/* ──────────────────── Receipt ──────────────────── */
function handlePrintReceipt() {
  const customerName = document.getElementById('input-customer-name').value.trim();
  const customerPhone = document.getElementById('input-customer-phone').value.trim();

  let count;
  if (appState.layoutMode === 'grid') {
    count = appState.photos.length * Math.max(1, appState.copies || 1);
  } else {
    count = (appState.aadhaarFront ? 1 : 0) + (appState.aadhaarBack ? 1 : 0);
  }

  if (count === 0) {
    UIManager.showToast('Add photos first', 'warning');
    return;
  }

  ReceiptManager.generateReceipt({
    shopName: appState.settings.shopName,
    customerName: customerName || 'Walk-in',
    customerPhone: customerPhone || '—',
    photoCount: count,
    pricePerPhoto: appState.settings.pricePerPhoto,
    date: new Date(),
  });

  UIManager.showModal('receipt-modal');
}

/* ──────────────────── Backup ──────────────────── */
async function handleBackup() {
  let count;
  if (appState.layoutMode === 'grid') {
    count = appState.photos.length * Math.max(1, appState.copies || 1);
  } else {
    count = (appState.aadhaarFront ? 1 : 0) + (appState.aadhaarBack ? 1 : 0);
  }

  if (count === 0) {
    UIManager.showToast('No photos to back up', 'warning');
    return;
  }
  try {
    if (api().backupPhotos) {
      const customerName = document.getElementById('input-customer-name').value.trim();
      const items = [];
      if (appState.layoutMode === 'grid') {
        for (const p of appState.photos) {
          for (let i = 0; i < Math.max(1, appState.copies || 1); i++) {
            items.push({ buffer: p.processedBuffer || '', name: p.name || 'photo.jpg' });
          }
        }
      } else {
        if (appState.aadhaarFront) items.push({ buffer: appState.aadhaarFront.processedBuffer || '', name: 'front.jpg' });
        if (appState.aadhaarBack) items.push({ buffer: appState.aadhaarBack.processedBuffer || '', name: 'back.jpg' });
      }
      const backupData = { items, customerName: customerName || 'Walk-in' };
      await api().backupPhotos(backupData);
      UIManager.showToast('Photos backed up successfully', 'success');
    } else {
      UIManager.showToast('Backup not available', 'info');
    }
  } catch (err) {
    console.error('Backup failed:', err);
    UIManager.showToast('Backup failed', 'error');
  }
}

/* ──────────────────── AI Analyze ──────────────────── */
async function handleAIAnalyze() {
  const photosToAnalyze = appState.layoutMode === 'grid' ? appState.photos : [appState.aadhaarFront, appState.aadhaarBack].filter(Boolean);
  if (photosToAnalyze.length === 0) {
    UIManager.showToast('Add photos first', 'warning');
    return;
  }
  if (!appState.settings.apiKey) {
    UIManager.showToast('Set your Gemini API key in Settings', 'info');
    return;
  }

  UIManager.showToast('AI analysis started…', 'info');
  updateProcessingStatus(true, 'AI Analyzing…');

  let successCount = 0;
  try {
    if (api().analyzePhoto) {
      for (const photo of photosToAnalyze) {
        if (!photo || !photo.originalPath) continue;

        try {
          PhotoGrid.showProcessing(photo.id);
          const result = await api().analyzePhoto(photo.originalPath);
          PhotoGrid.hideProcessing(photo.id);

          if (result && result.available) {
            const score = result.suitabilityScore || 0;
            const quality = score >= 8 ? 'good' : (score >= 5 ? 'warning' : 'poor');
            let suggestionsText = '';
            if (result.suggestions && result.suggestions.length > 0) {
              suggestionsText = ` Suggestions: ${result.suggestions.join(', ')}`;
            }
            const summary = `Score: ${score}/10.${suggestionsText}`;

            photo.aiAnalysis = { quality, summary, ...result };
            PhotoGrid.updateThumbnail(photo.id, photo.thumbnail, photo.aiAnalysis);
            successCount++;
          } else {
            console.warn(`AI analysis unavailable for ${photo.name}:`, result ? result.reason : 'unknown');
          }
        } catch (photoErr) {
          console.error(`AI analysis failed for ${photo.name}:`, photoErr);
          PhotoGrid.hideProcessing(photo.id);
        }
      }

      if (successCount > 0) {
        UIManager.showToast('AI analysis complete', 'success');
      } else {
        UIManager.showToast('AI analysis completed with no results. Check your API key or connection.', 'warning');
      }
    } else {
      UIManager.showToast('AI analysis not available', 'info');
    }
  } catch (err) {
    console.error('AI Analyze failed:', err);
    UIManager.showToast('AI analysis failed', 'error');
  } finally {
    updateProcessingStatus(false);
  }
}

/* ──────────────────── Recent Photos ──────────────────── */
async function loadRecentPhotos() {
  try {
    const result = api().getRecentPhotos ? await api().getRecentPhotos() : { photos: [] };
    PhotoGrid.renderRecentPhotos(result?.photos || []);
  } catch (err) {
    console.warn('Failed to load recent photos:', err);
  }
}

/* ──────────────────── Printer List ──────────────────── */
async function loadPrinterList() {
  try {
    const res = api().getPrinters ? await api().getPrinters() : null;
    const select = document.getElementById('printer-select');
    if (!select || !res || !res.success) return;

    // Keep first option
    const defaultOpt = select.options[0];
    select.innerHTML = '';
    select.appendChild(defaultOpt);

    const printers = res.printers || [];
    printers.forEach((printer) => {
      const opt = document.createElement('option');
      opt.value = printer.name || '';
      opt.textContent = printer.name || 'Unknown Printer';
      if (printer.name === appState.printerName) opt.selected = true;
      select.appendChild(opt);
    });
  } catch (err) {
    console.warn('Failed to load printers:', err);
  }
}

/* ──────────────────── UI Helpers ──────────────────── */
function getPhotosForPreview() {
  // For grid mode, repeat photos according to copies to fill the grid
  if (appState.layoutMode !== 'grid' || appState.photos.length === 0) {
    return appState.photos;
  }
  const copies = Math.max(1, appState.copies || 1);
  const repeated = [];
  for (const p of appState.photos) {
    for (let i = 0; i < copies; i++) {
      repeated.push(p);
    }
  }
  return repeated;
}

function refreshPreview() {
  const previewEl = document.getElementById('a4-preview');
  if (previewEl) previewEl.style.transform = `scale(${appState.zoomLevel / 100})`;

  if (appState.layoutMode === 'aadhaar-card') {
    PagePreview.render([], null, 1, 'aadhaar-card', {
      front: appState.aadhaarFront,
      back: appState.aadhaarBack,
    }, appState.aadhaarCardPositions);
    updatePageIndicator();
    return;
  }

  const layout = { cols: appState.layoutCols, rows: appState.layoutRows };
  const previewPhotos = getPhotosForPreview();
  PagePreview.render(previewPhotos, layout, appState.currentPage, 'grid');
  updatePageIndicator();
}

function updatePrintButton() {
  const btn = document.getElementById('btn-print');
  const hasPhotos = appState.layoutMode === 'grid'
    ? appState.photos.length > 0
    : (appState.aadhaarFront || appState.aadhaarBack);
  btn.disabled = !hasPhotos;
  btn.classList.toggle('ready-pulse', hasPhotos);
}

function updatePhotoCountBadge() {
  const badge = document.getElementById('photo-count-badge');
  const clearBtn = document.getElementById('btn-clear-all');
  const count = appState.photos.length;
  badge.textContent = count;
  badge.hidden = count === 0;
  clearBtn.hidden = count === 0;
}

function updateProcessingStatus(busy, text) {
  const dot = document.getElementById('footer-status-dot');
  const statusText = document.getElementById('footer-status-text');
  if (busy) {
    dot.className = 'status-dot status-busy';
    statusText.textContent = text || 'Processing…';
  } else {
    dot.className = 'status-dot status-ready';
    statusText.textContent = 'Ready';
  }
}

function updateFooter() {
  document.getElementById('footer-count-value').textContent = appState.dailyCount;

  const photoCount = appState.dailyCount;
  const inkPct = clamp(100 - photoCount * 0.3, 0, 100);
  document.getElementById('footer-ink-value').textContent = `~${Math.round(inkPct)}%`;

  const aiDot = document.getElementById('footer-ai-dot');
  const aiText = document.getElementById('footer-ai-text');
  if (appState.settings.apiKey) {
    aiDot.className = 'status-dot status-ready';
    aiText.textContent = 'AI: Ready';
  } else {
    aiDot.className = 'status-dot status-inactive';
    aiText.textContent = 'AI: Off';
  }
}

function updatePageIndicator() {
  if (appState.layoutMode === 'aadhaar-card') {
    document.getElementById('page-indicator').hidden = true;
    return;
  }
  const layout = { cols: appState.layoutCols, rows: appState.layoutRows };
  const previewPhotos = getPhotosForPreview();
  const perPage = PagePreview.getMaxPhotos(layout);
  const totalPages = Math.max(1, Math.ceil(previewPhotos.length / perPage));
  const indicator = document.getElementById('page-indicator');
  const text = document.getElementById('page-indicator-text');
  const prevBtn = document.getElementById('btn-prev-page');
  const nextBtn = document.getElementById('btn-next-page');

  indicator.hidden = totalPages <= 1;
  appState.currentPage = clamp(appState.currentPage, 1, totalPages);
  text.textContent = `Page ${appState.currentPage} of ${totalPages}`;
  prevBtn.disabled = appState.currentPage <= 1;
  nextBtn.disabled = appState.currentPage >= totalPages;
}

/* ──────────────────── Photo Size Selector ──────────────────── */
function setupPhotoSizeSelector() {
  const select = document.getElementById('photo-size-select');
  if (!select) return;

  // Populate dropdown
  select.innerHTML = '';
  PHOTO_SIZE_PRESETS.forEach((preset) => {
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent = preset.name;
    if (preset.id === appState.photoSizeId) opt.selected = true;
    select.appendChild(opt);
  });

  select.addEventListener('change', () => {
    handlePhotoSizeChange(select.value);
  });
}

function updatePhotoSizeDisplay() {
  const mmEl = document.getElementById('photo-size-mm');
  const pxEl = document.getElementById('photo-size-px');
  if (!mmEl || !pxEl) return;

  if (appState.layoutMode === 'aadhaar-card') {
    mmEl.textContent = 'Custom size (draggable)';
    pxEl.textContent = 'Resize and position on the preview';
    return;
  }

  const preset = getPhotoSizePreset();
  mmEl.textContent = `${preset.mmW} mm × ${preset.mmH} mm`;
  pxEl.textContent = `(${preset.pxW} × ${preset.pxH} px @ 300 DPI)`;
}

function updateLayoutModeUI() {
  const isAadhaar = appState.layoutMode === 'aadhaar-card';

  // Show/hide grid controls
  document.getElementById('grid-controls').hidden = isAadhaar;

  // Show/hide photo list section
  document.getElementById('photo-list-section').hidden = isAadhaar;

  // Show/hide upload buttons
  document.getElementById('btn-add-photos').hidden = isAadhaar;
  document.getElementById('aadhaar-upload-buttons').hidden = !isAadhaar;

  // Show/hide copies control
  const copiesSection = document.getElementById('copies-section');
  if (copiesSection) copiesSection.hidden = isAadhaar;

  // Update upload text
  document.getElementById('upload-heading-text').textContent = isAadhaar ? 'Aadhaar Card' : 'Upload Photos';
  document.getElementById('upload-zone-title').textContent = isAadhaar ? 'Upload Front & Back' : 'Drop Aadhaar / Passport photos';

  updatePhotoSizeDisplay();
  refreshPreview();
  updatePrintButton();
}

/* ──────────────────── Button Handlers ──────────────────── */
function setupButtonHandlers() {
  // Dark mode
  document.getElementById('btn-dark-mode').addEventListener('click', () => {
    appState.settings.darkMode = !appState.settings.darkMode;
    UIManager.toggleDarkMode(appState.settings.darkMode);
    if (api().setSettings) {
      api().setSettings({ darkMode: appState.settings.darkMode });
    }
  });

  // About
  document.getElementById('btn-about').addEventListener('click', showAboutDialog);

  // Size Reference (info button next to dropdown)
  const btnSizeRef = document.getElementById('btn-size-reference');
  if (btnSizeRef) {
    btnSizeRef.addEventListener('click', () => {
      UIManager.showModal('size-reference-modal');
    });
  }
  const btnCloseSizeRef = document.getElementById('btn-close-size-ref');
  if (btnCloseSizeRef) {
    btnCloseSizeRef.addEventListener('click', () => {
      UIManager.hideModal('size-reference-modal');
    });
  }

  // Settings
  document.getElementById('btn-settings').addEventListener('click', () => {
    populateSettingsForm();
    UIManager.showModal('settings-modal');
  });
  document.getElementById('btn-close-settings').addEventListener('click', () => UIManager.hideModal('settings-modal'));
  document.getElementById('settings-form').addEventListener('submit', (e) => { e.preventDefault(); saveSettings(); });

  // API key toggle
  document.getElementById('btn-toggle-api-key').addEventListener('click', () => {
    const inp = document.getElementById('input-api-key');
    const eyeOn = document.querySelector('#btn-toggle-api-key .icon-eye');
    const eyeOff = document.querySelector('#btn-toggle-api-key .icon-eye-off');
    const isPassword = inp.type === 'password';
    inp.type = isPassword ? 'text' : 'password';
    eyeOn.style.display = isPassword ? 'none' : 'block';
    eyeOff.style.display = isPassword ? 'block' : 'none';
  });

  // Language pills
  document.querySelectorAll('.lang-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.lang-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
    });
  });

  // Print
  document.getElementById('btn-print').addEventListener('click', handlePrint);

  // Actions
  document.getElementById('btn-export-pdf').addEventListener('click', handleExportPDF);
  document.getElementById('btn-print-receipt').addEventListener('click', handlePrintReceipt);
  document.getElementById('btn-backup').addEventListener('click', handleBackup);
  document.getElementById('btn-ai-analyze').addEventListener('click', handleAIAnalyze);

  // Clear all
  document.getElementById('btn-clear-all').addEventListener('click', () => {
    const hasPhotos = appState.photos.length > 0 || appState.aadhaarFront || appState.aadhaarBack;
    if (!hasPhotos) {
      handleClearAll();
      return;
    }
    if (confirm('Clear all photos? This cannot be undone.')) {
      handleClearAll();
    }
  });

  // Receipt modal
  document.getElementById('btn-close-receipt').addEventListener('click', () => UIManager.hideModal('receipt-modal'));
  document.getElementById('btn-receipt-print').addEventListener('click', () => ReceiptManager.printReceipt());

  // About modal
  document.getElementById('btn-close-about').addEventListener('click', () => UIManager.hideModal('about-modal'));

  // Recent photos toggle
  document.getElementById('btn-toggle-recent').addEventListener('click', () => {
    const btn = document.getElementById('btn-toggle-recent');
    const container = document.getElementById('recent-photos-container');
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    container.hidden = expanded;
  });
}

function populateSettingsForm() {
  document.getElementById('input-shop-name').value = appState.settings.shopName || '';
  document.getElementById('input-price').value = appState.settings.pricePerPhoto || 10;
  document.getElementById('input-api-key').value = appState.settings.apiKey || '';

  document.querySelectorAll('.lang-pill').forEach((p) => {
    p.classList.toggle('active', p.dataset.lang === appState.settings.language);
  });
}

/* ──────────────────── Layout Mode ──────────────────── */
function setupLayoutMode() {
  const modeSelect = document.getElementById('layout-mode-select');
  const colsInput = document.getElementById('input-cols');
  const rowsInput = document.getElementById('input-rows');

  modeSelect.addEventListener('change', () => {
    appState.layoutMode = modeSelect.value;
    appState.currentPage = 1;
    updateLayoutModeUI();
  });

  const updateGrid = () => {
    appState.layoutCols = clamp(parseInt(colsInput.value, 10) || 4, 1, 10);
    appState.layoutRows = clamp(parseInt(rowsInput.value, 10) || 3, 1, 10);
    colsInput.value = appState.layoutCols;
    rowsInput.value = appState.layoutRows;
    appState.currentPage = 1;
    updatePhotoSizeDisplay();
    refreshPreview();
  };

  colsInput.addEventListener('change', updateGrid);
  rowsInput.addEventListener('change', updateGrid);
}

/* ──────────────────── Copies Input ──────────────────── */
function setupCopiesInput() {
  const copiesInput = document.getElementById('input-copies');
  if (!copiesInput) return;

  copiesInput.addEventListener('change', () => {
    appState.copies = clamp(parseInt(copiesInput.value, 10) || 1, 1, 100);
    copiesInput.value = appState.copies;

    // Overflow guard: max 200 total photo slots
    const total = appState.photos.length * appState.copies;
    if (appState.photos.length > 0 && total > 200) {
      appState.copies = Math.max(1, Math.floor(200 / appState.photos.length));
      copiesInput.value = appState.copies;
      UIManager.showToast('Too many photos. Maximum 200 total (photos × copies).', 'warning');
    }

    refreshPreview();
  });
}

/* ──────────────────── Print Options ──────────────────── */
function setupPrintOptions() {
  const cutGuidesChk = document.getElementById('chk-cut-guides');

  cutGuidesChk.addEventListener('change', () => {
    appState.showCutGuides = cutGuidesChk.checked;
  });
}

/* ──────────────────── Printer Select ──────────────────── */
function setupPrinterSelect() {
  const select = document.getElementById('printer-select');
  select.addEventListener('change', () => {
    appState.printerName = select.value;
  });
}

/* ──────────────────── Quality Selector ──────────────────── */
function setupQualitySelector() {
  document.querySelectorAll('.quality-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.quality-pill').forEach((p) => {
        p.classList.remove('active');
        p.setAttribute('aria-checked', 'false');
      });
      pill.classList.add('active');
      pill.setAttribute('aria-checked', 'true');
      appState.selectedQuality = pill.dataset.quality;
    });
  });
}

/* ──────────────────── Zoom ──────────────────── */
function setupZoomControls() {
  const preview = document.getElementById('a4-preview');
  const label = document.getElementById('zoom-level');

  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    appState.zoomLevel = clamp(appState.zoomLevel + 10, 50, 200);
    preview.style.transform = `scale(${appState.zoomLevel / 100})`;
    label.textContent = `${appState.zoomLevel}%`;
  });

  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    appState.zoomLevel = clamp(appState.zoomLevel - 10, 50, 200);
    preview.style.transform = `scale(${appState.zoomLevel / 100})`;
    label.textContent = `${appState.zoomLevel}%`;
  });
}

/* ──────────────────── Page Navigation ──────────────────── */
function setupPageNavigation() {
  document.getElementById('btn-prev-page').addEventListener('click', () => {
    if (appState.currentPage > 1) {
      appState.currentPage--;
      refreshPreview();
    }
  });
  document.getElementById('btn-next-page').addEventListener('click', () => {
    const layout = { cols: appState.layoutCols, rows: appState.layoutRows };
    const previewPhotos = getPhotosForPreview();
    const totalPages = Math.ceil(previewPhotos.length / PagePreview.getMaxPhotos(layout));
    if (appState.currentPage < totalPages) {
      appState.currentPage++;
      refreshPreview();
    }
  });
}

/* ──────────────────── Aadhaar Card Drag & Resize ──────────────────── */
function setupAadhaarDragResize() {
  const previewEl = document.getElementById('a4-preview');
  if (!previewEl) return;

  let activeSlot = null;
  let activeHandle = null;
  let startX, startY, startLeft, startTop, startWidth, startHeight;
  let previewRect;

  previewEl.addEventListener('mousedown', (e) => {
    const slot = e.target.closest('.aadhaar-photo-slot');
    const handle = e.target.closest('.resize-handle');

    if (!slot) return;

    activeSlot = slot;
    previewRect = previewEl.getBoundingClientRect();

    if (handle) {
      activeHandle = handle.dataset.corner;
      slot.classList.add('resizing');
    } else {
      activeHandle = null;
      slot.classList.add('dragging');
    }

    startX = e.clientX;
    startY = e.clientY;
    startLeft = parseFloat(slot.style.left) || 0;
    startTop = parseFloat(slot.style.top) || 0;
    startWidth = parseFloat(slot.style.width) || 20;
    startHeight = parseFloat(slot.style.height) || 20;

    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!activeSlot) return;

    const dxPx = e.clientX - startX;
    const dyPx = e.clientY - startY;
    const dxPct = (dxPx / previewRect.width) * 100;
    const dyPct = (dyPx / previewRect.height) * 100;

    if (activeHandle) {
      // Resize
      let newW = startWidth;
      let newH = startHeight;
      let newL = startLeft;
      let newT = startTop;

      if (activeHandle.includes('r')) newW = clamp(startWidth + dxPct, 5, 90);
      if (activeHandle.includes('l')) {
        const delta = clamp(startWidth - dxPct, 5, 90);
        newL = clamp(startLeft + startWidth - delta, 0, 100 - delta);
        newW = delta;
      }
      if (activeHandle.includes('b')) newH = clamp(startHeight + dyPct, 5, 90);
      if (activeHandle.includes('t')) {
        const delta = clamp(startHeight - dyPct, 5, 90);
        newT = clamp(startTop + startHeight - delta, 0, 100 - delta);
        newH = delta;
      }

      activeSlot.style.width = `${newW}%`;
      activeSlot.style.height = `${newH}%`;
      activeSlot.style.left = `${newL}%`;
      activeSlot.style.top = `${newT}%`;
    } else {
      // Drag
      const newLeft = clamp(startLeft + dxPct, 0, 100 - startWidth);
      const newTop = clamp(startTop + dyPct, 0, 100 - startHeight);
      activeSlot.style.left = `${newLeft}%`;
      activeSlot.style.top = `${newTop}%`;
    }
  });

  document.addEventListener('mouseup', () => {
    if (activeSlot) {
      // Save positions
      const side = activeSlot.dataset.side;
      if (side && appState.aadhaarCardPositions[side]) {
        appState.aadhaarCardPositions[side] = {
          xPct: parseFloat(activeSlot.style.left),
          yPct: parseFloat(activeSlot.style.top),
          wPct: parseFloat(activeSlot.style.width),
          hPct: parseFloat(activeSlot.style.height),
        };
      }
      activeSlot.classList.remove('dragging', 'resizing');
      activeSlot = null;
      activeHandle = null;
    }
  });
}

/* ──────────────────── Keyboard Shortcuts ──────────────────── */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'o') {
      e.preventDefault();
      if (appState.layoutMode === 'aadhaar-card') {
        document.getElementById('file-input-front').click();
      } else {
        document.getElementById('file-input').click();
      }
    }
    if (e.ctrlKey && e.key === 'p') {
      e.preventDefault();
      handlePrint();
    }
    if (e.ctrlKey && e.key === 'e') {
      e.preventDefault();
      handleExportPDF();
    }
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay:not([hidden])').forEach((m) => {
        UIManager.hideModal(m.id);
      });
    }
  });
}

/* ──────────────────── About Dialog ──────────────────── */
async function showAboutDialog() {
  const content = document.getElementById('about-content');
  if (!content) return;

  let aboutInfo = { name: 'Aadhaar Photo Printer', version: '1.0.0' };
  try {
    if (api().getAboutInfo) {
      const res = await api().getAboutInfo();
      if (res && res.success) aboutInfo = res;
    }
  } catch (err) {
    console.warn('Failed to fetch about info:', err);
  }

  content.innerHTML = `
    <div class="about-version">${aboutInfo.name} v${aboutInfo.version}</div>
    <div class="about-detail">Electron ${aboutInfo.electronVersion || '—'}</div>
    <div class="about-detail">Node ${aboutInfo.nodeVersion || '—'}</div>
  `;
  UIManager.showModal('about-modal');
}

/* ──────────────────── Global access for child modules ──────────────────── */
window.PHOTO_SIZE_PRESETS = PHOTO_SIZE_PRESETS;
window.appState = appState;
window.handleRemovePhoto = handleRemovePhoto;
window.handleFilesSelected = handleFilesSelected;
window.refreshPreview = refreshPreview;
window.updateProcessingStatus = updateProcessingStatus;
window.updatePrintButton = updatePrintButton;
window.updatePhotoCountBadge = updatePhotoCountBadge;
