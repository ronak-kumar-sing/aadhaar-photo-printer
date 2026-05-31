/* ═══════════════════════════════════════════════════════════════════
   AADHAAR PHOTO PRINTER — Photo Grid Manager
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

const PhotoGrid = (() => {
  /* ──────────── Selectors ──────────── */
  const listEl = () => document.getElementById('photo-list');
  const emptyEl = () => document.getElementById('photo-list-empty');

  /* ──────────── Render Entire List ──────────── */
  function renderPhotoList(photos) {
    const container = listEl();
    if (!container) return;

    // Remove all cards but keep the empty‐state element
    container.querySelectorAll('.photo-card').forEach((c) => c.remove());

    if (photos.length === 0) {
      showEmpty(true);
      return;
    }

    showEmpty(false);

    photos.forEach((photo, idx) => {
      const card = buildCard(photo);
      card.style.animationDelay = `${idx * 40}ms`;
      container.appendChild(card);
    });
  }

  /* ──────────── Add Single Photo ──────────── */
  function addPhoto(photo) {
    showEmpty(false);
    const container = listEl();
    if (!container) return;

    const card = buildCard(photo);
    container.appendChild(card);

    // Scroll the list to reveal the new card
    requestAnimationFrame(() => {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  /* ──────────── Remove Photo ──────────── */
  function removePhoto(id) {
    const card = document.getElementById(`photo-card-${id}`);
    if (!card) return;

    card.classList.add('removing');
    card.addEventListener('animationend', () => {
      card.remove();
      // Show empty state if needed
      const remaining = listEl().querySelectorAll('.photo-card');
      if (remaining.length === 0) showEmpty(true);
    }, { once: true });
  }

  /* ──────────── Processing States ──────────── */
  function showProcessing(id) {
    const card = document.getElementById(`photo-card-${id}`);
    if (!card || card.querySelector('.photo-card-processing')) return;
    const overlay = document.createElement('div');
    overlay.className = 'photo-card-processing';
    overlay.innerHTML = '<div class="photo-card-spinner"></div>';
    card.appendChild(overlay);
  }

  function hideProcessing(id) {
    const card = document.getElementById(`photo-card-${id}`);
    if (!card) return;
    const overlay = card.querySelector('.photo-card-processing');
    if (overlay) overlay.remove();
  }

  /* ──────────── Update Thumbnail ──────────── */
  function updateThumbnail(id, dataUrl, aiAnalysis) {
    const card = document.getElementById(`photo-card-${id}`);
    if (!card) return;

    if (dataUrl) {
      let img = card.querySelector('.photo-card-img');
      if (!img) {
        img = document.createElement('img');
        img.className = 'photo-card-img';
        img.alt = 'Photo thumbnail';
        card.prepend(img);
      }
      img.src = dataUrl;
    }

    if (aiAnalysis) {
      updateAIBadge(id, aiAnalysis);
    }
  }

  /* ──────────── AI Badge ──────────── */
  function updateAIBadge(id, analysis) {
    const card = document.getElementById(`photo-card-${id}`);
    if (!card) return;

    // Remove existing badge
    const existing = card.querySelector('.photo-card-ai-badge');
    if (existing) existing.remove();

    // Determine quality level
    let badgeClass = 'ai-badge-good';
    if (analysis) {
      const quality = (typeof analysis === 'string' ? analysis : analysis.quality || '').toLowerCase();
      if (quality === 'bad' || quality === 'poor' || quality === 'reject') {
        badgeClass = 'ai-badge-bad';
      } else if (quality === 'warning' || quality === 'fair' || quality === 'medium') {
        badgeClass = 'ai-badge-warning';
      }
    }

    const badge = document.createElement('span');
    badge.className = `photo-card-ai-badge ${badgeClass}`;
    badge.title = typeof analysis === 'string' ? analysis : (analysis.summary || 'AI analysis');
    card.appendChild(badge);
  }

  /* ──────────── Count ──────────── */
  function getPhotoCount() {
    return listEl().querySelectorAll('.photo-card').length;
  }

  /* ──────────── Recent Photos ──────────── */
  function renderRecentPhotos(recentList) {
    const container = document.getElementById('recent-photos-list');
    if (!container) return;
    container.innerHTML = '';

    if (!recentList || recentList.length === 0) {
      container.innerHTML = '<p class="recent-empty-msg">No recent photos</p>';
      return;
    }

    // Group by date
    const groups = {};
    recentList.forEach((item) => {
      const date = item.date ? new Date(item.date).toLocaleDateString('en-IN') : 'Unknown';
      if (!groups[date]) groups[date] = [];
      groups[date].push(item);
    });

    Object.entries(groups).forEach(([date, items]) => {
      const label = document.createElement('span');
      label.className = 'recent-date-label';
      label.textContent = date;
      container.appendChild(label);

      items.forEach((item) => {
        const thumb = document.createElement('img');
        thumb.className = 'recent-photo-thumb';
        thumb.src = item.thumbnail || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/>';
        thumb.alt = item.name || 'Recent photo';
        thumb.title = `Click to add: ${item.name || 'photo'}`;
        thumb.tabIndex = 0;
        thumb.addEventListener('click', () => handleRecentClick(item));
        thumb.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') handleRecentClick(item);
        });
        container.appendChild(thumb);
      });
    });
  }

  function handleRecentClick(item) {
    // Re‐add to current session — dispatch through app.js
    if (typeof window.handleFilesSelected === 'function') {
      // Build a pseudo‐file
      fetch(item.thumbnail)
        .then((r) => r.blob())
        .then((blob) => {
          const file = new File([blob], item.name || 'recent.jpg', { type: blob.type });
          // Ensure the Electron path is set so backend processImage works!
          Object.defineProperty(file, 'path', {
            value: item.path,
            writable: true,
            enumerable: true,
            configurable: true
          });
          window.handleFilesSelected([file]);
        })
        .catch(() => {
          if (window.UIManager) UIManager.showToast('Could not load recent photo', 'error');
        });
    }
  }

  /* ──────────── Card Builder ──────────── */
  function buildCard(photo) {
    const card = document.createElement('div');
    card.className = 'photo-card';
    card.id = `photo-card-${photo.id}`;
    card.title = `${photo.name || 'Photo'}${photo.fileSize ? ' — ' + formatBytes(photo.fileSize) : ''}`;

    // Thumbnail image (or placeholder)
    if (photo.thumbnail) {
      const img = document.createElement('img');
      img.className = 'photo-card-img';
      img.src = photo.thumbnail;
      img.alt = photo.name || 'Photo';
      img.draggable = false;
      card.appendChild(img);
    }

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'photo-card-remove';
    removeBtn.innerHTML = '✕';
    removeBtn.title = 'Remove photo';
    removeBtn.setAttribute('aria-label', `Remove ${photo.name || 'photo'}`);
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof window.handleRemovePhoto === 'function') {
        window.handleRemovePhoto(photo.id);
      }
    });
    card.appendChild(removeBtn);

    // Processing spinner if no thumbnail yet
    if (!photo.thumbnail) {
      const overlay = document.createElement('div');
      overlay.className = 'photo-card-processing';
      overlay.innerHTML = '<div class="photo-card-spinner"></div>';
      card.appendChild(overlay);
    }

    return card;
  }

  /* ──────────── Helpers ──────────── */
  function showEmpty(show) {
    const el = emptyEl();
    if (el) el.style.display = show ? 'flex' : 'none';
  }

  function formatBytes(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  /* ──────────── Public API ──────────── */
  return {
    renderPhotoList,
    addPhoto,
    removePhoto,
    showProcessing,
    hideProcessing,
    updateThumbnail,
    updateAIBadge,
    getPhotoCount,
    renderRecentPhotos,
  };
})();

// Expose globally
window.PhotoGrid = PhotoGrid;
