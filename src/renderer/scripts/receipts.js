/* ═══════════════════════════════════════════════════════════════════
   AADHAAR PHOTO PRINTER — Receipt Manager
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

const ReceiptManager = (() => {

  /* ────────────────────────────────────────────────────────────────
     Generate Receipt
     ──────────────────────────────────────────────────────────────── */
  function generateReceipt(data) {
    const {
      shopName = 'Photo Studio',
      customerName = 'Walk-in',
      customerPhone = '—',
      photoCount = 0,
      pricePerPhoto = 10,
      date = new Date(),
    } = data;

    const total = photoCount * pricePerPhoto;
    const formattedDate = formatDate(date);
    const formattedTime = formatTime(date);

    const card = document.getElementById('receipt-card');
    if (!card) return;

    card.innerHTML = `
      <div class="receipt-shop-name">${escapeHTML(shopName)}</div>
      <div style="text-align:center;font-size:var(--font-size-sm);color:var(--text-tertiary);">
        Date: ${formattedDate} &nbsp; ${formattedTime}
      </div>

      <hr class="receipt-separator">

      <div class="receipt-line">
        <span>Customer:</span>
        <span>${escapeHTML(customerName)}</span>
      </div>
      <div class="receipt-line">
        <span>Phone:</span>
        <span>${escapeHTML(customerPhone)}</span>
      </div>

      <hr class="receipt-separator">

      <div class="receipt-line">
        <span>Photos:</span>
        <span>${photoCount} × ₹${pricePerPhoto}</span>
      </div>

      <hr class="receipt-separator">

      <div class="receipt-total">
        <span>Total:</span>
        <span>₹${total.toLocaleString('en-IN')}</span>
      </div>

      <hr class="receipt-separator">

      <div class="receipt-footer-msg">Thank you! Visit again. 🙏</div>
    `;
  }

  /* ────────────────────────────────────────────────────────────────
     Print Receipt
     ──────────────────────────────────────────────────────────────── */
  function printReceipt() {
    const card = document.getElementById('receipt-card');
    if (!card) return;

    const printWindow = window.open('', '_blank', 'width=360,height=500');
    if (!printWindow) {
      UIManager.showToast('Pop-up blocked. Please allow pop-ups.', 'warning');
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Receipt</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: 14px;
            padding: 16px;
            color: #111;
            max-width: 300px;
            margin: 0 auto;
            line-height: 1.7;
          }
          .receipt-shop-name {
            text-align: center;
            font-size: 16px;
            font-weight: 700;
            margin-bottom: 8px;
          }
          .receipt-separator {
            border: none;
            border-top: 1px dashed #999;
            margin: 8px 0;
          }
          .receipt-line {
            display: flex;
            justify-content: space-between;
          }
          .receipt-total {
            display: flex;
            justify-content: space-between;
            font-size: 16px;
            font-weight: 700;
          }
          .receipt-footer-msg {
            text-align: center;
            font-size: 14px;
            color: #555;
            margin-top: 8px;
          }
          @media print {
            body { padding: 0; }
          }
        </style>
      </head>
      <body>
        ${card.innerHTML}
        <script>
          window.onload = function() {
            window.print();
            setTimeout(function(){ window.close(); }, 600);
          };
        <\/script>
      </body>
      </html>
    `);

    printWindow.document.close();
  }

  /* ────────────────────────────────────────────────────────────────
     Helpers
     ──────────────────────────────────────────────────────────────── */
  function formatDate(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  function formatTime(d) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  /* ──────────── Public API ──────────── */
  return {
    generateReceipt,
    printReceipt,
  };
})();

// Expose globally
window.ReceiptManager = ReceiptManager;
