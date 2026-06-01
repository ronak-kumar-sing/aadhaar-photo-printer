/**
 * Aadhaar Photo Printer - Print Manager
 *
 * Handles all printing and PDF export functionality:
 * - Creates hidden BrowserWindows to render print-ready HTML
 * - Generates A4 pages with photos arranged in precise mm grids
 * - Supports dynamic grid layouts (custom cols × rows)
 * - Supports Aadhaar Card mode (front + back, absolute positioning)
 * - Optional cut guides for easy trimming
 * - Half-page printing support
 * - Supports native system printing and PDF export
 */

'use strict';

const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// ============================================================================
// Constants — A4 & Photo Dimensions (mm)
// ============================================================================

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const GAP_MM = 3;
const MARGIN_MM = 10;
const USABLE_WIDTH_MM = A4_WIDTH_MM - 2 * MARGIN_MM;   // 190mm
const USABLE_HEIGHT_MM = A4_HEIGHT_MM - 2 * MARGIN_MM;  // 277mm

// ============================================================================
// Public API
// ============================================================================

/**
 * Prints photos on A4 paper using the system print dialog.
 */
async function printPhotos(mainWindow, photos, options = {}) {
  if (!photos || photos.length === 0) {
    return { success: false, pagesCount: 0, error: 'No photos provided.' };
  }

  const html = generatePrintHTML(photos, options);
  const pagesCount = options.layoutMode === 'aadhaar-card' ? 1 : calculatePageCount(photos.length, options);

  let printWindow = null;

  try {
    printWindow = createHiddenPrintWindow(mainWindow);
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await waitForImagesLoaded(printWindow);

    const printSettings = {
      silent: false,
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'none' },
      copies: options.copies || 1,
      color: true,
    };

    let usedFallback = false;

    // Try specific printer first if selected
    if (options.printerName) {
      printSettings.silent = true;
      printSettings.deviceName = options.printerName;
    }

    let printResult = await executePrint(printWindow, printSettings);

    // If silent print failed, fallback to system dialog
    if (!printResult.success && options.printerName) {
      console.log('[PrintManager] Silent print failed, falling back to system print dialog.');
      usedFallback = true;
      printSettings.silent = false;
      delete printSettings.deviceName;
      printResult = await executePrint(printWindow, printSettings);
    }

    if (!printResult.success) {
      throw new Error(printResult.error || 'Print was cancelled or failed.');
    }

    return { success: true, pagesCount, usedFallback };
  } catch (error) {
    console.error('[PrintManager] Print error:', error.message);
    return { success: false, pagesCount: 0, error: error.message };
  } finally {
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.close();
    }
  }
}

/**
 * Exports photos to a PDF file.
 */
async function exportToPDF(mainWindow, photos, outputPath, options = {}) {
  if (!photos || photos.length === 0) {
    return { success: false, error: 'No photos provided.' };
  }
  if (!outputPath) {
    return { success: false, error: 'No output path specified.' };
  }

  const html = generatePrintHTML(photos, options);
  let printWindow = null;

  try {
    printWindow = createHiddenPrintWindow(mainWindow);
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await waitForImagesLoaded(printWindow);

    const pdfBuffer = await printWindow.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { marginType: 'none' },
      preferCSSPageSize: true,
      landscape: false,
    });

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, pdfBuffer);
    const fileSize = pdfBuffer.length;

    return { success: true, filePath: outputPath, fileSize };
  } catch (error) {
    console.error('[PrintManager] PDF export error:', error.message);
    return { success: false, error: error.message };
  } finally {
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.close();
    }
  }
}

/**
 * Retrieves the list of available system printers.
 */
async function getPrinters(mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Main window is not available.');
  }

  try {
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      description: p.description || '',
      isDefault: p.isDefault,
      status: p.status,
    }));
  } catch (error) {
    console.error('[PrintManager] getPrinters error:', error.message);
    return [];
  }
}

// ============================================================================
// HTML Generation
// ============================================================================

function generatePrintHTML(photos, options = {}) {
  if (options.layoutMode === 'aadhaar-card') {
    return generateAadhaarCardHTML(photos, options);
  }
  return generateGridHTML(photos, options);
}

