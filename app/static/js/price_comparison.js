// static/js/price_comparison.js
// Frontend for comparison page that expects the server API to return admin-driven
// comparisons (fields: name, product_id, our_price, competitor_price).

(function () {
    const PRICE_CMP_API = (typeof window !== 'undefined' && typeof window.API === 'string') ? window.API : '/api';

    async function fetchWithRetry(url, opts = {}) {
        // Try normal fetch first, on non-OK (including 304) retry with cache-buster
        try {
            const r = await fetch(url, opts);
            if (r.ok) return r;
            console.debug(`fetchWithRetry: first attempt failed ${r.status} ${url}, retrying with cache-buster`);
        } catch (e) {
            console.debug('fetchWithRetry: first attempt threw, retrying with cache-buster', e);
        }
        // Retry with cache-buster
        const sep = url.indexOf('?') === -1 ? '?' : '&';
        const url2 = `${url}${sep}_=${Date.now()}`;
        const r2 = await fetch(url2, { ...opts, cache: 'no-store' });
        return r2;
    }

    async function fetchProducts() {
        const sel = document.getElementById('pcProductSelect');
        if (!sel) {
            console.warn('pcProductSelect element not found');
            return;
        }

        sel.innerHTML = '<option value="">Loading…</option>';
        setStatus('Loading products…');
        try {
            const res = await fetchWithRetry(`${PRICE_CMP_API}/products`, { credentials: 'same-origin' });
            if (!res.ok) {
                const txt = await safeText(res);
                throw new Error(`HTTP ${res.status}: ${txt}`);
            }
            const productsRaw = await res.json();
            const products = Array.isArray(productsRaw) ? productsRaw : (productsRaw && productsRaw.items ? productsRaw.items : []);
            populateProductSelect(sel, products);
            setStatus('');
        } catch (e) {
            console.warn('fetchProducts error', e);
            sel.innerHTML = '<option value="">Failed to load products</option>';
            setStatus('Failed to load product list. Check server or browser console for details.', true);
        }
    }

    async function safeText(response) {
        try {
            return await response.text();
        } catch (e) {
            return String(response.status || 'error');
        }
    }

    function populateProductSelect(sel, products) {
        sel.innerHTML = '<option value="">-- Select product --</option>';
        if (!Array.isArray(products) || products.length === 0) {
            sel.innerHTML = '<option value="">No products available</option>';
            setStatus('No products available', true);
            return;
        }
        products.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id || '';
            const title = (p.title || p.name || '').trim();
            const brand = (p.brand || '').trim();
            if (title) {
                opt.textContent = brand ? `${title} — ${brand} (${p.id}) — ${p.price ? '£' + p.price : 'Price N/A'}` : `${title} (${p.id}) — ${p.price ? '£' + p.price : 'Price N/A'}`;
            } else {
                opt.textContent = p.id;
            }
            sel.appendChild(opt);
        });
    }

    function setStatus(msg, isError = false) {
        const st = document.getElementById('pcStatus');
        if (!st) return;
        st.textContent = msg || '';
        st.style.color = isError ? '#c00' : '';
    }

    function formatMoney(n) {
        if (n === null || typeof n === 'undefined' || isNaN(n)) return '—';
        try {
            return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(Number(n));
        } catch (e) {
            return '£' + Number(n).toFixed(2);
        }
    }

    async function runCompare(productId) {
        setStatus('Running comparison — using admin values where present...');
        const resultDiv = document.getElementById('pcResult');
        if (resultDiv) resultDiv.style.display = 'none';
        try {
            const res = await fetchWithRetry(`${PRICE_CMP_API}/price-compare?product_id=${encodeURIComponent(productId)}`, { credentials: 'same-origin' });
            if (!res.ok) {
                const txt = await safeText(res).catch(() => res.statusText || `HTTP ${res.status}`);
                setStatus('Comparison failed: ' + txt, true);
                return;
            }
            const js = await res.json();
            renderComparison(js);
        } catch (e) {
            console.error(e);
            setStatus('Network error while comparing prices', true);
        }
    }

    function renderComparison(data) {
        setStatus('');
        const tbody = document.querySelector('#pcTable tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        const titleEl = document.getElementById('pcProductTitle');
        const ourPriceEl = document.getElementById('pcOurPrice');
        const badge = document.getElementById('pcBadge');

        const prod = (data && data.product) ? data.product : null;
        if (prod) {
            titleEl.textContent = `${prod.title || prod.name || prod.id} — ${prod.brand || ''} (${prod.id || ''})`;
            ourPriceEl.textContent = formatMoney(prod.price);
        } else {
            titleEl.textContent = 'Product';
            ourPriceEl.textContent = '—';
        }

        const comps = Array.isArray(data && data.comparisons) ? data.comparisons : [];
        comps.forEach(c => {
            const tr = document.createElement('tr');

            const brandTd = document.createElement('td');
            brandTd.textContent = c.name || 'Unknown';

            const pidTd = document.createElement('td');
            pidTd.textContent = c.product_id || (prod && prod.id) || '-';

            const ourTd = document.createElement('td');
            const ourVal = (typeof c.our_price === 'number') ? c.our_price : (prod ? prod.price : undefined);
            ourTd.textContent = formatMoney(ourVal);

            const compTd = document.createElement('td');
            const compVal = (typeof c.competitor_price === 'number') ? c.competitor_price : (typeof c.manual_price === 'number' ? c.manual_price : c.found_price);
            if (compVal === null || compVal === undefined || isNaN(compVal)) {
                compTd.textContent = c.error ? `Error` : 'N/A';
            } else {
                compTd.textContent = formatMoney(compVal);
            }

            tr.appendChild(brandTd);
            tr.appendChild(pidTd);
            tr.appendChild(ourTd);
            tr.appendChild(compTd);
            tbody.appendChild(tr);
        });

        if (data && data.ours_is_cheapest) {
            badge.style.display = 'inline-block';
            badge.textContent = 'Cheapest (Great value!)';
        } else {
            badge.style.display = 'none';
        }

        const resultDivEl = document.getElementById('pcResult');
        if (resultDivEl) resultDivEl.style.display = '';
    }

    document.addEventListener('DOMContentLoaded', function () {
        fetchProducts();

        const compareBtn = document.getElementById('pcCompareBtn');
        if (compareBtn) {
            compareBtn.addEventListener('click', function () {
                const sel = document.getElementById('pcProductSelect');
                if (!sel) {
                    setStatus('Product selector not present', true);
                    return;
                }
                const pid = sel.value;
                if (!pid) {
                    setStatus('Please select a product to compare', true);
                    return;
                }
                runCompare(pid);
            });
        } else {
            console.warn('pcCompareBtn not found');
        }

        const preset = window.PC_PRESET_PRODUCT_ID && window.PC_PRESET_PRODUCT_ID.length ? window.PC_PRESET_PRODUCT_ID : null;
        if (preset) {
            const trySelect = setInterval(() => {
                const sel = document.getElementById('pcProductSelect');
                if (sel && sel.options && sel.options.length > 1) {
                    for (const opt of sel.options) {
                        if (opt.value === preset) {
                            opt.selected = true;
                            clearInterval(trySelect);
                            runCompare(preset);
                            return;
                        }
                    }
                    clearInterval(trySelect);
                }
            }, 200);
            setTimeout(() => clearInterval(trySelect), 8000);
        }
    });
})();