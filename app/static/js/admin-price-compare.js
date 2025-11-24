// static/js/admin-price-compare.js
// Robust wiring for admin price-comparison rows.
// Finds product-id inputs (class .pc-product-id or name="product_id") and our-price inputs
// (class .pc-our-price or name="our_price"), auto-fetches /api/product_by_id and fills the our-price.
(function () {
    const API = '/api';

    function q(sel, ctx) { return (ctx || document).querySelector(sel); }
    function qAll(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }
    function formatPriceValue(v) {
        const n = Number(v);
        if (!isFinite(n) || isNaN(n)) return '';
        return Number(n).toFixed(2);
    }

    // Try to locate the product-id and our-price inputs in a row.
    // Accepts multiple shapes: by class, by input[name], or inputs with placeholder hints.
    function findRowInputs(tr) {
        if (!tr) return {};
        // product id candidates
        const pidCandidates = [
            '.pc-product-id',
            'input[name="product_id"]',
            'input[name="product-id"]',
            'input[data-pc-product-id]',
            'input[placeholder*="Product ID"]',
            'input[placeholder*="product id"]'
        ];
        const ourPriceCandidates = [
            '.pc-our-price',
            'input[name="our_price"]',
            'input[name="our-price"]',
            'input[data-pc-our-price]',
            'input[placeholder*="our price"]',
            'input[placeholder*="auto"]'
        ];

        let pidInput = null, ourInput = null;
        for (const s of pidCandidates) {
            pidInput = q(s, tr);
            if (pidInput) break;
        }
        for (const s of ourPriceCandidates) {
            ourInput = q(s, tr);
            if (ourInput) break;
        }

        // If still not found, fall back to first two inputs in the row that look like text/number inputs
        if (!pidInput || !ourInput) {
            const inputs = qAll('input, select, textarea', tr).filter(i => !i.type || ['text', 'number', 'search'].includes(i.type));
            if (!pidInput && inputs[0]) pidInput = inputs[0];
            if (!ourInput && inputs[1]) ourInput = inputs[1];
        }

        return { pidInput, ourInput };
    }

    async function fetchProductById(productId) {
        if (!productId) return null;
        const url = `${API}/product_by_id?product_id=${encodeURIComponent(productId)}`;
        try {
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) return null;
            const js = await res.json();
            return js;
        } catch (err) {
            console.warn('fetchProductById error', err);
            return null;
        }
    }

    async function fillOurPriceForRow(tr) {
        const { pidInput, ourInput } = findRowInputs(tr);
        if (!pidInput || !ourInput) return;
        try {
            // make ourInput readonly / indicate auto fill
            try {
                ourInput.readOnly = true;
                ourInput.placeholder = ourInput.placeholder || 'auto';
                ourInput.title = 'Auto-filled from product database (read-only)';
                ourInput.classList.add('pc-our-price-auto');
            } catch (e) { /* ignore */ }

            const pid = (pidInput.value || '').trim();
            if (!pid) {
                ourInput.value = '';
                return;
            }
            const product = await fetchProductById(pid);
            if (!product) {
                ourInput.value = '';
                return;
            }
            // product may be shaped directly or inside data object
            const price = (typeof product.price !== 'undefined') ? product.price : (product.data && product.data.price ? product.data.price : null);
            ourInput.value = formatPriceValue(price);
        } catch (err) {
            console.warn('fillOurPriceForRow error', err);
        }
    }

    // Wire event listeners for a row
    function wireRow(tr) {
        if (!tr || tr._pcWired) return;
        tr._pcWired = true;
        const { pidInput } = findRowInputs(tr);
        if (!pidInput) return;
        const handler = () => {
            // small debounce
            if (tr._pcDebounce) clearTimeout(tr._pcDebounce);
            tr._pcDebounce = setTimeout(() => fillOurPriceForRow(tr).catch(() => { }), 120);
        };
        pidInput.addEventListener('change', handler);
        pidInput.addEventListener('blur', handler);
        // initial attempt
        handler();
    }

    function wireExistingRows() {
        const tbody = document.querySelector('#pcCompetitorsTable tbody');
        if (!tbody) return;
        qAll('tr', tbody).forEach(wireRow);
    }

    function observeRows() {
        const tbody = document.querySelector('#pcCompetitorsTable tbody');
        if (!tbody) return;
        const mo = new MutationObserver(muts => {
            muts.forEach(m => {
                m.addedNodes && m.addedNodes.forEach(node => {
                    if (!node) return;
                    if (node.nodeType === 1 && node.matches && node.matches('tr')) {
                        wireRow(node);
                    } else if (node.querySelectorAll) {
                        qAll('tr', node).forEach(wireRow);
                    }
                });
            });
        });
        mo.observe(tbody, { childList: true, subtree: true });
    }

    // Expose a public function to force re-wiring (useful if admin.js completely re-renders the table)
    window.adminPriceCompareWire = function () {
        try {
            wireExistingRows();
            observeRows();
        } catch (e) {
            console.warn('adminPriceCompareWire error', e);
        }
    };

    // Auto-run when DOM is ready
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(() => {
            window.adminPriceCompareWire();
        }, 0);
    } else {
        document.addEventListener('DOMContentLoaded', () => window.adminPriceCompareWire());
    }
})();