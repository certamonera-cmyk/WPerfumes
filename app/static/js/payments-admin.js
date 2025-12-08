(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    // --- DOM references (obtained after DOM ready) ---
    const tableBody = document.querySelector('#paymentsTable tbody');
    const pagerEl = document.getElementById('paymentsPager');
    const pageInput = document.getElementById('paymentsPage');
    const perPageSelect = document.getElementById('paymentsPerPage');
    const loadBtn = document.getElementById('loadPaymentsBtn');
    const durationSelect = document.getElementById('paymentsDuration');
    const durationCustom = document.getElementById('durationCustom');
    const durationFrom = document.getElementById('durationFrom');
    const durationTo = document.getElementById('durationTo');

    const elFiltered = document.getElementById('summaryTotalFiltered');
    const elCashIn = document.getElementById('summaryCashIn');
    const elPrev = document.getElementById('summaryPrevDay');
    const elToday = document.getElementById('summaryToday');
    const elRefunded = document.getElementById('summaryRefunded');
    const elDisputed = document.getElementById('summaryDisputed');

    const modal = document.getElementById('paymentsModal');
    const closeIcon = document.getElementById('paymentsModalClose');
    const closeBtn = document.getElementById('closeBtn');
    const titleEl = document.getElementById('paymentsModalTitle');
    const detailsBody = document.querySelector('#paymentsDetailsTable tbody');
    const itemsBody = document.querySelector('#paymentsItemsTable tbody');
    const itemsTotalEl = document.getElementById('itemsTableTotal');
    const modalMsg = document.getElementById('paymentsModalMsg');
    const preEl = document.getElementById('paymentsModalBody');
    const refundBtn = document.getElementById('refundBtn');

    // refund workflow UI element
    let refundWorkflowEl = null;

    // global state exposure
    window.__paymentsAdmin = window.__paymentsAdmin || {};
    window.__paymentsAdmin.duration = window.__paymentsAdmin.duration || { type: 'daily' };
    window.__paymentsAdmin.latestPayments = window.__paymentsAdmin.latestPayments || null;
    window.__paymentsAdmin._activeSummaryFilter = window.__paymentsAdmin._activeSummaryFilter || 'filtered';

    // --- Utilities ---
    function logd(...args) { if (window.console && console.log) console.log('[payments-admin]', ...args); }

    function formatMoney(amount, currency) {
      if (amount == null || Number.isNaN(Number(amount))) return '—';
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2 }).format(Number(amount));
      } catch (e) {
        return (currency ? currency + ' ' : '') + Number(amount).toFixed(2);
      }
    }

    function parseAmountCandidate(a) {
      if (a == null) return null;
      if (typeof a === 'object') {
        const v = a.value ?? a.amount ?? a.total ?? a.price ?? null;
        if (v == null) return null;
        const num = Number(String(v).replace(/[^\d.-]+/g, ''));
        return Number.isNaN(num) ? null : num;
      }
      if (typeof a === 'string') {
        const cleaned = a.replace(/[^\d.-]+/g, '');
        const n = Number(cleaned);
        return Number.isNaN(n) ? null : n;
      }
      if (typeof a === 'number') return a;
      return null;
    }

    function parseDateField(d) {
      if (!d) return null;
      const dt = new Date(d);
      if (!isNaN(dt)) return dt;
      const n = Number(d);
      if (!Number.isNaN(n)) return new Date(n);
      return null;
    }

    function parseRawResponse(raw) {
      if (!raw) return null;
      if (typeof raw === 'object') return raw;
      if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch (e) {
          const first = raw.indexOf('{');
          if (first >= 0) {
            try { return JSON.parse(raw.slice(first)); } catch (e2) { return null; }
          }
          return null;
        }
      }
      return null;
    }

    function normalizeAmountObj(a) {
      if (a == null) return null;
      if (typeof a === 'object') {
        const v = a.value ?? a.amount ?? a.total ?? a.price ?? null;
        const cur = a.currency_code ?? a.currency ?? a.currencyCode ?? null;
        const n = parseAmountCandidate(v);
        return n == null ? null : { amount: n, currency: cur || null };
      }
      const n = parseAmountCandidate(a);
      return n == null ? null : { amount: n, currency: null };
    }

    // --- Data helpers ---
    function extractProductTitle(payment) {
      try {
        const rr = parseRawResponse(payment.raw_response);
        if (!rr) return null;
        const pu = rr.purchase_units || rr.purchaseUnits || [];
        const pu0 = pu[0] || {};
        const items = pu0.items || pu0.item || [];
        if (Array.isArray(items) && items.length) {
          const it = items[0];
          return it.name || it.title || it.description || null;
        }
        if (Array.isArray(rr.items) && rr.items.length) {
          const it = rr.items[0];
          return it.name || it.title || it.description || null;
        }
        return null;
      } catch (e) { return null; }
    }

    function extractPaypalFee(payment) {
      try {
        const rr = parseRawResponse(payment.raw_response);
        if (!rr) return null;
        const purchase_units = rr.purchase_units || rr.purchaseUnits || [];
        if (purchase_units && purchase_units[0]) {
          const pu0 = purchase_units[0];
          const payments = pu0.payments || pu0.payments;
          const captures = (payments && payments.captures) || pu0.captures || [];
          const cap = captures && captures[0];
          if (cap && cap.seller_receivable_breakdown && cap.seller_receivable_breakdown.paypal_fee) {
            return cap.seller_receivable_breakdown.paypal_fee;
          }
        }
        if (rr.transactions && Array.isArray(rr.transactions) && rr.transactions[0]) {
          const tr = rr.transactions[0];
          if (tr.related_resources && tr.related_resources[0] && tr.related_resources[0].sale && tr.related_resources[0].sale.transaction_fee) {
            return tr.related_resources[0].sale.transaction_fee;
          }
          if (tr.transaction_fee) return tr.transaction_fee;
        }
        const cand = rr.paypal_fee || rr.fee || rr.processing_fee || rr.fees || rr.processing_fee_amount || rr.fee_amount;
        if (cand) return cand;
        return null;
      } catch (e) {
        return null;
      }
    }

    function getPaymentAmount(payment) {
      if (!payment) return null;
      const candidates = [
        payment.amount,
        payment.total_amount,
        payment.total,
        (payment.purchase_units && payment.purchase_units[0] && payment.purchase_units[0].amount && (payment.purchase_units[0].amount.value || payment.purchase_units[0].amount.total)) || null,
        (payment.transactions && payment.transactions[0] && payment.transactions[0].amount && (payment.transactions[0].amount.total || payment.transactions[0].amount.value)) || null,
        payment.order && (payment.order.total_amount || payment.order.total) || null
      ];
      for (const c of candidates) {
        const n = parseAmountCandidate(c);
        if (n != null) return n;
      }
      return null;
    }

    function getPaymentDate(payment) {
      if (!payment) return null;
      const d = payment.created_at || payment.created || payment.date || payment.timestamp || payment.time;
      if (!d) return null;
      const parsed = new Date(d);
      if (!isNaN(parsed)) return parsed;
      const num = Number(d);
      if (!Number.isNaN(num)) return new Date(num);
      return null;
    }

    function extractItems(payment) {
      if (!payment) return null;
      if (Array.isArray(payment.items) && payment.items.length) return payment.items;
      if (payment.purchase_units && payment.purchase_units[0] && Array.isArray(payment.purchase_units[0].items)) return payment.purchase_units[0].items;
      if (payment.transactions && payment.transactions[0] && payment.transactions[0].item_list && Array.isArray(payment.transactions[0].item_list.items)) return payment.transactions[0].item_list.items;
      if (Array.isArray(payment.line_items) && payment.line_items.length) return payment.line_items;
      for (const k in payment) {
        if (Array.isArray(payment[k]) && payment[k].length && payment[k][0] && (payment[k][0].name || payment[k][0].sku || payment[k][0].description)) return payment[k];
      }
      return null;
    }

    // --- Refund/dispute helpers ---
    function _sumRefundsFromRefundObjects(refundsArray) {
      if (!Array.isArray(refundsArray)) return 0;
      let total = 0;
      for (const r of refundsArray) {
        if (!r) continue;
        if (r.amount) {
          const n = parseAmountCandidate(r.amount);
          if (n != null) { total += n; continue; }
          const v = r.amount.value || r.amount.total || r.amount.amount || null;
          const m = parseAmountCandidate(v);
          if (m != null) { total += m; continue; }
        }
        const direct = parseAmountCandidate(r.value ?? r.refund_amount ?? r.total ?? r.amount);
        if (direct != null) { total += direct; continue; }
        try {
          const s = JSON.stringify(r);
          const m = s.match(/"value"\s*:\s*"?(?<num>[\d,\.]+)"?/);
          if (m && m.groups && m.groups.num) total += parseFloat(m.groups.num.replace(/,/g, ''));
        } catch (e) { /* ignore */ }
      }
      return total;
    }

    function getRefundedAmount(payment) {
      try {
        const rr = parseRawResponse(payment.raw_response);
        if (rr && rr._refunds && Array.isArray(rr._refunds) && rr._refunds.length) {
          return _sumRefundsFromRefundObjects(rr._refunds);
        }
        if (rr && rr.purchase_units && rr.purchase_units[0]) {
          const pu0 = rr.purchase_units[0];
          const payments = pu0.payments || {};
          const captures = (payments && payments.captures) || pu0.captures || [];
          for (const c of captures) {
            if (c && c.refunds && Array.isArray(c.refunds) && c.refunds.length) {
              return _sumRefundsFromRefundObjects(c.refunds);
            }
          }
        }
        if (rr && rr.transactions && Array.isArray(rr.transactions)) {
          for (const tr of rr.transactions) {
            if (tr.related_resources && Array.isArray(tr.related_resources)) {
              for (const rr2 of tr.related_resources) {
                if (rr2.refund) {
                  const n = parseAmountCandidate(rr2.refund.amount || rr2.refund);
                  if (n != null) return n;
                }
              }
            }
          }
        }
      } catch (e) { /* ignore */ }
      if (payment.status && /refund/i.test(String(payment.status))) {
        const amt = getPaymentAmount(payment);
        return amt != null ? amt : 0;
      }
      return 0;
    }

    function getDisputedAmount(payment) {
      try {
        if (payment.status && /disput/i.test(String(payment.status))) {
          const amt = getPaymentAmount(payment);
          return amt != null ? amt : 0;
        }
        const rr = parseRawResponse(payment.raw_response);
        if (!rr) return 0;
        if (rr.dispute || rr.disputes) {
          const d = rr.dispute || (Array.isArray(rr.disputes) && rr.disputes[0]) || null;
          if (d) {
            const n = parseAmountCandidate(d.amount || d.value || d.disputed_amount || d.claimed_amount);
            if (n != null) return n;
          }
          const amt = getPaymentAmount(payment);
          return amt != null ? amt : 0;
        }
      } catch (e) { /* ignore */ }
      return 0;
    }

    function getRefundDate(payment) {
      try {
        const rr = parseRawResponse(payment.raw_response);
        if (!rr) return null;
        if (rr._refunds && Array.isArray(rr._refunds) && rr._refunds.length) {
          for (const r of rr._refunds) {
            if (r && (r.created_at || r.create_time || r.time)) return parseDateField(r.created_at || r.create_time || r.time);
          }
        }
        if (rr.purchase_units && rr.purchase_units[0]) {
          const pu0 = rr.purchase_units[0];
          const payments = pu0.payments || {};
          const captures = (payments && payments.captures) || pu0.captures || [];
          for (const c of captures) {
            if (c && c.refunds && Array.isArray(c.refunds)) {
              for (const rf of c.refunds) {
                if (rf && (rf.create_time || rf.create_at || rf.time)) return parseDateField(rf.create_time || rf.create_at || rf.time);
              }
            }
          }
        }
      } catch (e) { /* ignore */ }
      return null;
    }

    function getNetAmount(payment) {
      const gross = getPaymentAmount(payment) || 0;
      const refunded = getRefundedAmount(payment) || 0;
      const disputed = getDisputedAmount(payment) || 0;
      const net = gross - refunded - disputed;
      return Number(net);
    }

    function refundEligible(payment) {
      const created = getPaymentDate(payment);
      if (!created) return { eligible: null, days: null };
      const now = new Date();
      const days = Math.floor((now - created) / (24 * 3600 * 1000));
      const eligible = days <= 3;
      return { eligible, days };
    }

    // --- Modal rendering ---
    function clearTableBodies() {
      if (detailsBody) detailsBody.innerHTML = '';
      if (itemsBody) itemsBody.innerHTML = '';
      if (itemsTotalEl) itemsTotalEl.textContent = '—';
      if (modalMsg) modalMsg.textContent = '';
      if (refundWorkflowEl && refundWorkflowEl.parentNode) refundWorkflowEl.parentNode.removeChild(refundWorkflowEl);
      refundWorkflowEl = null;
    }

    function fmtMoneyDisplay(value, currency) {
      if (value == null) return '—';
      try { return formatMoney(value, currency); } catch (e) { return String(value); }
    }

    function renderDetails(payment) {
      if (!detailsBody) return;
      const rows = [];
      rows.push(['Payment ID', payment.id || payment.payment_id || payment.paymentId || '']);
      rows.push(['Provider', payment.provider || payment.gateway || '']);
      rows.push(['Order ID', payment.order_id || payment.orderId || (payment.order && (payment.order.order_number || payment.order_number)) || '']);
      rows.push(['Capture ID', payment.provider_capture_id || payment.capture_id || payment.provider_capture || '']);

      const gross = getPaymentAmount(payment);
      const currency = payment.currency || (payment.purchase_units && payment.purchase_units[0] && payment.purchase_units[0].amount && (payment.purchase_units[0].amount.currency_code || payment.purchase_units[0].amount.currency)) || payment.currency_code || 'USD';
      rows.push(['Gross Amount', gross != null ? fmtMoneyDisplay(gross, currency) : '—']);

      const feeObj = normalizeAmountObj(extractPaypalFee(payment));
      rows.push(['PayPal Fee', feeObj && feeObj.amount != null ? fmtMoneyDisplay(feeObj.amount, feeObj.currency || currency) : '—']);

      const refunded = getRefundedAmount(payment);
      rows.push(['Refunded Amount', refunded ? fmtMoneyDisplay(refunded, currency) : '—']);

      const disputed = getDisputedAmount(payment);
      rows.push(['Disputed Amount', disputed ? fmtMoneyDisplay(disputed, currency) : '—']);

      const net = getNetAmount(payment);
      rows.push(['Net Received', fmtMoneyDisplay(net, currency)]);

      let orderTotal = payment.order && (payment.order.total_amount || payment.order.total) || payment.order_total || payment.total_amount || null;
      if (!orderTotal && gross) orderTotal = gross;
      rows.push(['Order Total', orderTotal != null ? fmtMoneyDisplay(parseAmountCandidate(orderTotal) || orderTotal, currency) : '—']);

      const location = (function () { try { return (payment.payer && payment.payer.address && (payment.payer.address.city || payment.payer.address.country)) || payment.payer_email || '—'; } catch (e) { return '—'; } })();
      rows.push(['Location', location]);

      const elig = refundEligible(payment);
      if (elig && typeof elig.eligible === 'boolean') {
        rows.push(['Refund Eligibility', elig.eligible ? `Eligible (within ${elig.days} day(s))` : `Not eligible (created ${elig.days} day(s) ago)`]);
      } else {
        rows.push(['Refund Eligibility', 'Unknown']);
      }

      rows.push(['Status', payment.status || payment.state || '']);
      rows.push(['Payer', (payment.payer && (payment.payer.name || (payment.payer.name && payment.payer.name.given_name) || payment.payer.username)) || payment.payer_name || payment.customer || payment.payer_email || '']);
      rows.push(['Email', (payment.payer && (payment.payer.email_address || payment.payer.email)) || payment.email || payment.payer_email || '']);
      rows.push(['Created', payment.created_at || payment.created || payment.date || '']);

      detailsBody.innerHTML = '';
      rows.forEach(([k, v]) => {
        const tr = document.createElement('tr');
        if (k === 'Order Total' || k === 'Net Received') tr.classList.add('order-total');
        if (k === 'Refunded Amount' && v && v !== '—') tr.classList.add('refund-row');
        if (k === 'Disputed Amount' && v && v !== '—') tr.classList.add('dispute-row');
        const tdKey = document.createElement('td'); tdKey.className = 'key'; tdKey.textContent = k;
        const tdVal = document.createElement('td'); tdVal.className = 'value'; tdVal.textContent = (v === null || v === undefined || v === '') ? '—' : v;
        tr.appendChild(tdKey); tr.appendChild(tdVal);
        detailsBody.appendChild(tr);
      });

      try {
        const rr = parseRawResponse(payment.raw_response) || {};
        const refunds = rr._refunds || [];
        if (refunds && refunds.length) {
          const container = document.createElement('div');
          container.className = 'refunds-list';
          const title = document.createElement('div'); title.style.fontWeight = '800'; title.style.marginBottom = '6px'; title.textContent = 'Refund records';
          container.appendChild(title);
          refunds.forEach(r => {
            const rn = document.createElement('div'); rn.className = 'refund-item';
            const label = document.createElement('div'); label.textContent = r.id ? `Refund ${r.id}` : (r.reason || 'Refund');
            const amount = document.createElement('div'); const val = parseAmountCandidate(r.amount) ?? parseAmountCandidate(r.value) ?? parseAmountCandidate(r.refund_amount) ?? 0;
            amount.textContent = val ? fmtMoneyDisplay(val, currency) : '—';
            rn.appendChild(label); rn.appendChild(amount);
            container.appendChild(rn);
          });
          detailsBody.parentNode.appendChild(container);
        }
      } catch (e) { /* ignore */ }
    }

    function renderItems(items, payment) {
      if (!itemsBody) return;
      itemsBody.innerHTML = '';
      if (!items || !items.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td'); td.colSpan = 5; td.style.padding = '12px'; td.style.color = 'var(--muted, #7b8790)';
        td.textContent = 'No itemized data available for this payment.';
        tr.appendChild(td); itemsBody.appendChild(tr);
        itemsTotalEl && (itemsTotalEl.textContent = (payment && (payment.total_amount || payment.total || payment.amount)) ? fmtMoneyDisplay(getPaymentAmount(payment), payment.currency || 'USD') : '—');
        return;
      }

      let runningTotal = 0;
      items.forEach(it => {
        const sku = it.sku || it.id || it.product_id || it.price_id || '';
        const name = it.name || it.description || it.title || '';
        const qty = (it.quantity || it.qty || it.count || 1);
        let unit = it.price || (it.unit_amount && (it.unit_amount.value || it.unit_amount)) || it.unitPrice || it.unit_price || '';
        let total = it.total || it.amount || it.price_total || it.line_total || '';
        if (typeof unit === 'object') unit = unit.value || '';
        if (typeof total === 'object') total = total.value || '';
        if ((!total || total === '') && unit !== '' && !isNaN(parseFloat(unit))) {
          total = (parseFloat(unit) * Number(qty || 1)).toFixed(2);
        }

        const numericTotal = Number(total || 0);
        if (!isNaN(numericTotal)) runningTotal += numericTotal;

        const tr = document.createElement('tr');
        const tdSku = document.createElement('td'); tdSku.textContent = sku || '—'; tdSku.setAttribute('data-label', 'SKU / ID');
        const tdName = document.createElement('td'); tdName.textContent = name || '—'; tdName.setAttribute('data-label', 'Product');
        const tdQty = document.createElement('td'); tdQty.textContent = qty; tdQty.setAttribute('data-label', 'Qty');
        const tdUnit = document.createElement('td'); tdUnit.textContent = unit ? fmtMoneyDisplay(parseAmountCandidate(unit) || unit, payment && payment.currency) : (it.currency ? fmtMoneyDisplay(parseAmountCandidate(unit) || unit, it.currency) : '—'); tdUnit.setAttribute('data-label', 'Unit');
        const tdTotal = document.createElement('td'); tdTotal.textContent = total ? fmtMoneyDisplay(parseAmountCandidate(total) || total, payment && payment.currency) : '—'; tdTotal.setAttribute('data-label', 'Total'); tdTotal.className = 'total';

        tr.appendChild(tdSku); tr.appendChild(tdName); tr.appendChild(tdQty); tr.appendChild(tdUnit); tr.appendChild(tdTotal);
        itemsBody.appendChild(tr);
      });

      const explicitTotal = payment && (payment.total_amount || payment.total || (payment.order && (payment.order.total_amount || payment.order.total)));
      itemsTotalEl && (itemsTotalEl.textContent = explicitTotal ? fmtMoneyDisplay(parseAmountCandidate(explicitTotal) || explicitTotal, payment && payment.currency) : fmtMoneyDisplay(runningTotal, payment && payment.currency));
    }

    function showModal() {
      if (!modal) return;
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
    }

    function hideModal() {
      if (!modal) return;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      if (refundWorkflowEl && refundWorkflowEl.parentNode) refundWorkflowEl.parentNode.removeChild(refundWorkflowEl);
      refundWorkflowEl = null;
    }

    let currentModalPayment = null;

    function showPayment(payment) {
      if (!payment) return;
      currentModalPayment = payment;
      clearTableBodies();
      titleEl && (titleEl.textContent = 'Payment details — ' + (payment.id || payment.payment_id || payment.paymentId || ''));
      renderDetails(payment);
      const items = extractItems(payment);
      renderItems(items, payment);

      if (modalMsg) modalMsg.innerHTML = '';
      const statusVal = (payment.status || payment.state || '') + '';
      if (modalMsg && statusVal) {
        const span = document.createElement('span');
        const lower = statusVal.toLowerCase();
        let cls = 'success';
        if (lower.includes('fail') || lower.includes('decline')) cls = 'failed';
        else if (lower.includes('refund')) cls = 'refunded';
        else if (lower.includes('pend')) cls = 'pending';
        span.className = 'modal-badge ' + cls;
        span.textContent = statusVal;
        modalMsg.appendChild(span);
      }
      if (preEl) preEl.style.display = 'none';
      showModal();
    }

    // modal close wiring
    closeIcon && closeIcon.addEventListener('click', hideModal);
    closeBtn && closeBtn.addEventListener('click', hideModal);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && modal.getAttribute('aria-hidden') === 'false') hideModal();
    });

    // Try convert legacy pre block to modal (if present)
    function tryConvertPreContent() {
      if (!preEl) return;
      const txt = preEl.textContent && preEl.textContent.trim();
      if (!txt) return;
      if (!(txt.startsWith('{') || txt.startsWith('['))) return;
      try {
        const obj = JSON.parse(txt);
        const payment = (obj && obj.payment) ? obj.payment : obj;
        showPayment(payment);
      } catch (e) { /* ignore */ }
    }
    if (preEl && window.MutationObserver) {
      const mo = new MutationObserver(() => setTimeout(tryConvertPreContent, 40));
      mo.observe(preEl, { characterData: true, childList: true, subtree: true });
    }
    setTimeout(tryConvertPreContent, 120);

    // --- Refund workflow UI + actions ---
    function buildRefundWorkflow(payment) {
      if (!payment) return null;
      if (refundWorkflowEl && refundWorkflowEl.parentNode) refundWorkflowEl.parentNode.removeChild(refundWorkflowEl);

      refundWorkflowEl = document.createElement('div');
      refundWorkflowEl.id = 'refundWorkflow';
      refundWorkflowEl.style.marginTop = '12px';
      refundWorkflowEl.style.padding = '12px';
      refundWorkflowEl.style.borderTop = '1px solid rgba(20,30,40,0.04)';
      refundWorkflowEl.style.display = 'flex';
      refundWorkflowEl.style.flexDirection = 'column';
      refundWorkflowEl.style.gap = '10px';

      const header = document.createElement('div'); header.style.fontWeight = 800; header.textContent = 'Refund / Hold / Review Options';
      refundWorkflowEl.appendChild(header);

      const actionsWrap = document.createElement('div');
      actionsWrap.style.display = 'flex';
      actionsWrap.style.flexDirection = 'column';
      actionsWrap.style.gap = '8px';

      const actionOptions = [
        { id: 'act_hold', val: 'hold', label: 'On hold (do not return funds to customer yet)' },
        { id: 'act_review', val: 'review', label: 'Review claim/complaint (internal) — funds remain on hold' },
        { id: 'act_refund', val: 'refund', label: 'Refund now (choose amount)' },
        { id: 'act_reject', val: 'rejected', label: 'Rejected / Settled (no refund — funds retained)' }
      ];

      actionOptions.forEach(opt => {
        const row = document.createElement('label');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '10px';
        const r = document.createElement('input');
        r.type = 'radio';
        r.name = 'refundActionType';
        r.value = opt.val;
        r.id = opt.id;
        if (opt.val === 'refund') r.checked = true;
        const lab = document.createElement('span'); lab.textContent = opt.label;
        row.appendChild(r); row.appendChild(lab);
        actionsWrap.appendChild(row);
      });

      refundWorkflowEl.appendChild(actionsWrap);

      const refundAmountWrap = document.createElement('div');
      refundAmountWrap.id = 'refundAmountWrap';
      refundAmountWrap.style.display = 'flex';
      refundAmountWrap.style.flexDirection = 'column';
      refundAmountWrap.style.gap = '8px';
      refundAmountWrap.style.marginLeft = '18px';

      const pctLabel = document.createElement('div'); pctLabel.style.fontWeight = 700; pctLabel.textContent = 'Refund amount';
      refundAmountWrap.appendChild(pctLabel);

      const percents = [25, 50, 100];
      const pctRow = document.createElement('div'); pctRow.style.display = 'flex'; pctRow.style.gap = '8px';
      percents.forEach(p => {
        const l = document.createElement('label');
        l.style.display = 'inline-flex'; l.style.alignItems = 'center'; l.style.gap = '6px';
        const rr = document.createElement('input');
        rr.type = 'radio'; rr.name = 'refundPercent'; rr.value = String(p);
        if (p === 100) rr.checked = true;
        l.appendChild(rr);
        l.appendChild(document.createTextNode(`${p}%`));
        pctRow.appendChild(l);
      });
      refundAmountWrap.appendChild(pctRow);

      const customRow = document.createElement('div'); customRow.style.display = 'flex'; customRow.style.gap = '8px'; customRow.style.alignItems = 'center';
      const customLabel = document.createElement('label'); customLabel.textContent = 'Or enter amount:';
      const customInput = document.createElement('input'); customInput.type = 'number'; customInput.min = '0'; customInput.step = '0.01';
      customInput.placeholder = '0.00';
      customInput.style.padding = '8px'; customInput.style.borderRadius = '6px'; customInput.style.border = '1px solid #e6e9ea';
      customRow.appendChild(customLabel); customRow.appendChild(customInput);
      refundAmountWrap.appendChild(customRow);

      const refundNote = document.createElement('textarea');
      refundNote.placeholder = 'Optional note / reason for refund or hold...';
      refundNote.style.padding = '8px';
      refundNote.style.borderRadius = '6px';
      refundNote.style.border = '1px solid #e6e9ea';
      refundNote.style.minHeight = '64px';
      refundNote.style.resize = 'vertical';
      refundAmountWrap.appendChild(refundNote);

      refundWorkflowEl.appendChild(refundAmountWrap);

      const btnRow = document.createElement('div'); btnRow.style.display = 'flex'; btnRow.style.gap = '8px'; btnRow.style.justifyContent = 'flex-end';
      const confirmBtn = document.createElement('button'); confirmBtn.id = 'confirmRefundAction'; confirmBtn.className = 'btn'; confirmBtn.textContent = 'Confirm';
      const cancelBtn = document.createElement('button'); cancelBtn.id = 'cancelRefundAction'; cancelBtn.className = 'action-btn ghost'; cancelBtn.textContent = 'Cancel';
      btnRow.appendChild(cancelBtn); btnRow.appendChild(confirmBtn);
      refundWorkflowEl.appendChild(btnRow);

      function updateRefundAmountVisibility() {
        const sel = refundWorkflowEl.querySelector('input[name="refundActionType"]:checked');
        if (!sel) return;
        if (sel.value === 'refund') refundAmountWrap.style.display = 'flex';
        else refundAmountWrap.style.display = 'none';
      }
      refundWorkflowEl.querySelectorAll('input[name="refundActionType"]').forEach(i => i.addEventListener('change', updateRefundAmountVisibility));
      updateRefundAmountVisibility();

      cancelBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (refundWorkflowEl && refundWorkflowEl.parentNode) refundWorkflowEl.parentNode.removeChild(refundWorkflowEl);
        refundWorkflowEl = null;
      });

      confirmBtn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const actionSelected = refundWorkflowEl.querySelector('input[name="refundActionType"]:checked').value;
        let refundAmount = null;
        let refundPercent = null;
        if (actionSelected === 'refund') {
          const customVal = parseFloat(customInput.value || '0');
          if (customVal && customVal > 0) {
            refundAmount = customVal;
          } else {
            const chosenPercEl = refundWorkflowEl.querySelector('input[name="refundPercent"]:checked');
            if (chosenPercEl) {
              refundPercent = Number(chosenPercEl.value);
              const gross = getPaymentAmount(payment) || 0;
              refundAmount = Math.round(((gross * refundPercent) / 100) * 100) / 100;
            } else {
              refundPercent = 100;
              refundAmount = getPaymentAmount(payment) || 0;
            }
          }
        }

        const payload = {
          payment_id: payment.id || payment.payment_id || payment.paymentId || null,
          action: actionSelected === 'hold' ? 'hold' : (actionSelected === 'review' ? 'review' : (actionSelected === 'rejected' ? 'rejected' : 'refund')),
          refund_amount: refundAmount != null ? Number(refundAmount) : null,
          refund_percent: refundPercent != null ? Number(refundPercent) : null,
          note: refundNote.value || ''
        };

        if (!payload.payment_id) {
          alert('Cannot determine payment id for action.');
          return;
        }

        if (payload.action === 'rejected') {
          const ok = confirm('Mark dispute as REJECTED/SETTLED (no refund)? This will retain funds as sales.');
          if (!ok) return;
        }

        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Processing...';
        try {
          const resp = await fetch('/payments-admin/api/refund', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!resp.ok) {
            const txt = await resp.text().catch(() => '');
            throw new Error(`Server responded ${resp.status}: ${txt}`);
          }
          const js = await resp.json().catch(() => null);
          const msg = (js && js.message) ? js.message : 'Action completed';
          const suc = document.createElement('div'); suc.style.color = 'var(--text-dark)'; suc.style.fontWeight = '700'; suc.textContent = msg;
          refundWorkflowEl.appendChild(suc);

          const pg = Number(pageInput.value || 1) || 1;
          const pp = Number(perPageSelect.value || perPageSelect.textContent || 25) || 25;
          await fetchPayments(pg, pp);

          setTimeout(() => {
            if (refundWorkflowEl && refundWorkflowEl.parentNode) refundWorkflowEl.parentNode.removeChild(refundWorkflowEl);
            refundWorkflowEl = null;
            if (js && js.updated_payment) {
              showPayment(js.updated_payment);
            } else {
              try {
                const latest = window.__paymentsAdmin && window.__paymentsAdmin.latestPayments || [];
                const found = latest.find(p => (p.id == payload.payment_id) || (p.payment_id == payload.payment_id));
                if (found) showPayment(found);
              } catch (e) { /* ignore */ }
            }
          }, 600);
        } catch (err) {
          console.error('Refund action error', err);
          alert('Action failed: ' + (err && err.message ? err.message : String(err)));
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Confirm';
        }
      });

      return refundWorkflowEl;
    }

    function wireRefundButton() {
      if (!refundBtn) return;
      refundBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!currentModalPayment) {
          alert('No payment loaded.');
          return;
        }
        const container = document.getElementById('paymentsModalContent') || (modal && modal.querySelector('.modal-card'));
        if (!container) return;
        if (refundWorkflowEl && refundWorkflowEl.parentNode) refundWorkflowEl.parentNode.removeChild(refundWorkflowEl);
        refundWorkflowEl = buildRefundWorkflow(currentModalPayment);
        container.appendChild(refundWorkflowEl);
        setTimeout(() => {
          const first = refundWorkflowEl.querySelector('input[name="refundActionType"]');
          if (first) first.focus();
        }, 40);
      });
    }
    wireRefundButton();

    // --- Table rendering & fetcher ---
    function renderPaymentRow(payment) {
      const tr = document.createElement('tr');

      const refundedAmount = getRefundedAmount(payment);
      const disputedAmount = getDisputedAmount(payment);
      const net = getNetAmount(payment);
      const created = getPaymentDate(payment);
      const eligibility = refundEligible(payment);
      const isRefunded = refundedAmount && refundedAmount > 0;
      const isDisputed = disputedAmount && disputedAmount > 0;
      const overdue = (!isRefunded && eligibility.days != null && eligibility.days > 3);

      if (isRefunded) tr.classList.add('row-refunded');
      if (isDisputed) tr.classList.add('row-disputed');
      if (overdue) tr.classList.add('row-refund-overdue');

      try {
        tr.dataset.net = String(net != null ? net : '');
        tr.dataset.refunded = isRefunded ? '1' : '0';
        tr.dataset.disputed = isDisputed ? '1' : '0';
        tr.dataset.created = created ? created.toISOString() : '';
        tr.dataset.amount = String(getPaymentAmount(payment) || '');
        tr.dataset.orderId = (payment.order && (payment.order.order_number || payment.order.id)) || payment.order_id || '';
      } catch (e) { /* ignore */ }

      const tdId = document.createElement('td'); tdId.textContent = payment.id != null ? String(payment.id) : '—'; tr.appendChild(tdId);
      const tdProvider = document.createElement('td'); tdProvider.textContent = payment.provider || '—'; tr.appendChild(tdProvider);

      const tdOrder = document.createElement('td');
      const orderNumber = (payment.order && (payment.order.order_number || payment.order.id)) || payment.order_id || '—';
      const productTitle = extractProductTitle(payment) || (payment.order && payment.order.product_title) || '';
      let orderHtml = `<div style="font-weight:700">${orderNumber}</div>`;
      if (productTitle) {
        orderHtml += `<div style="color:var(--muted);font-size:0.95em;margin-top:4px">${productTitle}`;
        if (isRefunded) orderHtml += ` <span class="badge refunded" title="Refunded amount">${fmtMoneyDisplay(refundedAmount, payment.currency)}</span>`;
        if (isDisputed) orderHtml += ` <span class="badge disputed" title="Disputed amount">${fmtMoneyDisplay(disputedAmount, payment.currency)}</span>`;
        if (overdue) orderHtml += ` <span class="badge refund-overdue" title="Refund overdue">Overdue</span>`;
        orderHtml += `</div>`;
      } else {
        if (isRefunded || isDisputed || overdue) {
          orderHtml += `<div style="color:var(--muted);font-size:0.95em;margin-top:4px">`;
          if (isRefunded) orderHtml += `<span class="badge refunded" title="Refunded amount">${fmtMoneyDisplay(refundedAmount, payment.currency)}</span> `;
          if (isDisputed) orderHtml += `<span class="badge disputed" title="Disputed amount">${fmtMoneyDisplay(disputedAmount, payment.currency)}</span> `;
          if (overdue) orderHtml += `<span class="badge refund-overdue">Overdue</span>`;
          orderHtml += `</div>`;
        }
      }
      tdOrder.innerHTML = orderHtml;
      tr.appendChild(tdOrder);

      const tdCapture = document.createElement('td'); tdCapture.textContent = payment.provider_capture_id || payment.provider_capture || '—'; tr.appendChild(tdCapture);

      const tdAmount = document.createElement('td');
      const amtNum = getPaymentAmount(payment);
      tdAmount.textContent = amtNum != null ? formatMoney(amtNum, payment.currency || (payment.order && payment.order.currency) || 'USD') : '—';
      tr.appendChild(tdAmount);

      const tdFee = document.createElement('td'); tdFee.className = 'paypal-fee-cell';
      const feeObj = normalizeAmountObj(extractPaypalFee(payment));
      tdFee.textContent = feeObj && feeObj.amount != null ? formatMoney(feeObj.amount, feeObj.currency || payment.currency || 'USD') : '—';
      tr.appendChild(tdFee);

      const tdStatus = document.createElement('td'); tdStatus.textContent = payment.status || '—'; tr.appendChild(tdStatus);

      const tdPayer = document.createElement('td'); tdPayer.textContent = payment.payer_name || payment.payer || (payment.order && payment.order.customer_name) || '—'; tr.appendChild(tdPayer);
      const tdEmail = document.createElement('td'); tdEmail.textContent = payment.payer_email || (payment.order && payment.order.customer_email) || '—'; tr.appendChild(tdEmail);

      const tdCreated = document.createElement('td');
      if (payment.created_at) { const dt = parseDateField(payment.created_at); tdCreated.textContent = dt ? dt.toLocaleString() : payment.created_at; } else tdCreated.textContent = '—';
      tr.appendChild(tdCreated);

      const tdActions = document.createElement('td');
      const btnView = document.createElement('button'); btnView.className = 'action-btn'; btnView.textContent = 'View';
      btnView.addEventListener('click', () => { showPayment(payment); });
      tdActions.appendChild(btnView);
      tr.appendChild(tdActions);

      return tr;
    }

    function renderPaymentsTable(payments) {
      if (!tableBody) return;
      tableBody.innerHTML = '';
      if (!Array.isArray(payments) || payments.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td'); td.colSpan = 11; td.style.padding = '18px'; td.style.color = 'var(--muted)'; td.textContent = 'No payments found for this page/duration.';
        tr.appendChild(td); tableBody.appendChild(tr); return;
      }
      for (const p of payments) {
        const row = renderPaymentRow(p);
        tableBody.appendChild(row);
        document.dispatchEvent(new CustomEvent('payments:renderRow', { detail: { rowEl: row, payment: p } }));
      }
    }

    // --- Fetcher: passes duration params to server ---
    async function fetchPayments(page = 1, per_page = 25) {
      try {
        const url = new URL('/payments-admin/api/payments', window.location.origin);
        url.searchParams.set('page', String(page));
        url.searchParams.set('per_page', String(per_page));
        if (window.__paymentsAdmin && window.__paymentsAdmin.duration) {
          const d = window.__paymentsAdmin.duration;
          // Always send duration explicitly to server so server can apply date filters deterministically
          url.searchParams.set('duration', d.type || 'daily');
          if ((d.type === 'custom' || d.type === 'custom-range' || d.type === 'custom_range') && d.from) url.searchParams.set('from', d.from);
          if ((d.type === 'custom' || d.type === 'custom-range' || d.type === 'custom_range') && d.to) url.searchParams.set('to', d.to);
          // backward-compatible keys
          if (d.from && d.type !== 'custom') url.searchParams.set('from', d.from);
          if (d.to && d.type !== 'custom') url.searchParams.set('to', d.to);
        }
        logd('fetchPayments url', url.toString());
        const resp = await fetch(url.toString(), { credentials: 'same-origin' });
        if (!resp.ok) { console.warn('Failed to fetch payments:', resp.status); renderPaymentsTable([]); updateSummaries([]); return; }
        const js = await resp.json();
        const items = js.items || [];
        for (const it of items) {
          if (it.raw_response && typeof it.raw_response === 'string') {
            try { it.raw_response = JSON.parse(it.raw_response); } catch (e) { /* leave string */ }
          }
        }
        renderPaymentsTable(items);
        updateSummaries(items);
        if (pagerEl) pagerEl.textContent = `Page ${js.page || page} — ${js.total || items.length} total`;
        document.dispatchEvent(new CustomEvent('payments:rendered', { detail: { payments: items, page: js.page || page } }));
      } catch (err) {
        console.error('Error loading payments', err);
        renderPaymentsTable([]); updateSummaries([]);
      }
    }

    // --- Summaries ---
    function computeTotalsFromPayments(payments) {
      const totals = { filteredTotal: 0, cashIn: 0, prevDay: 0, today: 0, refundedTotal: 0, disputedTotal: 0, currency: null };
      if (!payments || !payments.length) return totals;
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterdayStart = new Date(todayStart.getTime() - 24 * 3600 * 1000);
      const yesterdayEnd = new Date(todayStart.getTime() - 1);
      for (const p of payments) {
        const net = getNetAmount(p);
        if (net == null) continue;
        totals.filteredTotal += net;
        totals.cashIn += net;
        if (!totals.currency) totals.currency = p.currency || (p.purchase_units && p.purchase_units[0] && p.purchase_units[0].amount && (p.purchase_units[0].amount.currency_code || p.purchase_units[0].amount.currency)) || 'USD';
        const pd = getPaymentDate(p);
        if (pd) {
          if (pd >= todayStart) totals.today += net;
          else if (pd >= yesterdayStart && pd <= yesterdayEnd) totals.prevDay += net;
        }
        const refunded = getRefundedAmount(p) || 0;
        const disputed = getDisputedAmount(p) || 0;
        totals.refundedTotal += refunded;
        totals.disputedTotal += disputed;
      }
      return totals;
    }

    function updateSummaryUI(totals) {
      const c = totals.currency || 'USD';
      if (elFiltered) elFiltered.textContent = formatMoney(totals.filteredTotal || 0, c);
      if (elCashIn) elCashIn.textContent = formatMoney(totals.cashIn || 0, c);
      if (elPrev) elPrev.textContent = (typeof totals.prevDay === 'number') ? formatMoney(totals.prevDay || 0, c) : '—';
      if (elToday) elToday.textContent = (typeof totals.today === 'number') ? formatMoney(totals.today || 0, c) : '—';
      if (elRefunded) elRefunded.textContent = formatMoney(totals.refundedTotal || 0, c);
      if (elDisputed) elDisputed.textContent = formatMoney(totals.disputedTotal || 0, c);
    }

    function updateSummaries(payments) {
      window.__paymentsAdmin = window.__paymentsAdmin || {};
      window.__paymentsAdmin.latestPayments = Array.isArray(payments) ? payments : window.__paymentsAdmin.latestPayments || null;
      const totals = Array.isArray(payments) ? computeTotalsFromPayments(payments) : computeTotalsFromPayments(window.__paymentsAdmin.latestPayments || []);
      updateSummaryUI(totals);
      document.dispatchEvent(new CustomEvent('payments:data', { detail: { payments: window.__paymentsAdmin.latestPayments || [] } }));
    }

    // --- Filtering behavior ---
    function clearActiveSummary() {
      const cards = document.querySelectorAll('.summary-card');
      cards.forEach(c => c.classList.remove('active'));
    }

    function applyCategoryFilter(category) {
      window.__paymentsAdmin._activeSummaryFilter = category || 'filtered';
      clearActiveSummary();
      const card = document.querySelector(`#${summaryIdForCategory(category)}`);
      if (card) card.classList.add('active');

      const rows = Array.from(tableBody ? tableBody.children : []);
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterdayStart = new Date(todayStart.getTime() - 24 * 3600 * 1000);
      const yesterdayEnd = new Date(todayStart.getTime() - 1);
      for (const r of rows) {
        if (!r.dataset) {
          r.style.display = '';
          continue;
        }
        const createdRaw = r.dataset.created;
        const createdDate = createdRaw ? new Date(createdRaw) : null;
        const netVal = parseFloat(r.dataset.net || '0') || 0;
        const isRefunded = r.dataset.refunded === '1';
        const isDisputed = r.dataset.disputed === '1';

        let show = true;
        if (!category || category === 'filtered') {
          show = true;
        } else if (category === 'cash-in') {
          show = netVal > 0;
        } else if (category === 'prev-day') {
          show = createdDate && (createdDate >= yesterdayStart && createdDate <= yesterdayEnd);
        } else if (category === 'today') {
          show = createdDate && (createdDate >= todayStart);
        } else if (category === 'refunded') {
          show = isRefunded;
        } else if (category === 'disputed') {
          show = isDisputed;
        } else {
          show = true;
        }
        r.style.display = show ? '' : 'none';
      }
      document.dispatchEvent(new CustomEvent('payments:filter', { detail: { filter: category } }));
    }

    function summaryIdForCategory(category) {
      switch (category) {
        case 'filtered': return 'summaryTotalFiltered';
        case 'cash-in': return 'summaryCashIn';
        case 'prev-day': return 'summaryPrevDay';
        case 'today': return 'summaryToday';
        case 'refunded': return 'summaryRefunded';
        case 'disputed': return 'summaryDisputed';
        default: return 'summaryTotalFiltered';
      }
    }

    function wireSummaryCardClicks() {
      const mapping = [
        { id: 'summaryTotalFiltered', cat: 'filtered' },
        { id: 'summaryCashIn', cat: 'cash-in' },
        { id: 'summaryPrevDay', cat: 'prev-day' },
        { id: 'summaryToday', cat: 'today' },
        { id: 'summaryRefunded', cat: 'refunded' },
        { id: 'summaryDisputed', cat: 'disputed' }
      ];
      mapping.forEach(m => {
        const el = document.getElementById(m.id);
        if (!el) return;
        const card = el.closest('.summary-card') || el;
        card.style.cursor = 'pointer';
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');
        card.addEventListener('click', () => applyCategoryFilter(m.cat));
        card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); applyCategoryFilter(m.cat); } });
      });
    }

    // --- Wiring: duration + load ---
    if (durationSelect) {
      durationSelect.addEventListener('change', (e) => {
        const v = e.target.value;
        window.__paymentsAdmin.duration.type = v;
        if (v === 'custom') durationCustom && (durationCustom.style.display = 'flex');
        else { if (durationCustom) durationCustom.style.display = 'none'; if (durationFrom) durationFrom.value = ''; if (durationTo) durationTo.value = ''; delete window.__paymentsAdmin.duration.from; delete window.__paymentsAdmin.duration.to; }
        logd('duration changed to', window.__paymentsAdmin.duration);
      });
    }

    [durationFrom, durationTo].forEach(el => el && el.addEventListener('change', () => {
      window.__paymentsAdmin.duration.from = durationFrom.value || null;
      window.__paymentsAdmin.duration.to = durationTo.value || null;
      // Mirror to canonical keys used by fetcher
      window.__paymentsAdmin.duration.from = durationFrom.value || null;
      window.__paymentsAdmin.duration.to = durationTo.value || null;
      logd('custom range set', window.__paymentsAdmin.duration);
    }));

    if (loadBtn) {
      loadBtn.addEventListener('click', () => {
        const pg = Number(pageInput.value || 1) || 1;
        const pp = Number(perPageSelect.value || perPageSelect.textContent || 25) || 25;
        document.dispatchEvent(new CustomEvent('payments:load', { detail: { page: pg, per_page: pp, duration: window.__paymentsAdmin.duration } }));
        fetchPayments(pg, pp);
      });
    } else {
      // fallback: Enter on page input
      pageInput && pageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { loadBtn && loadBtn.click(); } });
    }

    pageInput && pageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadBtn && loadBtn.click(); });

    // auto-initialize: fetch current page & wire summary clicks after a short delay for other scripts to register
    setTimeout(() => {
      const pg = Number(pageInput ? pageInput.value : 1) || 1;
      const pp = Number(perPageSelect ? perPageSelect.value : 25) || 25;
      fetchPayments(pg, pp);
      wireSummaryCardClicks();
    }, 120);

    // Listen for payments:rendered to reapply filter & wiring
    document.addEventListener('payments:rendered', (e) => {
      wireSummaryCardClicks();
      const current = window.__paymentsAdmin._activeSummaryFilter || 'filtered';
      applyCategoryFilter(current);
    });

    // Expose API
    window.__paymentsAdmin.fetchPayments = fetchPayments;
    window.__paymentsAdmin.showPayment = showPayment;
    window.__paymentsAdmin.hideModal = hideModal;
    window.__paymentsAdmin.updateSummaries = updateSummaries;
    window.__paymentsAdmin.applyCategoryFilter = applyCategoryFilter;

    // Listen for payments:renderRow to ensure each row has expected dataset and fee cell
    document.addEventListener('payments:renderRow', (e) => {
      try {
        const { rowEl, payment } = e.detail || {};
        if (!rowEl || !payment) return;
        let feeCell = rowEl.querySelector('.paypal-fee-cell');
        const cells = Array.from(rowEl.children);
        const insertIndex = 5;
        if (!feeCell) {
          feeCell = document.createElement('td');
          feeCell.className = 'paypal-fee-cell fee-cell';
          if (cells.length > insertIndex) rowEl.insertBefore(feeCell, rowEl.children[insertIndex]);
          else rowEl.appendChild(feeCell);
        }
        const feeObj = normalizeAmountObj(extractPaypalFee(payment));
        feeCell.textContent = feeObj && feeObj.amount != null ? formatMoney(feeObj.amount, feeObj.currency || payment.currency || 'USD') : '—';
        try {
          const refundedAmount = getRefundedAmount(payment);
          const disputedAmount = getDisputedAmount(payment);
          const net = getNetAmount(payment);
          const created = getPaymentDate(payment);
          rowEl.dataset.net = String(net != null ? net : '');
          rowEl.dataset.refunded = (refundedAmount && refundedAmount > 0) ? '1' : '0';
          rowEl.dataset.disputed = (disputedAmount && disputedAmount > 0) ? '1' : '0';
          rowEl.dataset.created = created ? created.toISOString() : '';
        } catch (err2) { /* ignore */ }
      } catch (err) { console.warn('payments:renderRow handler error', err); }
    });

    // Reapply active filter after table rendered
    document.addEventListener('payments:rendered', (e) => {
      wireSummaryCardClicks();
      const current = window.__paymentsAdmin._activeSummaryFilter || 'filtered';
      applyCategoryFilter(current);
    });

    logd('payments-admin.js initialized');
  }); // DOMContentLoaded end

})();