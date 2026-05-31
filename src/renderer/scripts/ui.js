/* ═══════════════════════════════════════════════════════════════════
   AADHAAR PHOTO PRINTER — UI Manager
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

const UIManager = (() => {
  /* ──────────── Toast Icon SVGs (inline) ──────────── */
  const TOAST_ICONS = {
    success: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    error:   `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  };

  /* ════════════════════════════════════════════════════════════════
     DARK MODE
     ════════════════════════════════════════════════════════════════ */
  function toggleDarkMode(dark) {
    const root = document.documentElement;

    // Smooth transition class
    root.classList.add('theme-transitioning');
    root.setAttribute('data-theme', dark ? 'dark' : 'light');

    setTimeout(() => {
      root.classList.remove('theme-transitioning');
    }, 550);
  }

  /* ════════════════════════════════════════════════════════════════
     TOAST NOTIFICATIONS
     ════════════════════════════════════════════════════════════════ */
  let toastCounter = 0;

  function showToast(message, type = 'success', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    toastCounter++;
    const id = `toast-${toastCounter}`;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.id = id;
    toast.setAttribute('role', 'alert');

    toast.innerHTML = `
      <span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>
      <span class="toast-msg">${escapeHTML(message)}</span>
      <button class="toast-close" aria-label="Dismiss" onclick="UIManager.dismissToast('${id}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <span class="toast-progress" style="animation-duration:${duration}ms"></span>
    `;

    container.appendChild(toast);

    // Auto‐dismiss
    const timer = setTimeout(() => dismissToast(id), duration);

    // Store timer so we can cancel if manually dismissed
    toast._timer = timer;
  }

  function dismissToast(id) {
    const toast = document.getElementById(id);
    if (!toast || toast._dismissed) return;
    toast._dismissed = true;
    clearTimeout(toast._timer);

    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }

  /* ════════════════════════════════════════════════════════════════
     SUCCESS ANIMATION
     ════════════════════════════════════════════════════════════════ */
  function showSuccessAnimation() {
    const overlay = document.getElementById('success-overlay');
    if (!overlay) return;

    overlay.hidden = false;
    overlay.classList.remove('hiding');

    // Re‐trigger SVG animations by cloning path nodes
    overlay.querySelectorAll('.checkmark-circle, .checkmark-check').forEach((el) => {
      const clone = el.cloneNode(true);
      el.parentNode.replaceChild(clone, el);
    });

    setTimeout(() => {
      overlay.classList.add('hiding');
      overlay.addEventListener('animationend', () => {
        overlay.hidden = true;
        overlay.classList.remove('hiding');
      }, { once: true });
    }, 2500);
  }

  /* ════════════════════════════════════════════════════════════════
     PROGRESS BAR
     ════════════════════════════════════════════════════════════════ */
  function showProgressBar(container, progress, text) {
    let wrapper = container.querySelector('.progress-bar-container');

    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'progress-bar-container';
      wrapper.innerHTML = `
        <div class="progress-bar-text"></div>
        <div class="progress-bar-track">
          <div class="progress-bar-fill striped"></div>
        </div>
      `;
      container.appendChild(wrapper);
    }

    const fill = wrapper.querySelector('.progress-bar-fill');
    const label = wrapper.querySelector('.progress-bar-text');
    const pct = Math.round(Math.max(0, Math.min(100, progress)));
    fill.style.width = `${pct}%`;
    label.textContent = text || `${pct}%`;

    if (pct >= 100) {
      fill.classList.remove('striped');
    } else {
      fill.classList.add('striped');
    }
  }

  function removeProgressBar(container) {
    const wrapper = container.querySelector('.progress-bar-container');
    if (wrapper) wrapper.remove();
  }

  /* ════════════════════════════════════════════════════════════════
     MODALS
     ════════════════════════════════════════════════════════════════ */
  function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.hidden = false;
    modal.classList.remove('hiding');

    // Focus first input
    requestAnimationFrame(() => {
      const firstInput = modal.querySelector('input, button:not(.modal-close-btn)');
      if (firstInput) firstInput.focus();
    });

    // Close on overlay click
    modal._overlayClick = (e) => {
      if (e.target === modal) hideModal(modalId);
    };
    modal.addEventListener('click', modal._overlayClick);
  }

  function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal || modal.hidden) return;

    modal.removeEventListener('click', modal._overlayClick);
    modal.classList.add('hiding');

    modal.addEventListener('animationend', () => {
      modal.hidden = true;
      modal.classList.remove('hiding');
    }, { once: true });
  }

  /* ════════════════════════════════════════════════════════════════
     FOOTER
     ════════════════════════════════════════════════════════════════ */
  function updateFooter(dailyCount, status, inkEstimate, aiStatus) {
    if (dailyCount !== undefined) {
      document.getElementById('footer-count-value').textContent = dailyCount;
    }
    if (status) {
      const dot = document.getElementById('footer-status-dot');
      const txt = document.getElementById('footer-status-text');
      dot.className = `status-dot status-${status.type || 'ready'}`;
      txt.textContent = status.text || 'Ready';
    }
    if (inkEstimate !== undefined) {
      document.getElementById('footer-ink-value').textContent = inkEstimate;
    }
    if (aiStatus) {
      const dot = document.getElementById('footer-ai-dot');
      const txt = document.getElementById('footer-ai-text');
      dot.className = `status-dot status-${aiStatus.type || 'inactive'}`;
      txt.textContent = aiStatus.text || 'AI: Off';
    }
  }

  /* ════════════════════════════════════════════════════════════════
     DRAG & DROP ZONE
     ════════════════════════════════════════════════════════════════ */
  function setupDragDropZone(element, onFiles) {
    if (!element) return;

    let dragCounter = 0;

    element.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter++;
      element.classList.add('drag-over');
    });

    element.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    });

    element.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        element.classList.remove('drag-over');
      }
    });

    element.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      element.classList.remove('drag-over');

      const files = [];
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        for (const f of e.dataTransfer.files) {
          if (f.type.startsWith('image/')) files.push(f);
        }
      }

      if (files.length > 0 && typeof onFiles === 'function') {
        onFiles(files);
      }
    });
  }

  /* ════════════════════════════════════════════════════════════════
     HELPERS
     ════════════════════════════════════════════════════════════════ */
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ──────────── Public API ──────────── */
  return {
    toggleDarkMode,
    showToast,
    dismissToast,
    showSuccessAnimation,
    showProgressBar,
    removeProgressBar,
    showModal,
    hideModal,
    updateFooter,
    setupDragDropZone,
  };
})();

// Expose globally
window.UIManager = UIManager;