function generateGridHTML(photos, options = {}) {
  const layoutStr = options.layout || '4x3';
  let cols = 4, rows = 3;
  const match = layoutStr.match(/(\d+)x(\d+)/);
  if (match) {
    cols = parseInt(match[1], 10);
    rows = parseInt(match[2], 10);
  }

  const halfPage = options.halfPage || false;
  const showCutGuides = options.showCutGuides || false;

  const usableHeight = halfPage ? USABLE_HEIGHT_MM / 2 : USABLE_HEIGHT_MM;
  const photosPerPage = cols * rows;

  // Calculate photo dimensions to fill the usable area
  const photoW = (USABLE_WIDTH_MM - (cols - 1) * GAP_MM) / cols;
  const photoH = (usableHeight - (rows - 1) * GAP_MM) / rows;

  // Center the grid
  const gridWidth = cols * photoW + (cols - 1) * GAP_MM;
  const gridHeight = rows * photoH + (rows - 1) * GAP_MM;
  const offsetX = (USABLE_WIDTH_MM - gridWidth) / 2;
  const offsetY = (usableHeight - gridHeight) / 2;

  // Split into pages
  const pages = [];
  for (let i = 0; i < photos.length; i += photosPerPage) {
    pages.push(photos.slice(i, i + photosPerPage));
  }
  if (pages.length === 0) pages.push([]);

  const pagesHTML = pages.map((pagePhotos, pageIndex) => {
    const photoSlots = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const photoIdx = row * cols + col;
        const photo = pagePhotos[photoIdx];

        if (photo) {
          const x = offsetX + col * (photoW + GAP_MM);
          const y = offsetY + row * (photoH + GAP_MM);
          photoSlots.push(`
            <div class="photo-cell" style="left: ${x}mm; top: ${y}mm; width: ${photoW}mm; height: ${photoH}mm;">
              <img src="data:image/jpeg;base64,${photo.buffer}" alt="${escapeHTML(photo.name || 'photo')}" />
            </div>
          `);
        }
      }
    }

    const cutGuidesHTML = showCutGuides ? generateCutGuides(cols, rows, offsetX, offsetY, photoW, photoH) : '';

    return `
      <div class="page ${pageIndex > 0 ? 'page-break' : ''}" style="height: ${usableHeight}mm;">
        ${photoSlots.join('')}
        ${cutGuidesHTML}
      </div>
    `;
  }).join('');

  return buildDocument(pagesHTML, halfPage ? usableHeight : USABLE_HEIGHT_MM);
}

function generateAadhaarCardHTML(photos, options = {}) {
  const positions = options.aadhaarCardPositions || {
    front: { xPct: 15, yPct: 10, wPct: 40, hPct: 25 },
    back:  { xPct: 15, yPct: 55, wPct: 40, hPct: 25 },
  };

  const frontPhoto = photos.find((p) => p.side === 'front');
  const backPhoto = photos.find((p) => p.side === 'back');

  const slots = [];

  if (frontPhoto) {
    const pos = positions.front;
    const x = (pos.xPct / 100) * USABLE_WIDTH_MM;
    const y = (pos.yPct / 100) * USABLE_HEIGHT_MM;
    const w = (pos.wPct / 100) * USABLE_WIDTH_MM;
    const h = (pos.hPct / 100) * USABLE_HEIGHT_MM;
    slots.push(`
      <div class="photo-cell" style="left: ${x}mm; top: ${y}mm; width: ${w}mm; height: ${h}mm;">
        <img src="data:image/jpeg;base64,${frontPhoto.buffer}" alt="Front" />
      </div>
    `);
  }

  if (backPhoto) {
    const pos = positions.back;
    const x = (pos.xPct / 100) * USABLE_WIDTH_MM;
    const y = (pos.yPct / 100) * USABLE_HEIGHT_MM;
    const w = (pos.wPct / 100) * USABLE_WIDTH_MM;
    const h = (pos.hPct / 100) * USABLE_HEIGHT_MM;
    slots.push(`
      <div class="photo-cell" style="left: ${x}mm; top: ${y}mm; width: ${w}mm; height: ${h}mm;">
        <img src="data:image/jpeg;base64,${backPhoto.buffer}" alt="Back" />
      </div>
    `);
  }

  const pagesHTML = `
    <div class="page" style="height: ${USABLE_HEIGHT_MM}mm;">
      ${slots.join('')}
    </div>
  `;

  return buildDocument(pagesHTML, USABLE_HEIGHT_MM);
}

