/* ═══════════════════════════════════════════════════════════════════
   AADHAAR PHOTO PRINTER — Main Application Controller
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ──────────────────── State ──────────────────── */
const appState = {
  photos: [],
  // Each photo: { id, name, originalPath, thumbnail, processedBuffer, aiAnalysis, fileSize }
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
  halfPage: false,
  printerName: '',
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
  loadRecentPhotos();
  updateFooter();
  updatePhotoSizeDisplay();
  refreshPreview();
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
      if (res.settings.halfPage != null) appState.halfPage = res.settings.halfPage;
      if (res.settings.printerName != null) appState.printerName = res.settings.printerName;
      if (res.settings.aadhaarCardPositions) {
        appState.aadhaarCardPositions = res.settings.aadhaarCardPositions;
      }
    }
  } catch { /* use defaults */ }

  // Reflect in UI
  const badge = document.getElementById('header-shop-badge');
  if (badge) badge.textContent = appState.settings.shopName || 'Aadhaar Print Shop';

  // Reflect print options
  document.getElementById('chk-cut-guides').checked = appState.showCutGuides;
  document.getElementById('chk-half-page').checked = appState.halfPage;
  document.getElementById('input-cols').value = appState.layoutCols;
  document.getElementById('input-rows').value = appState.layoutRows;

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
        layoutMode: appState.layoutMode,
        layoutCols: appState.layoutCols,
        layoutRows: appState.layoutRows,
        showCutGuides: appState.showCutGuides,
        halfPage: appState.halfPage,
        printerName: appState.printerName,
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
  } catch { appState.dailyCount = 0; }
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

    if (api().processImage && file.path) {
      const result = await api().processImage(file.path, {});
      if (result && result.success) {
        photo.processedBuffer = result.buffer || null;
        if (photo.processedBuffer) {
          photo.thumbnail = `data:image/jpeg;base64,${photo.processedBuffer}`;
        }
      }
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
    // In aadhaar mode, only accept first image as front if none set
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
      aiAnalysis: null,
      fileSize,
    };

    appState.photos.push(photo);
    PhotoGrid.addPhoto(photo);

    try {
      const dataUrl = await readFileAsDataURL(file);
      photo.thumbnail = dataUrl;

      if (api().processImage && file.path) {
        const result = await api().processImage(file.path, {});
        if (result && result.success) {
          photo.processedBuffer = result.buffer || null;
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
      }

      PhotoGrid.hideProcessing(id);
      PhotoGrid.updateThumbnail(id, photo.thumbnail, photo.aiAnalysis);
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
  refreshPreview();
  updatePrintButton();
  updatePhotoCountBadge();
  UIManager.showToast('All photos cleared', 'info');
}

/* ──────────────────── Print ──────────────────── */
async function handlePrint() {
  const hasGridPhotos = appState.layoutMode === 'grid' && appState.photos.length === 0;
  const hasCardPhotos = appState.layoutMode === 'aadhaar-card' && !appState.aadhaarFront && !appState.aadhaarBack;
  if ((hasGridPhotos && appState.layoutMode === 'grid') || (hasCardPhotos && appState.layoutMode === 'aadhaar-card')) {
    UIManager.showToast('Add photos before printing', 'warning');
    return;
  }
  if (appState.isPrinting) return;

  appState.isPrinting = true;
  updateProcessingStatus(true, 'Printing…');

  try {
    const customerName = document.getElementById('input-customer-name').value.trim();
    const customerPhone = document.getElementById('input-customer-phone').value.trim();

    if (api().print) {
      let printPhotos = [];
      let printOptions = {
        layout: `${appState.layoutCols}x${appState.layoutRows}`,
        layoutMode: appState.layoutMode,
        quality: appState.selectedQuality,
        copies: 1,
        showCutGuides: appState.showCutGuides,
        halfPage: appState.halfPage,
        printerName: appState.printerName || undefined,
      };

      if (appState.layoutMode === 'grid') {
        printPhotos = appState.photos.map((p) => ({
          buffer: p.processedBuffer || '',
          name: p.name || 'photo.jpg',
        }));
      } else {
        // Aadhaar card mode
        printPhotos = [];
        if (appState.aadhaarFront) {
          printPhotos.push({ buffer: appState.aadhaarFront.processedBuffer || '', name: 'front.jpg', side: 'front' });
        }
        if (appState.aadhaarBack) {
          printPhotos.push({ buffer: appState.aadhaarBack.processedBuffer || '', name: 'back.jpg', side: 'back' });
        }
        printOptions.aadhaarCardPositions = appState.aadhaarCardPositions;
      }

      await api().print(printPhotos, printOptions);
    }

    // Increment daily count
    const countToAdd = appState.layoutMode === 'grid' ? appState.photos.length : (appState.aadhaarFront ? 1 : 0) + (appState.aadhaarBack ? 1 : 0);
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
  const hasGridPhotos = appState.layoutMode === 'grid' && appState.photos.length === 0;
  const hasCardPhotos = appState.layoutMode === 'aadhaar-card' && !appState.aadhaarFront && !appState.aadhaarBack;
  if ((hasGridPhotos && appState.layoutMode === 'grid') || (hasCardPhotos && appState.layoutMode === 'aadhaar-card')) {
    UIManager.showToast('Add photos before exporting', 'warning');
    return;
  }

  try {
    if (api().printToPDF && api().showSaveDialog) {
      const dialogResult = await api().showSaveDialog({
        title: 'Export Photos to PDF',
        defaultPath: 'aadhaar_photos.pdf',
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      });

      if (dialogResult && !dialogResult.canceled && dialogResult.filePath) {
        let printPhotos = [];
        let printOptions = {
          layout: `${appState.layoutCols}x${appState.layoutRows}`,
          layoutMode: appState.layoutMode,
          showCutGuides: appState.showCutGuides,
          halfPage: appState.halfPage,
        };

        if (appState.layoutMode === 'grid') {
          printPhotos = appState.photos.map((p) => ({
            buffer: p.processedBuffer || '',
            name: p.name || 'photo.jpg',
          }));
        } else {
          if (appState.aadhaarFront) printPhotos.push({ buffer: appState.aadhaarFront.processedBuffer || '', name: 'front.jpg', side: 'front' });
          if (appState.aadhaarBack) printPhotos.push({ buffer: appState.aadhaarBack.processedBuffer || '', name: 'back.jpg', side: 'back' });
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
  const count = appState.layoutMode === 'grid' ? appState.photos.length : ((appState.aadhaarFront ? 1 : 0) + (appState.aadhaarBack ? 1 : 0));

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
  const count = appState.layoutMode === 'grid' ? appState.photos.length : ((appState.aadhaarFront ? 1 : 0) + (appState.aadhaarBack ? 1 : 0));
  if (count === 0) {
    UIManager.showToast('No photos to back up', 'warning');
    return;
  }
  try {
    if (api().backupPhotos) {
      const customerName = document.getElementById('input-customer-name').value.trim();
      let items = [];
      if (appState.layoutMode === 'grid') {
        items = appState.photos.map((p) => ({ buffer: p.processedBuffer || '', name: p.name || 'photo.jpg' }));
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
    const list = api().getRecentPhotos ? await api().getRecentPhotos() : [];
    PhotoGrid.renderRecentPhotos(list);
  } catch { /* ignore */ }
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
  PagePreview.render(appState.photos, layout, appState.currentPage, 'grid');
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
  const perPage = PagePreview.getMaxPhotos(layout);
  const totalPages = Math.max(1, Math.ceil(appState.photos.length / perPage));
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

function updatePhotoSizeDisplay() {
  const mmEl = document.getElementById('photo-size-mm');
  const pxEl = document.getElementById('photo-size-px');
  if (!mmEl || !pxEl) return;

  if (appState.layoutMode === 'aadhaar-card') {
    mmEl.textContent = 'Custom size (draggable)';
    pxEl.textContent = 'Resize and position on the preview';
    return;
  }

  const cols = appState.layoutCols;
  const rows = appState.layoutRows;

  // A4 = 210mm × 297mm, margin 10mm each side = 190mm × 277mm usable
  // gap 3mm between photos
  const usableW = 190;
  const usableH = appState.halfPage ? 277 / 2 : 277;
  const gap = 3;

  const photoW = Math.round((usableW - (cols - 1) * gap) / cols);
  const photoH = Math.round((usableH - (rows - 1) * gap) / rows);

  // Convert to pixels at 300 DPI
  const pxW = Math.round(photoW * 300 / 25.4);
  const pxH = Math.round(photoH * 300 / 25.4);

  mmEl.textContent = `${photoW} mm × ${photoH} mm`;
  pxEl.textContent = `(${pxW} × ${pxH} px @ 300 DPI)`;
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

  // Update upload text
  document.getElementById('upload-heading-text').textContent = isAadhaar ? 'Aadhaar Card' : 'Upload Photos';
  document.getElementById('upload-zone-title').textContent = isAadhaar ? 'Upload Front & Back' : 'Drop Aadhaar / Passport photos';

  // Half-page only applies to grid
  document.getElementById('chk-half-page').disabled = isAadhaar;

  // Update half-page guide
  document.getElementById('half-page-guide').hidden = !appState.halfPage || isAadhaar;

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
  document.getElementById('btn-clear-all').addEventListener('click', handleClearAll);

  // Receipt modal
  document.getElementById('btn-close-receipt').addEventListener('click', () => UIManager.hideModal('receipt-modal'));
  document.getElementById('btn-receipt-print').addEventListener('click', () => ReceiptManager.printReceipt());

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

/* ──────────────────── Print Options ──────────────────── */
function setupPrintOptions() {
  const cutGuidesChk = document.getElementById('chk-cut-guides');
  const halfPageChk = document.getElementById('chk-half-page');

  cutGuidesChk.addEventListener('change', () => {
    appState.showCutGuides = cutGuidesChk.checked;
  });

  halfPageChk.addEventListener('change', () => {
    appState.halfPage = halfPageChk.checked;
    document.getElementById('half-page-guide').hidden = !appState.halfPage || appState.layoutMode === 'aadhaar-card';
    updatePhotoSizeDisplay();
    refreshPreview();
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
    const totalPages = Math.ceil(appState.photos.length / PagePreview.getMaxPhotos(layout));
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
        newL = clamp(startLeft + startWidth - delta, 0, 95);
        newW = delta;
      }
      if (activeHandle.includes('b')) newH = clamp(startHeight + dyPct, 5, 90);
      if (activeHandle.includes('t')) {
        const delta = clamp(startHeight - dyPct, 5, 90);
        newT = clamp(startTop + startHeight - delta, 0, 95);
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

/* ──────────────────── Global access for child modules ──────────────────── */
window.appState = appState;
window.handleRemovePhoto = handleRemovePhoto;
