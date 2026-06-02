/* ═══════════════════════════════════════════════════════════════════
   AADHAAR PHOTO PRINTER — A4 Page Preview Renderer
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

const PagePreview = (() => {
  /* ──────────── Layout Configs ──────────── */
  const LAYOUTS = {
    '4x3': { cols: 4, rows: 3 },
    '5x3': { cols: 5, rows: 3 },
    '1x1': { cols: 1, rows: 1 },
  };

  /* ──────────── Max photos per page ──────────── */
  function getMaxPhotos(layout) {
    if (typeof layout === 'string') {
      const cfg = LAYOUTS[layout] || LAYOUTS['4x3'];
      return cfg.cols * cfg.rows;
    }
    // Dynamic layout object { cols, rows }
    return (layout.cols || 4) * (layout.rows || 3);
  }

  /* ──────────── Page Count ──────────── */
  function getPageCount(photoCount, layout) {
    const max = getMaxPhotos(layout);
    return Math.max(1, Math.ceil(photoCount / max));
  }

  /* ──────────── Update Aspect Ratio ──────────── */
  function updateAspectRatio() {
    const state = window.appState;
    if (!state || !state.photoSizeId) return;
    const presets = window.PHOTO_SIZE_PRESETS;
    if (!presets) return;
    const preset = presets.find((p) => p.id === state.photoSizeId);
    if (!preset) return;

    const ratio = `${preset.mmW} / ${preset.mmH}`;
    document.documentElement.style.setProperty('--photo-aspect-ratio', ratio);

    // Also update photo card aspect ratio
    const style = document.getElementById('dynamic-photo-card-style');
    if (style) {
      style.textContent = `.photo-card { height: ${Math.round(60 * preset.mmH / preset.mmW)}px !important; }`;
    }
  }

  /* ──────────── Render Grid Mode ──────────── */
  function renderGrid(photos, layout, page = 1) {
    const previewEl = document.getElementById('a4-preview');
    if (!previewEl) return;

    // Update aspect ratio before rendering
    updateAspectRatio();

    const cols = layout.cols || 4;
    const rows = layout.rows || 3;
    const maxPerPage = cols * rows;
    const startIdx = (page - 1) * maxPerPage;
    const pagePhotos = photos.slice(startIdx, startIdx + maxPerPage);

    previewEl.classList.remove('aadhaar-card-mode');
    previewEl.setAttribute('data-layout', `${cols}x${rows}`);

    // Use CSS Grid but with fixed aspect-ratio cells
    previewEl.style.display = 'grid';
    previewEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    previewEl.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

    // Clear existing cells
    previewEl.innerHTML = '';

    // Build cells
    for (let i = 0; i < maxPerPage; i++) {
      const cell = document.createElement('div');
      cell.className = 'preview-cell';

      if (i < pagePhotos.length && pagePhotos[i].thumbnail) {
        cell.classList.add('filled');

        const img = document.createElement('img');
        img.className = 'preview-cell-img';
        img.src = pagePhotos[i].thumbnail;
        img.alt = pagePhotos[i].name || 'Photo';
        img.draggable = false;

        cell.appendChild(img);
      } else if (i < pagePhotos.length) {
        cell.innerHTML = '<div class="photo-card-spinner" style="width:18px;height:18px;"></div>';
      } else {
        const placeholder = document.createElement('span');
        placeholder.className = 'preview-cell-placeholder';
        placeholder.textContent = '+';
        placeholder.setAttribute('aria-hidden', 'true');
        cell.appendChild(placeholder);
      }

      previewEl.appendChild(cell);
    }
  }

  /* ──────────── Render Aadhaar Card Mode ──────────── */
  function renderAadhaarCard(frontPhoto, backPhoto, positions) {
    const previewEl = document.getElementById('a4-preview');
    if (!previewEl) return;

    previewEl.classList.add('aadhaar-card-mode');
    previewEl.style.display = 'block';
    previewEl.innerHTML = '';

    const frontPos = positions?.front || { xPct: 15, yPct: 10, wPct: 40, hPct: 25 };
    const backPos = positions?.back || { xPct: 15, yPct: 55, wPct: 40, hPct: 25 };

    createSlot(previewEl, 'front', frontPhoto, frontPos);
    createSlot(previewEl, 'back', backPhoto, backPos);
  }

  function createSlot(container, side, photo, pos) {
    const slot = document.createElement('div');
    slot.className = 'aadhaar-photo-slot';
    slot.dataset.side = side;
    slot.style.left = `${pos.xPct}%`;
    slot.style.top = `${pos.yPct}%`;
    slot.style.width = `${pos.wPct}%`;
    slot.style.height = `${pos.hPct}%`;

    const label = document.createElement('span');
    label.className = 'slot-label';
    label.textContent = side === 'front' ? 'Front' : 'Back';
    slot.appendChild(label);

    if (photo && photo.thumbnail) {
      const img = document.createElement('img');
      img.className = 'slot-img';
      img.src = photo.thumbnail;
      img.alt = photo.name || side;
      slot.appendChild(img);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'slot-placeholder';
      placeholder.textContent = '+';
      slot.appendChild(placeholder);
    }

    // Resize handles
    ['tl', 'tr', 'bl', 'br'].forEach((corner) => {
      const handle = document.createElement('div');
      handle.className = `resize-handle ${corner}`;
      handle.dataset.corner = corner;
      slot.appendChild(handle);
    });

    container.appendChild(slot);
  }

  /* ──────────── Main Render ──────────── */
  function render(photos, layout, page = 1, mode = 'grid', aadhaarPhotos = null, positions = null) {
    if (mode === 'aadhaar-card') {
      renderAadhaarCard(aadhaarPhotos?.front, aadhaarPhotos?.back, positions);
    } else {
      renderGrid(photos, layout, page);
    }
  }

  /* ──────────── Update layout without re‐reading photos ──────────── */
  function updateLayout(layout, mode = 'grid') {
    const state = window.appState;
    if (!state) return;

    if (mode === 'aadhaar-card') {
      renderAadhaarCard(state.aadhaarFront, state.aadhaarBack, state.aadhaarCardPositions);
    } else {
      render(state.photos, layout, 1, 'grid');
    }
  }

  /* ──────────── Public API ──────────── */
  return {
    render,
    updateLayout,
    getPageCount,
    getMaxPhotos,
    renderAadhaarCard,
  };
})();

// Expose globally
window.PagePreview = PagePreview;