function buildDocument(pagesHTML, usableHeightMM) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Aadhaar Photos - Print</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    @page { size: A4 portrait; margin: ${MARGIN_MM}mm; }
    html, body {
      width: ${A4_WIDTH_MM}mm;
      margin: 0; padding: 0;
      font-family: Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      position: relative;
      width: ${USABLE_WIDTH_MM}mm;
      height: ${usableHeightMM}mm;
      margin: 0 auto;
      overflow: hidden;
    }
    .page-break { page-break-before: always; }
    .photo-cell {
      position: absolute;
      overflow: hidden;
    }
    .photo-cell img {
      width: 100%; height: 100%;
      object-fit: cover;
      display: block;
    }
    .cut-guide {
      position: absolute;
      background-color: #d0d0d0;
      z-index: 10;
    }
    .cut-guide-h { height: 0.2mm; left: 0; right: 0; }
    .cut-guide-v { width: 0.2mm; top: 0; bottom: 0; }
    @media print {
      html, body { width: auto; }
      .page { width: ${USABLE_WIDTH_MM}mm; height: ${usableHeightMM}mm; }
    }
    @media screen {
      body { background: #f0f0f0; padding: 20px; }
      .page { background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.15); margin-bottom: 20px; border: 1px solid #ccc; }
    }
  </style>
</head>
<body>
  ${pagesHTML}
</body>
</html>`;
}

// ============================================================================
// Internal Helpers
// ============================================================================

function createHiddenPrintWindow(parent) {
  return new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    parent: parent || undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: false,
    },
  });
}

async function waitForImagesLoaded(win) {
  await delay(300);
  try {
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const images = document.querySelectorAll('img');
        if (images.length === 0) { resolve(); return; }
        let loaded = 0;
        const total = images.length;
        function onLoad() { loaded++; if (loaded >= total) resolve(); }
        images.forEach((img) => {
          if (img.complete && img.naturalHeight > 0) { onLoad(); }
          else { img.addEventListener('load', onLoad); img.addEventListener('error', onLoad); }
        });
        setTimeout(resolve, 5000);
      });
    `);
  } catch (err) {
    console.warn('[PrintManager] Image load check failed, proceeding with delay:', err.message);
    await delay(1000);
  }
}

function generateCutGuides(cols, rows, offsetX, offsetY, photoW, photoH) {
  const guides = [];
  for (let row = 1; row < rows; row++) {
    const y = offsetY + row * photoH + (row - 0.5) * GAP_MM;
    guides.push(`<div class="cut-guide cut-guide-h" style="top: ${y}mm;"></div>`);
  }
  for (let col = 1; col < cols; col++) {
    const x = offsetX + col * photoW + (col - 0.5) * GAP_MM;
    guides.push(`<div class="cut-guide cut-guide-v" style="left: ${x}mm;"></div>`);
  }
  return guides.join('');
}

function calculatePageCount(photoCount, options = {}) {
  const layoutStr = options.layout || '4x3';
  let cols = 4, rows = 3;
  const match = layoutStr.match(/(\d+)x(\d+)/);
  if (match) {
    cols = parseInt(match[1], 10);
    rows = parseInt(match[2], 10);
  }
  const perPage = cols * rows;
  return Math.ceil(photoCount / perPage);
}

function estimateInkUsage(photoCount) {
  if (photoCount <= 4) return 'Low';
  if (photoCount <= 12) return 'Medium';
  return 'High';
}

function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes print on a window and returns result.
 */
function executePrint(win, settings) {
  return new Promise((resolve) => {
    win.webContents.print(settings, (success, failureReason) => {
      if (success) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: failureReason || 'Print was cancelled or failed.' });
      }
    });
  });
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  printPhotos,
  exportToPDF,
  getPrinters,
  generatePrintHTML,
  estimateInkUsage,
};
