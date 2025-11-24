/* admin.js - Complete single-file admin script
   - Full CRUD for Brands, Products, Homepage Products (brand->product selector),
     Top Picks, Coupons, Orders
   - Price Comparison (v3)
   - Content admin (Quill-based)
   - Modal helpers, notifications, utilities
   - Defensive wiring to avoid legacy hpModal double-popup
   Drop this file into /static/js/admin.js and hard-refresh the admin page.
*/

const API = "/api";
const CONTENT_API = "/content-api";

/* ------------------------------
   Utility helpers
   ------------------------------ */
function toStaticUrl(url) {
    if (!url) return '/static/images/placeholder.jpg';
    if (typeof url !== 'string') return '/static/images/placeholder.jpg';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')) return url;
    return `/static/${url}`;
}

async function apiFetch(url, opts = {}) {
    opts = Object.assign({}, opts);
    opts.credentials = opts.credentials || 'include';
    if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) {
        opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
        opts.body = JSON.stringify(opts.body);
    } else if (opts.body && typeof opts.body === 'string') {
        opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    }
    return fetch(url, opts);
}

function el(id) { return document.getElementById(id); }
function q(selector, root = document) { return root.querySelector(selector); }
function qa(selector, root = document) { return Array.from((root || document).querySelectorAll(selector)); }

function escapeHtmlAttr(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function debounce(fn, wait) {
    let t;
    return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
    };
}

/* ------------------------------
   Price sanitization helper
   ------------------------------
   Removes currency symbols, grouping commas and whitespace,
   keeps digits, decimal point and optional leading minus.
   Normalizes multiple decimal points by keeping the first.
*/
function sanitizePriceString(raw) {
    if (raw === null || raw === undefined) return '';
    let s = String(raw).trim();
    // Remove common currency symbols, non-breaking space and grouping commas
    s = s.replace(/[\u00A0\s,£$€¥₹]/g, '');
    // Keep only digits, dot and minus sign (everything else removed)
    s = s.replace(/[^0-9.\-]/g, '');
    // Normalize multiple dots: keep first dot, join remaining to fraction
    const parts = s.split('.');
    if (parts.length > 2) {
        s = parts.shift() + '.' + parts.join('');
    }
    // Avoid bare '-' or '.' values
    if (s === '-' || s === '.' || s === '' || s === '-.') return '';
    return s;
}

function adminNotify(msg, type = 'info', timeout = 2500) {
    const containerId = 'adminNotifyContainer';
    let cont = el(containerId);
    if (!cont) {
        cont = document.createElement('div');
        cont.id = containerId;
        cont.style.position = 'fixed';
        cont.style.right = '20px';
        cont.style.top = '20px';
        cont.style.zIndex = 99999;
        document.body.appendChild(cont);
    }
    const node = document.createElement('div');
    node.textContent = msg;
    node.style.margin = '6px 0';
    node.style.padding = '8px 12px';
    node.style.borderRadius = '6px';
    node.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)';
    node.style.fontSize = '0.95rem';
    if (type === 'error') { node.style.background = '#fdecea'; node.style.color = '#b00020'; }
    else if (type === 'success') { node.style.background = '#e8f5e9'; node.style.color = '#1b5e20'; }
    else { node.style.background = '#f3f6fb'; node.style.color = '#1f2937'; }
    cont.appendChild(node);
    setTimeout(() => { node.style.transition = 'opacity 400ms'; node.style.opacity = '0'; setTimeout(() => node.remove(), 410); }, timeout);
}

/* ------------------------------
   Defensive: remove legacy hpModal and rewire Add Homepage button
   Ensures only one modal opens (the new admin.js modal).
   ------------------------------ */
(function protectHomepageButtonAndRemoveLegacyModal() {
    try {
        const legacyHp = document.getElementById('hpModalBg');
        if (legacyHp) {
            // remove legacy node to avoid double popup
            legacyHp.remove();
        }
    } catch (err) {
        console.warn('Failed to remove legacy hpModalBg:', err);
    }

    function rewireAddHomepageBtn() {
        const oldBtn = document.getElementById('addHomepageBtn');
        if (!oldBtn) return;
        try {
            const newBtn = oldBtn.cloneNode(true);
            oldBtn.parentNode.replaceChild(newBtn, oldBtn);
            newBtn.addEventListener('click', function (e) {
                e.preventDefault();
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                else e.stopPropagation();
                const legacy = document.getElementById('hpModalBg');
                if (legacy) legacy.style.display = 'none';
                try {
                    if (typeof showHomepageModal === 'function') showHomepageModal(null);
                    else {
                        const modalBg = document.getElementById('modalBg');
                        if (modalBg) modalBg.style.display = 'flex';
                    }
                } catch (openErr) {
                    console.error('Failed to open homepage modal:', openErr);
                }
            }, true);
        } catch (err) {
            console.warn('Failed to rewire addHomepageBtn:', err);
        }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        rewireAddHomepageBtn();
    } else {
        document.addEventListener('DOMContentLoaded', rewireAddHomepageBtn);
    }
})();

/* ------------------------------
   Tab wiring
   ------------------------------ */
if (el('tabBrands')) el('tabBrands').onclick = () => switchTab('brands');
if (el('tabProducts')) el('tabProducts').onclick = () => switchTab('products');
if (el('tabHomepage')) el('tabHomepage').onclick = () => switchTab('homepage');
if (el('tabTopPicks')) el('tabTopPicks').onclick = () => switchTab('topPicks');
if (el('tabCoupons')) el('tabCoupons').onclick = () => switchTab('coupons');
if (el('tabOrders')) el('tabOrders').onclick = () => switchTab('orders');
if (el('tabPriceComparison')) el('tabPriceComparison').onclick = () => switchTab('priceComparison');

function switchTab(tab) {
    const tabs = ['brands', 'products', 'homepage', 'topPicks', 'coupons', 'orders', 'priceComparison'];
    tabs.forEach(t => {
        const tabEl = el('tab' + (t.charAt(0).toUpperCase() + t.slice(1)));
        if (tabEl) tabEl.classList.toggle('active', t === tab);
        const card = el(t + 'Card');
        if (card) card.style.display = (t === tab) ? '' : 'none';
    });
    const pageTitleEl = el('pageTitle');
    if (pageTitleEl) {
        pageTitleEl.textContent =
            tab === 'brands' ? 'Brands' :
                tab === 'products' ? 'Products' :
                    tab === 'homepage' ? 'Homepage Products' :
                        tab === 'topPicks' ? 'Top Picks' :
                            tab === 'coupons' ? 'Promotions' :
                                tab === 'orders' ? 'Customer Orders' :
                                    tab === 'priceComparison' ? 'Price Comparison Settings' : '';
    }

    // lazy load data for the selected tab
    if (tab === 'brands') loadBrands();
    if (tab === 'products') loadProducts();
    if (tab === 'homepage') loadHomepageProducts();
    if (tab === 'topPicks') loadTopPicks();
    if (tab === 'coupons') loadCoupons();
    if (tab === 'orders') loadOrders();
    if (tab === 'priceComparison') loadPriceComparisonSettings_v3();
}

/* ------------------------------
   Login / Logout
   ------------------------------ */
if (el('loginForm')) {
    el('loginForm').onsubmit = async function (e) {
        e.preventDefault();
        const username = el('username').value.trim();
        const password = el('password').value;
        const loginErr = el('loginError');
        if (loginErr) { loginErr.style.display = 'none'; loginErr.textContent = ''; }
        try {
            const res = await apiFetch(`${API}/auth/login`, { method: 'POST', body: { username, password } });
            let bodyText = null, bodyJson = null;
            try {
                bodyText = await res.text();
                try { bodyJson = JSON.parse(bodyText); } catch (e) { bodyJson = null; }
            } catch (e) { }
            if (!res.ok) {
                const errMsg = (bodyJson && (bodyJson.error || bodyJson.detail)) ? (bodyJson.error || bodyJson.detail) : (bodyText || res.statusText);
                if (loginErr) { loginErr.textContent = `Login failed: ${errMsg}`; loginErr.style.display = 'block'; }
                adminNotify('Login failed: ' + errMsg, 'error');
                return;
            }
            let js = null;
            try { js = bodyJson || JSON.parse(bodyText || '{}'); } catch (e) { js = null; }
            const user = js && js.user ? js.user : { username };
            const bg = el('loginBg'); if (bg) bg.style.display = 'none';
            const userInfo = el('userInfo'); if (userInfo) userInfo.style.display = '';
            if (el('usernameInfo')) el('usernameInfo').textContent = user.username || username;
            switchTab('brands');
            adminNotify('Login successful', 'success');
        } catch (err) {
            console.error('Network/login error', err);
            adminNotify('Network/login error', 'error');
            if (loginErr) { loginErr.style.display = 'block'; loginErr.textContent = 'Network error: ' + err.message; }
        }
    };
}
if (el('logoutBtn')) {
    el('logoutBtn').onclick = async function () {
        try { await apiFetch(`${API}/auth/logout`, { method: 'POST' }); } catch (e) { }
        location.reload();
    };
}

/* ------------------------------
   Checkout Discount Setting
   ------------------------------ */
async function loadDiscountSetting() {
    try {
        const r = await apiFetch(`${API}/settings/checkout_discount`);
        if (!r.ok) return;
        const js = await r.json();
        if (el('checkout_discount_percent')) el('checkout_discount_percent').value = js.percent ?? 0;
    } catch (err) {
        console.warn('loadDiscountSetting error', err);
    }
}
if (el('discountSettingForm')) {
    el('discountSettingForm').onsubmit = async function (e) {
        e.preventDefault();
        const percent = parseFloat(el('checkout_discount_percent').value || 0);
        const msg = el('discountSaveMsg');
        if (msg) msg.textContent = 'Saving...';
        try {
            const r = await apiFetch(`${API}/settings/checkout_discount`, { method: 'PUT', body: { percent } });
            if (r.ok) { if (msg) msg.textContent = 'Saved!'; adminNotify('Discount saved', 'success'); }
            else { if (msg) msg.textContent = 'Failed!'; adminNotify('Failed to save discount', 'error'); }
        } catch (err) {
            if (msg) msg.textContent = 'Failed!';
            adminNotify('Network error saving discount', 'error');
        }
        setTimeout(() => { if (msg) msg.textContent = ''; }, 1600);
    };
    loadDiscountSetting();
}

/* ------------------------------
   Price Comparison v3
   ------------------------------ */
function createPcRow_v3(data = {}) {
    const tr = document.createElement('tr');
    const name = data.name || '';
    const product_id = data.product_id || '';
    const our_price = (data.our_price !== undefined && data.our_price !== null) ? data.our_price : '';
    const competitor_price = (data.competitor_price !== undefined && data.competitor_price !== null) ? data.competitor_price : '';
    tr.innerHTML = `
        <td style="width:220px"><input class="pc-name" type="text" value="${escapeHtmlAttr(name)}" placeholder="Competitor Brand" required></td>
        <td style="width:150px"><input class="pc-product-id" type="text" value="${escapeHtmlAttr(product_id)}" placeholder="PRD001 (required)" required></td>
        <td style="width:140px"><input class="pc-our-price" type="number" step="0.01" min="0" value="${escapeHtmlAttr(our_price)}" placeholder="Our price (optional)"></td>
        <td style="width:160px"><input class="pc-competitor-price" type="number" step="0.01" min="0" value="${escapeHtmlAttr(competitor_price)}" placeholder="Competitor price (optional)"></td>
        <td style="width:70px" class="action"><button class="btn small danger pc-remove">Remove</button></td>
    `;
    tr.querySelector('.pc-remove').addEventListener('click', (e) => {
        e.preventDefault();
        if (!confirm('Remove this competitor row?')) return;
        tr.remove();
    });
    return tr;
}

function renderPcTable_v3(list) {
    const tbody = q('#pcCompetitorsTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!Array.isArray(list) || list.length === 0) {
        tbody.appendChild(createPcRow_v3());
        return;
    }
    list.forEach(item => {
        const tr = createPcRow_v3({
            name: item.name || '',
            product_id: item.product_id || '',
            our_price: (item.our_price !== undefined ? item.our_price : (item.ourPrice || '')),
            competitor_price: (item.competitor_price !== undefined ? item.competitor_price : (item.manual_price !== undefined ? item.manual_price : (item.competitorPrice || '')))
        });
        tbody.appendChild(tr);
    });
}

function collectPcTable_v3() {
    const tbody = q('#pcCompetitorsTable tbody');
    if (!tbody) return [];
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const out = [];
    rows.forEach(r => {
        const name = (r.querySelector('.pc-name') || {}).value || '';
        const product_id = (r.querySelector('.pc-product-id') || {}).value || '';
        const our_price_raw = (r.querySelector('.pc-our-price') || {}).value;
        const competitor_price_raw = (r.querySelector('.pc-competitor-price') || {}).value;
        const our_price = (our_price_raw !== '' && our_price_raw !== null) ? parseFloat(our_price_raw) : null;
        const competitor_price = (competitor_price_raw !== '' && competitor_price_raw !== null) ? parseFloat(competitor_price_raw) : null;
        if (!name || !product_id) return;
        const obj = { name: name.trim(), product_id: product_id.trim() };
        if (our_price !== null && !Number.isNaN(our_price)) obj.our_price = our_price;
        if (competitor_price !== null && !Number.isNaN(competitor_price)) obj.competitor_price = competitor_price;
        out.push(obj);
    });
    return out;
}

async function loadPriceComparisonSettings_v3() {
    try {
        const r = await apiFetch(`${API}/settings/price_comparison`);
        let js = null;
        if (!r.ok) js = { competitors: [], global_margin: 0 };
        else js = await r.json();
        let competitors = js.competitors || [];
        if (typeof competitors === 'string') {
            try { competitors = JSON.parse(competitors); } catch (e) { competitors = []; }
        }
        const globalEl = el('pc_global_margin');
        if (globalEl) globalEl.value = (js.global_margin !== undefined && js.global_margin !== null) ? js.global_margin : 0;
        renderPcTable_v3(competitors);
    } catch (err) {
        console.warn('Failed to load price comparison settings', err);
        const tbody = q('#pcCompetitorsTable tbody');
        if (tbody && tbody.children.length === 0) tbody.appendChild(createPcRow_v3());
    }
}

async function savePriceComparisonSettings_v3() {
    const msg = el('pcSaveMsg');
    if (msg) msg.textContent = 'Saving...';
    try {
        const competitors = collectPcTable_v3();
        const gm = el('pc_global_margin') ? parseFloat(el('pc_global_margin').value || 0) : 0;
        const res = await apiFetch(`${API}/settings/price_comparison`, { method: 'PUT', body: { competitors, global_margin: gm } });
        if (!res.ok) {
            const txt = await res.text().catch(() => res.statusText);
            adminNotify('Failed to save: ' + txt, 'error');
            if (msg) msg.textContent = 'Failed';
            return;
        }
        try { await apiFetch(`${API}/settings/price_comparison/push`, { method: 'POST' }); } catch (e) { }
        adminNotify('Price comparison settings saved', 'success');
        if (msg) msg.textContent = 'Saved!';
    } catch (err) {
        console.error(err);
        adminNotify('Network error saving settings', 'error');
        if (msg) msg.textContent = 'Failed';
    } finally {
        setTimeout(() => { if (msg) msg.textContent = ''; }, 1600);
    }
}

/* Wire PC buttons */
if (el('pcAddCompetitorBtn')) el('pcAddCompetitorBtn').addEventListener('click', (e) => {
    e.preventDefault();
    const tbody = q('#pcCompetitorsTable tbody'); if (!tbody) return;
    tbody.appendChild(createPcRow_v3());
});
if (el('savePcSettingsBtn')) el('savePcSettingsBtn').addEventListener('click', async (e) => { e.preventDefault(); await savePriceComparisonSettings_v3(); });
if (el('pcResetBtn')) el('pcResetBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    if (!confirm('Reset price comparison defaults?')) return;
    try {
        const defaults = [
            { name: "VPerfumes", product_id: "PRD001", our_price: 100.00, competitor_price: 150.00 },
            { name: "Parfum", product_id: "PRD001", our_price: 100.00, competitor_price: 160.00 }
        ];
        await apiFetch(`${API}/settings/price_comparison`, { method: 'PUT', body: { competitors: defaults, global_margin: 0 } });
        await loadPriceComparisonSettings_v3();
        adminNotify('Defaults saved', 'success');
    } catch (err) { console.warn(err); adminNotify('Failed to reset defaults', 'error'); }
});

/* ------------------------------
   Brands CRUD
   ------------------------------ */
async function loadBrands() {
    try {
        const res = await apiFetch(`${API}/brands`);
        if (!res.ok) return;
        const brands = await res.json();
        const tbody = q('#brandsTable tbody'); if (!tbody) return;
        tbody.innerHTML = '';
        brands.forEach(b => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(b.name)}</td>
                <td><img src="${toStaticUrl(b.logo)}" alt="Logo" style="height:36px;border-radius:4px;"></td>
                <td>${escapeHtml(b.description || '')}</td>
                <td class="action">
                    <button class="btn small accent edit-brand" data-name="${escapeHtmlAttr(b.name)}"><span class="material-icons">edit</span></button>
                    <button class="btn small danger delete-brand" data-name="${escapeHtmlAttr(b.name)}"><span class="material-icons">delete</span></button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        qa('.edit-brand', tbody).forEach(btn => btn.addEventListener('click', e => openBrandEditorByName(e.currentTarget.dataset.name)));
        qa('.delete-brand', tbody).forEach(btn => btn.addEventListener('click', async e => {
            const name = e.currentTarget.dataset.name;
            if (!confirm(`Delete brand ${name}?`)) return;
            try { await apiFetch(`${API}/brands/${encodeURIComponent(name)}`, { method: 'DELETE' }); adminNotify('Brand deleted', 'success'); loadBrands(); }
            catch (err) { console.error(err); adminNotify('Failed to delete brand', 'error'); }
        }));
    } catch (err) { console.warn('loadBrands error', err); }
}

function openBrandEditorByName(name) {
    apiFetch(`${API}/brands`).then(res => res.json()).then(list => {
        const brand = (list || []).find(b => b.name === name); showBrandModal(brand);
    }).catch(err => console.warn(err));
}

function showBrandModal(brand) {
    const modalBg = el('modalBg'); const modalContent = el('modalContent');
    if (!modalBg || !modalContent) return;
    modalBg.style.display = 'flex';
    const name = brand ? escapeHtmlAttr(brand.name) : '';
    const logo = brand ? escapeHtmlAttr(brand.logo) : '';
    const desc = brand ? escapeHtmlAttr(brand.description || '') : '';
    modalContent.innerHTML = `
        <h3>${brand ? "Edit" : "Add"} Brand</h3>
        <form id="brandForm">
            <label>Name</label>
            <input name="name" required value="${name}" ${brand ? 'readonly' : ''}>
            <label>Logo URL</label>
            <input name="logo" required value="${logo}">
            <label>Description</label>
            <textarea name="description" rows="2">${desc}</textarea>
            <div style="display:flex;gap:12px;margin-top:12px;">
                <button type="submit" class="btn">${brand ? "Save" : "Add"}</button>
                <button type="button" class="btn accent" id="brandCancel">Cancel</button>
            </div>
        </form>
    `;
    q('#brandCancel').addEventListener('click', () => closeModal());
    q('#brandForm').onsubmit = async function (e) {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.target).entries());
        try {
            let res;
            if (!brand) res = await apiFetch(`${API}/brands`, { method: 'POST', body: data });
            else res = await apiFetch(`${API}/brands/${encodeURIComponent(brand.name)}`, { method: 'PUT', body: data });
            if (!res.ok) { const t = await res.text(); adminNotify('Save failed: ' + t, 'error'); }
            else adminNotify('Brand saved', 'success');
        } catch (err) { console.error(err); adminNotify('Network error', 'error'); }
        closeModal(); loadBrands();
    };
}
if (el('addBrandBtn')) el('addBrandBtn').addEventListener('click', () => showBrandModal(null));

/* ------------------------------
   Products CRUD
   ------------------------------ */
async function loadProducts() {
    try {
        const res = await apiFetch(`${API}/products`);
        if (!res.ok) return;
        const products = await res.json();
        const tbody = q('#productsTable tbody'); if (!tbody) return;
        tbody.innerHTML = '';
        products.forEach(p => {
            let thumbnailImgs = '';
            if (p.thumbnails) {
                let thumbs = p.thumbnails.split(',').map(s => s.trim()).filter(s => s);
                thumbs.slice(0, 3).forEach(u => thumbnailImgs += `<img src="${toStaticUrl(u)}" style="height:28px;border-radius:4px;margin-right:4px;" alt="thumb">`);
            }
            const priceVal = (typeof p.price !== 'undefined' && p.price !== null && isFinite(Number(p.price))) ? Number(p.price).toFixed(2) : '0.00';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(p.title)}</td>
                <td>${escapeHtml(p.brand)}</td>
                <td>$${priceVal}</td>
                <td>${escapeHtml(p.status || '')}</td>
                <td>${typeof p.quantity === 'number' ? p.quantity : 0}</td>
                <td>${escapeHtml(p.tags || '')}</td>
                <td><img src="${toStaticUrl(p.image_url)}" style="height:36px;border-radius:4px;" alt="main image"></td>
                <td>${thumbnailImgs}</td>
                <td class="action">
                    <button class="btn small accent edit-product" data-id="${escapeHtmlAttr(p.id)}"><span class="material-icons">edit</span></button>
                    <button class="btn small danger delete-product" data-id="${escapeHtmlAttr(p.id)}"><span class="material-icons">delete</span></button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        qa('.edit-product', tbody).forEach(btn => btn.addEventListener('click', e => openProductEditorById(e.currentTarget.dataset.id)));
        qa('.delete-product', tbody).forEach(btn => btn.addEventListener('click', async e => {
            const id = e.currentTarget.dataset.id;
            if (!confirm('Delete this product?')) return;
            try { await apiFetch(`${API}/products/${encodeURIComponent(id)}`, { method: 'DELETE' }); adminNotify('Product deleted', 'success'); loadProducts(); }
            catch (err) { console.error(err); adminNotify('Delete failed', 'error'); }
        }));
    } catch (err) { console.warn('loadProducts error', err); }
}

if (el('addProductBtn')) el('addProductBtn').addEventListener('click', () => showProductModal(null));

/* Helper: open product editor by id (prevents ReferenceError and works with single-product endpoint or list) */
async function openProductEditorById(id) {
    try {
        if (!id) return;
        // try single-product endpoint first
        try {
            const resSingle = await apiFetch(`${API}/products/${encodeURIComponent(id)}`);
            if (resSingle.ok) {
                const product = await resSingle.json().catch(() => null);
                if (product) { showProductModal(product); return; }
            }
        } catch (e) { /* ignore and fall back */ }

        // fallback to fetching list and find product by id
        const res = await apiFetch(`${API}/products`);
        if (!res.ok) return;
        const list = await res.json();
        const product = (list || []).find(p => String(p.id) === String(id) || String(p._id) === String(id));
        showProductModal(product);
    } catch (err) { console.warn('openProductEditorById error', err); }
}

function showProductModal(product) {
    apiFetch(`${API}/brands`).then(res => res.json()).then(brands => {
        const modalBg = el('modalBg'); const modalContent = el('modalContent');
        if (!modalBg || !modalContent) return;
        modalBg.style.display = 'flex';
        const title = product ? escapeHtmlAttr(product.title) : '';
        const price = product ? escapeHtmlAttr(product.price) : '';
        const qty = product && typeof product.quantity === 'number' ? product.quantity : 10;
        const status = product ? escapeHtmlAttr(product.status || '') : '';
        const image_url = product ? escapeHtmlAttr(product.image_url || '') : '';
        const thumbnails = product ? escapeHtmlAttr(product.thumbnails || '') : '';
        const description = product ? escapeHtmlAttr(product.description || '') : '';
        const keyNotes = product ? escapeHtmlAttr((product.keyNotes || []).join(', ')) : '';
        const tags = product ? escapeHtmlAttr(product.tags || '') : '';
        modalContent.innerHTML = `
            <h3>${product ? 'Edit' : 'Add'} Product</h3>
            <form id="productFormModal">
                <label>Title</label>
                <input name="title" required value="${title}">
                <label>Brand</label>
                <select name="brand" required>
                    ${brands.map(b => `<option value="${escapeHtmlAttr(b.name)}" ${product && product.brand == b.name ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}
                </select>
                <label>Price (numeric)</label>
                <input name="price" required type="number" step="0.01" min="0.01" value="${price}">
                <label>Status</label>
                <select name="status">
                    <option value="restocked" ${status == 'restocked' ? 'selected' : ''}>Restocked</option>
                    <option value="new-arrivals" ${status == 'new-arrivals' ? 'selected' : ''}>New Arrivals</option>
                    <option value="running-out" ${status == 'running-out' ? 'selected' : ''}>Running Out</option>
                    <option value="few-remaining" ${status == 'few-remaining' ? 'selected' : ''}>Few Remaining</option>
                    <option value="selling-fast" ${status == 'selling-fast' ? 'selected' : ''}>Selling Fast</option>
                    <option value="almost-gone" ${status == 'almost-gone' ? 'selected' : ''}>Almost Gone</option>
                    <option value="out-of-stock" ${status == 'out-of-stock' ? 'selected' : ''}>Out of Stock</option>
                </select>
                <label>Inventory Quantity</label>
                <input name="quantity" type="number" min="0" value="${qty}">
                <label>Main Image URL</label>
                <input name="image_url" value="${image_url}">
                <label>Thumbnail URLs (comma separated)</label>
                <input name="thumbnails" value="${thumbnails}">
                <label>Description</label>
                <textarea name="description" rows="3">${description}</textarea>
                <label>Key Notes (comma separated)</label>
                <input name="keyNotes" value="${keyNotes}">
                <label>Tags</label>
                <input name="tags" value="${tags}">
                <div style="display:flex;gap:12px;margin-top:12px;">
                    <button type="submit" class="btn">${product ? 'Save' : 'Add'}</button>
                    <button type="button" class="btn accent" id="productCancel">Cancel</button>
                </div>
            </form>
        `;
        q('#productCancel').addEventListener('click', () => closeModal());
        q('#productFormModal').onsubmit = async function (e) {
            e.preventDefault();
            const formData = Object.fromEntries(new FormData(e.target).entries());

            // Sanitize price input so admin can type "$12", "£12", "1,299" etc.
            const rawPrice = formData.price;
            const cleanedPriceStr = sanitizePriceString(rawPrice);
            const parsedPrice = (cleanedPriceStr !== '') ? parseFloat(cleanedPriceStr) : NaN;
            formData.price = (Number.isFinite(parsedPrice) && !Number.isNaN(parsedPrice)) ? parsedPrice : 0.0;

            formData.quantity = parseInt(formData.quantity, 10) || 0;
            try {
                let res;
                if (product) {
                    formData.id = product.id;
                    res = await apiFetch(`${API}/products/${encodeURIComponent(product.id)}`, { method: 'PUT', body: formData });
                } else {
                    formData.id = 'PRD' + Math.floor(Date.now() / 10000).toString().slice(-4) + Math.floor(Math.random() * 99).toString().padStart(2, '0');
                    res = await apiFetch(`${API}/products`, { method: 'POST', body: formData });
                }
                if (!res.ok) { const txt = await res.text(); adminNotify('Save failed: ' + txt, 'error'); }
                else adminNotify('Product saved', 'success');
            } catch (err) { console.error(err); adminNotify('Network error', 'error'); }
            closeModal(); loadProducts();
        };
    }).catch(err => console.warn(err));
}

/* ------------------------------
   Homepage Products CRUD (brand->product selection)
   ------------------------------ */

/* Helper: findProductInListById */
function findProductInListById(list, id) {
    if (!Array.isArray(list)) return null;
    return list.find(p => String(p.id || p._id || '') === String(id));
}

async function loadHomepageProducts() {
    try {
        const res = await apiFetch(`${API}/homepage-products`);
        const tbody = q('#homepageTable tbody'); if (!tbody) return;
        if (!res.ok) {
            tbody.innerHTML = '<tr><td colspan="7" style="color:#c00;padding:12px;">Unable to load homepage products.</td></tr>';
            return;
        }
        const data = await res.json();
        tbody.innerHTML = '';

        let items = [];
        if (Array.isArray(data)) items = data;
        else if (data && typeof data === 'object') {
            // flatten keyed object
            if (data.items && Array.isArray(data.items)) items = data.items;
            else {
                Object.keys(data).forEach(k => {
                    const arr = Array.isArray(data[k]) ? data[k] : [];
                    arr.forEach(it => {
                        const copy = Object.assign({}, it);
                        copy.section = k;
                        items.push(copy);
                    });
                });
            }
        }

        if (!items.length) {
            tbody.innerHTML = '<tr><td colspan="7" style="color:#888;padding:12px;">No homepage entries</td></tr>';
            return;
        }

        items.forEach(hp => {
            const idVal = escapeHtmlAttr(hp.id || hp._id || '');
            // Guard price display so bad stored values don't break rendering
            const priceDisplay = (typeof hp.price !== 'undefined' && hp.price !== null && isFinite(Number(hp.price))) ? ('$' + Number(hp.price).toFixed(2)) : '';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(hp.section || '')}</td>
                <td>${escapeHtml(hp.title || '')}</td>
                <td>${escapeHtml(hp.brand || '')}</td>
                <td>${priceDisplay}</td>
                <td>${escapeHtml(String(hp.sort || ''))}</td>
                <td>${hp.visible ? 'Yes' : 'No'}</td>
                <td class="action">
                    <button class="btn small accent edit-homepage" data-id="${idVal}"><span class="material-icons">edit</span></button>
                    <button class="btn small danger delete-homepage" data-id="${idVal}"><span class="material-icons">delete</span></button>
                    <button class="btn small" data-id="${idVal}" onclick="pushHomepageProduct('${idVal}')"><span class="material-icons">publish</span></button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        qa('.edit-homepage', tbody).forEach(btn => btn.addEventListener('click', e => editHomepageById(e.currentTarget.dataset.id)));
        qa('.delete-homepage', tbody).forEach(btn => btn.addEventListener('click', async e => {
            const id = e.currentTarget.dataset.id;
            if (!id) return;
            if (!confirm('Delete this homepage product?')) return;
            try { await apiFetch(`${API}/homepage-products/${encodeURIComponent(id)}`, { method: 'DELETE' }); adminNotify('Deleted', 'success'); loadHomepageProducts(); }
            catch (err) { console.error(err); adminNotify('Delete failed', 'error'); }
        }));
    } catch (err) {
        console.warn('loadHomepageProducts error', err);
    }
}

/* showHomepageModal - brand -> product selection behavior */
async function showHomepageModal(hp) {
    const modalBg = el('modalBg');
    const modalContent = el('modalContent');
    if (!modalBg || !modalContent) return;
    modalBg.style.display = 'flex';

    // fetch brands and products
    let brands = [], products = [];
    try {
        const [bRes, pRes] = await Promise.allSettled([
            apiFetch(`${API}/brands`),
            apiFetch(`${API}/products`)
        ]);
        if (bRes.status === 'fulfilled' && bRes.value && bRes.value.ok) brands = await bRes.value.json().catch(() => []);
        if (pRes.status === 'fulfilled' && pRes.value && pRes.value.ok) products = await pRes.value.json().catch(() => []);
    } catch (e) {
        console.warn('showHomepageModal fetch error', e);
    }
    brands = Array.isArray(brands) ? brands : [];
    products = Array.isArray(products) ? products : [];

    const currentSection = hp ? (hp.section || 'signature') : 'signature';
    const currentProductId = hp ? (hp.product_id || hp.productId || '') : '';
    const currentBrand = hp ? (hp.brand || '') : '';
    const currentTitle = hp ? (hp.title || '') : '';
    const currentPrice = (hp && typeof hp.price !== 'undefined' && hp.price !== null && isFinite(Number(hp.price))) ? hp.price : '';
    const currentSort = hp && typeof hp.sort !== 'undefined' ? Number(hp.sort) : 0;
    const currentVisible = hp ? !!hp.visible : true;

    modalContent.innerHTML = `
        <h3>${hp ? 'Edit' : 'Add'} Homepage Product</h3>
        <form id="homepageFormModal">
            <label>Section</label>
            <select name="section" required>
                <option value="signature" ${currentSection === 'signature' ? 'selected' : ''}>Our Signature Perfumes</option>
                <option value="men" ${currentSection === 'men' ? 'selected' : ''}>Men's Brands</option>
                <option value="women" ${currentSection === 'women' ? 'selected' : ''}>Women's Brands</option>
                <option value="offers" ${currentSection === 'offers' ? 'selected' : ''}>Hot Offers</option>
            </select>

            <label>Brand</label>
            <select name="brand_select" id="hp_brand_select">
                <option value="">-- choose brand --</option>
                ${brands.map(b => `<option value="${escapeHtmlAttr(b.name)}" ${currentBrand && currentBrand === b.name ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}
            </select>

            <label>Product</label>
            <select name="product_select" id="hp_product_select" disabled>
                <option value="">-- choose product --</option>
            </select>

            <label>Title (auto)</label>
            <input name="title" id="hp_title" required readonly value="${escapeHtmlAttr(currentTitle)}">

            <label>Product ID (auto)</label>
            <input name="product_id" id="hp_product_id" readonly value="${escapeHtmlAttr(currentProductId)}">

            <label>Price (optional - auto-filled but editable)</label>
            <input name="price" id="hp_price" type="text" value="${escapeHtmlAttr(currentPrice !== '' ? String(currentPrice) : '')}">

            <label>Sort</label>
            <input name="sort" type="number" value="${escapeHtmlAttr(String(currentSort))}">

            <label>Visible</label>
            <select name="visible">
                <option value="true" ${currentVisible ? 'selected' : ''}>Yes</option>
                <option value="false" ${!currentVisible ? 'selected' : ''}>No</option>
            </select>

            <div style="display:flex;gap:12px;margin-top:12px;">
                <button type="submit" class="btn">${hp ? 'Save' : 'Add'}</button>
                <button type="button" class="btn accent" id="hpCancel">Cancel</button>
            </div>
        </form>
        <div id="hpModalHelper" style="margin-top:8px;color:#666;font-size:0.95em;">Select a brand to load products.</div>
    `;

    const brandSelect = q('#hp_brand_select', modalContent);
    const productSelect = q('#hp_product_select', modalContent);
    const titleInput = q('#hp_title', modalContent);
    const productIdInput = q('#hp_product_id', modalContent);
    const priceInput = q('#hp_price', modalContent);
    const helperEl = q('#hpModalHelper', modalContent);

    function populateProductsForBrand(brandName, preselectProductId) {
        productSelect.innerHTML = `<option value="">-- choose product --</option>`;
        if (!brandName) {
            productSelect.disabled = true;
            helperEl.textContent = 'Select a brand to load products.';
            return;
        }
        const filtered = (products || []).filter(p => {
            const pb = (p.brand || '').toString().trim().toLowerCase();
            return pb === (brandName || '').toString().trim().toLowerCase();
        });
        if (!filtered.length) {
            const loose = (products || []).filter(p => (p.brand || '').toString().toLowerCase().includes((brandName || '').toString().toLowerCase()));
            if (loose.length) filtered.push(...loose);
        }
        filtered.forEach(p => {
            const opt = document.createElement('option');
            opt.value = String(p.id || p._id || '');
            opt.textContent = `${p.title || p.name || ''}${p.price ? ' — ' + Number(p.price).toFixed(2) : ''}`;
            productSelect.appendChild(opt);
        });
        productSelect.disabled = false;
        helperEl.textContent = filtered.length ? `${filtered.length} product(s) loaded for "${brandName}".` : `No products found for "${brandName}".`;
        if (preselectProductId) {
            const matchOpt = Array.from(productSelect.options).find(o => String(o.value) === String(preselectProductId));
            if (matchOpt) {
                productSelect.value = String(preselectProductId);
                productSelect.dispatchEvent(new Event('change'));
            }
        }
    }

    productSelect.addEventListener('change', function () {
        const pid = productSelect.value || '';
        if (!pid) {
            if (!hp || !hp.title) titleInput.value = '';
            productIdInput.value = '';
            return;
        }
        const prod = findProductInListById(products, pid);
        if (prod) {
            titleInput.value = prod.title || prod.name || '';
            productIdInput.value = prod.id || prod._id || '';
            if (prod.price !== undefined && prod.price !== null) priceInput.value = prod.price;
            const prodBrand = prod.brand || '';
            if (prodBrand) {
                const opt = Array.from(brandSelect.options).find(o => o.value === prodBrand);
                if (opt) brandSelect.value = prodBrand;
            }
        }
    });

    brandSelect.addEventListener('change', function () {
        const b = brandSelect.value || '';
        populateProductsForBrand(b, null);
    });

    if (currentBrand) populateProductsForBrand(currentBrand, currentProductId);
    else if (currentProductId) {
        const prod = findProductInListById(products, currentProductId);
        if (prod) {
            const exists = Array.from(brandSelect.options).some(o => o.value === prod.brand);
            if (!exists && prod.brand) {
                const o = document.createElement('option'); o.value = prod.brand; o.textContent = prod.brand; brandSelect.appendChild(o);
            }
            brandSelect.value = prod.brand || '';
            populateProductsForBrand(prod.brand, currentProductId);
        }
    }

    q('#hpCancel').addEventListener('click', () => closeModal());

    q('#homepageFormModal').onsubmit = async function (e) {
        e.preventDefault();
        const form = e.target;
        const fd = new FormData(form);
        const selectedPid = (productSelect && productSelect.value) ? productSelect.value : (fd.get('product_id') || '');
        const selectedProduct = selectedPid ? findProductInListById(products, selectedPid) : null;

        // sanitize price entered by admin
        const rawPrice = fd.get('price');
        const cleaned = sanitizePriceString(rawPrice);
        const parsed = (cleaned !== '') ? parseFloat(cleaned) : NaN;
        const priceVal = (Number.isFinite(parsed) && !Number.isNaN(parsed)) ? parsed : undefined;

        const payload = {
            section: fd.get('section'),
            title: selectedProduct ? (selectedProduct.title || '') : (fd.get('title') || '').toString().trim(),
            product_id: selectedProduct ? (selectedProduct.id || selectedProduct._id) : (fd.get('product_id') || undefined),
            brand: selectedProduct ? (selectedProduct.brand || '') : (fd.get('brand_select') || ''),
            price: typeof priceVal !== 'undefined' ? priceVal : undefined,
            sort: parseInt(fd.get('sort') || '0', 10) || 0,
            visible: (fd.get('visible') === 'true')
        };

        try {
            let res;
            if (hp && (hp.id || hp._id)) {
                const id = hp.id || hp._id;
                res = await apiFetch(`${API}/homepage-products/${encodeURIComponent(id)}`, { method: 'PUT', body: payload });
            } else {
                res = await apiFetch(`${API}/homepage-products`, { method: 'POST', body: payload });
            }
            if (!res.ok) {
                const txt = await res.text().catch(() => res.statusText);
                adminNotify('Save failed: ' + txt, 'error');
            } else {
                adminNotify('Saved', 'success');
            }
        } catch (err) {
            console.error('homepage save error', err);
            adminNotify('Save failed (network)', 'error');
        }
        closeModal();
        loadHomepageProducts();
    };
}

function editHomepageById(id) {
    if (!id) { showHomepageModal(null); return; }
    apiFetch(`${API}/homepage-products/${encodeURIComponent(id)}`).then(async res => {
        if (res.ok) {
            const item = await res.json().catch(() => null);
            showHomepageModal(item);
            return;
        }
        const listRes = await apiFetch(`${API}/homepage-products`);
        if (!listRes.ok) { showHomepageModal(null); return; }
        const data = await listRes.json().catch(() => []);
        let found = null;
        if (Array.isArray(data)) found = data.find(x => String(x.id || x._id) === String(id));
        else if (data && typeof data === 'object') {
            if (data.items && Array.isArray(data.items)) found = data.items.find(x => String(x.id || x._id) === String(id));
            if (!found) {
                Object.keys(data).forEach(k => {
                    const arr = Array.isArray(data[k]) ? data[k] : [];
                    arr.forEach(it => { if (!found && (String(it.id || it._id) === String(id))) found = it; });
                });
            }
        }
        showHomepageModal(found || null);
    }).catch(err => {
        console.warn('editHomepageById error', err);
        showHomepageModal(null);
    });
}

async function pushHomepageProduct(id) {
    try { await apiFetch(`${API}/homepage-products/${encodeURIComponent(id)}/push`, { method: 'POST' }); adminNotify('Pushed to front-end', 'success'); }
    catch (err) { console.error(err); adminNotify('Failed to push', 'error'); }
}

/* ------------------------------
   Top Picks CRUD
   ------------------------------ */
async function loadTopPicks() {
    try {
        const res = await apiFetch(`${API}/top-picks`);
        if (!res.ok) return;
        const list = await res.json();
        const tbody = q('#topPicksTable tbody'); if (!tbody) return;
        tbody.innerHTML = '';
        list.forEach(tp => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(tp.product_title)}</td>
                <td>${escapeHtml(tp.brand)}</td>
                <td>${escapeHtml(String(tp.rank || ''))}</td>
                <td>${escapeHtml(Array.isArray(tp.tags) ? tp.tags.join(', ') : (tp.tags || ''))}</td>
                <td>${tp.sales_count ? tp.sales_count : '-'}</td>
                <td class="action">
                    <button class="btn small accent edit-toppick" data-id="${escapeHtmlAttr(tp.id)}"><span class="material-icons">edit</span></button>
                    <button class="btn small danger delete-toppick" data-id="${escapeHtmlAttr(tp.id)}"><span class="material-icons">delete</span></button>
                    <button class="btn small" data-id="${escapeHtmlAttr(tp.id)}" onclick="pushTopPick('${escapeHtmlAttr(tp.id)}')"><span class="material-icons">publish</span></button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        qa('.edit-toppick', tbody).forEach(btn => btn.addEventListener('click', e => editTopPickById(e.currentTarget.dataset.id)));
        qa('.delete-toppick', tbody).forEach(btn => btn.addEventListener('click', async e => {
            const id = e.currentTarget.dataset.id;
            if (!confirm('Delete this Top Pick?')) return;
            try { await apiFetch(`${API}/top-picks/${encodeURIComponent(id)}`, { method: 'DELETE' }); adminNotify('Deleted', 'success'); loadTopPicks(); }
            catch (err) { console.error(err); adminNotify('Delete failed', 'error'); }
        }));
    } catch (err) { console.warn('loadTopPicks error', err); }
}

if (el('addTopPickBtn')) {
    el('addTopPickBtn').addEventListener('click', (e) => { e.preventDefault(); showTopPickModal(null); });
}

function editTopPickById(id) {
    apiFetch(`${API}/top-picks`).then(res => res.json()).then(list => {
        const tp = (list || []).find(x => x.id === id); showTopPickModal(tp);
    }).catch(err => console.warn(err));
}

function showTopPickModal(tp) {
    apiFetch(`${API}/products`).then(res => res.json()).then(products => {
        const modalBg = el('modalBg'), modalContent = el('modalContent');
        if (!modalBg || !modalContent) return;
        modalBg.style.display = 'flex';
        modalContent.innerHTML = `
            <h3>${tp ? 'Edit' : 'Add'} Top Pick</h3>
            <form id="topPickFormModal">
                <label>Product</label>
                <select name="product_id" required>
                    ${products.map(p => `<option value="${escapeHtmlAttr(p.id)}" ${tp && tp.product_id == p.id ? 'selected' : ''}>${escapeHtml(p.title)} (${escapeHtml(p.brand)})</option>`).join('')}
                </select>
                <label>Rank</label>
                <input name="rank" type="number" min="1" max="100" value="${tp ? escapeHtmlAttr(tp.rank || '') : ''}" required>
                <label>Tags</label>
                <input name="tags" value="${tp ? escapeHtmlAttr(Array.isArray(tp.tags) ? tp.tags.join(', ') : tp.tags || '') : ''}">
                <div style="display:flex;gap:12px;margin-top:12px;">
                    <button type="submit" class="btn">${tp ? 'Save' : 'Add'}</button>
                    <button type="button" class="btn accent" id="tpCancel">Cancel</button>
                </div>
            </form>
        `;
        q('#tpCancel').addEventListener('click', () => closeModal());
        q('#topPickFormModal').onsubmit = async function (e) {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(e.target).entries());
            data.rank = parseInt(data.rank, 10) || 0;
            data.tags = data.tags ? data.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
            try {
                if (tp) await apiFetch(`${API}/top-picks/${encodeURIComponent(tp.id)}`, { method: 'PUT', body: data });
                else {
                    const res = await apiFetch(`${API}/top-picks`, { method: 'POST', body: data });
                    if (res.ok) {
                        const created = await res.json().catch(() => null);
                        if (created && created.id) {
                            try { await apiFetch(`${API}/top-picks/${encodeURIComponent(created.id)}/push`, { method: 'POST' }); }
                            catch (e) { console.warn('push failed', e); }
                        }
                    }
                }
                adminNotify('Saved', 'success');
            } catch (err) { console.error(err); adminNotify('Save failed', 'error'); }
            closeModal(); loadTopPicks();
        };
    }).catch(err => console.warn(err));
}

async function pushTopPick(id) {
    try { await apiFetch(`${API}/top-picks/${encodeURIComponent(id)}/push`, { method: 'POST' }); adminNotify('Pushed to front-end', 'success'); }
    catch (err) { console.error(err); adminNotify('Failed to push', 'error'); }
}

/* ------------------------------
   Coupons / Promotions CRUD
   ------------------------------ */
async function loadCoupons() {
    try {
        const res = await apiFetch(`${API}/coupons`);
        if (!res.ok) return;
        const list = await res.json();
        const tbody = q('#couponsTable tbody'); if (!tbody) return;
        tbody.innerHTML = '';
        list.forEach(c => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(c.code)}</td>
                <td>${escapeHtml(c.description || '')}</td>
                <td>${escapeHtml(c.discount_type || '')}</td>
                <td>${escapeHtml(String(c.discount_value || ''))}</td>
                <td>${escapeHtml(c.start_date || '')}</td>
                <td>${escapeHtml(c.end_date || '')}</td>
                <td>${c.active ? 'Yes' : 'No'}</td>
                <td class="action">
                    <button class="btn small accent edit-coupon" data-code="${escapeHtmlAttr(c.code)}"><span class="material-icons">edit</span></button>
                    <button class="btn small danger delete-coupon" data-code="${escapeHtmlAttr(c.code)}"><span class="material-icons">delete</span></button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        qa('.edit-coupon', tbody).forEach(btn => btn.addEventListener('click', e => editCouponByCode(e.currentTarget.dataset.code)));
        qa('.delete-coupon', tbody).forEach(btn => btn.addEventListener('click', async e => {
            const code = e.currentTarget.dataset.code;
            if (!confirm(`Delete coupon ${code}?`)) return;
            try { await apiFetch(`${API}/coupons/${encodeURIComponent(code)}`, { method: 'DELETE' }); adminNotify('Deleted', 'success'); loadCoupons(); }
            catch (err) { console.error(err); adminNotify('Delete failed', 'error'); }
        }));
    } catch (err) { console.warn(err); }
}
if (el('addCouponBtn')) el('addCouponBtn').addEventListener('click', () => showCouponModal(null));

function editCouponByCode(code) {
    apiFetch(`${API}/coupons`).then(res => res.json()).then(list => {
        const c = (list || []).find(x => x.code === code); showCouponModal(c);
    }).catch(err => console.warn(err));
}

function showCouponModal(promo) {
    const modalBg = el('modalBg'); const modalContent = el('modalContent');
    if (!modalBg || !modalContent) return;
    modalBg.style.display = 'flex';
    modalContent.innerHTML = `
        <h3>${promo ? 'Edit' : 'Add'} Promotion</h3>
        <form id="couponFormModal">
            <label>Promo Code</label>
            <input name="code" required value="${promo ? escapeHtmlAttr(promo.code) : ''}" ${promo ? 'readonly' : ''}>
            <label>Description</label>
            <textarea name="description" rows="2">${promo ? escapeHtmlAttr(promo.description || '') : ''}</textarea>
            <label>Discount Type</label>
            <select name="discount_type">
                <option value="percent" ${promo && promo.discount_type === 'percent' ? 'selected' : ''}>Percent (%)</option>
                <option value="fixed" ${promo && promo.discount_type === 'fixed' ? 'selected' : ''}>Fixed Amount</option>
            </select>
            <label>Discount Value</label>
            <input name="discount_value" type="number" step="0.01" min="0" value="${promo ? escapeHtmlAttr(promo.discount_value || '') : ''}">
            <label>Start Date</label>
            <input name="start_date" type="date" value="${promo ? escapeHtmlAttr(promo.start_date || '') : ''}">
            <label>End Date</label>
            <input name="end_date" type="date" value="${promo ? escapeHtmlAttr(promo.end_date || '') : ''}">
            <label>Active</label>
            <select name="active">
                <option value="true" ${promo && promo.active ? 'selected' : ''}>Yes</option>
                <option value="false" ${promo && !promo.active ? 'selected' : ''}>No</option>
            </select>
            <div style="display:flex;gap:12px;margin-top:12px;">
                <button type="submit" class="btn">${promo ? 'Save' : 'Add'}</button>
                <button type="button" class="btn accent" id="couponCancel">Cancel</button>
            </div>
        </form>
    `;
    q('#couponCancel').addEventListener('click', () => closeModal());
    q('#couponFormModal').onsubmit = async function (e) {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.target).entries());
        data.discount_value = parseFloat(data.discount_value) || 0;
        data.active = data.active === 'true';
        try {
            if (promo) await apiFetch(`${API}/coupons/${encodeURIComponent(promo.code)}`, { method: 'PUT', body: data });
            else await apiFetch(`${API}/coupons`, { method: 'POST', body: data });
            adminNotify('Saved', 'success');
        } catch (err) { console.error(err); adminNotify('Save failed', 'error'); }
        closeModal(); loadCoupons();
    };
}

/* ------------------------------
   Orders CRUD
   ------------------------------ */
async function loadOrders() {
    try {
        const res = await apiFetch(`${API}/orders`);
        if (!res.ok) return;
        const list = await res.json();
        const tbody = q('#ordersTable tbody'); if (!tbody) return;
        tbody.innerHTML = '';
        list.forEach(o => {
            let statusClass = 'order-pending';
            if (o.status === 'Delivered') statusClass = 'order-delivered';
            else if (o.status === 'Cancelled') statusClass = 'order-cancelled';
            else if (o.status === 'Processing') statusClass = 'order-processing';
            else if (o.status === 'Shipped') statusClass = 'order-shipped';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(o.customer_name)}</td>
                <td>${escapeHtml(o.customer_email)}</td>
                <td>${escapeHtml(o.customer_phone)}</td>
                <td>${escapeHtml(o.customer_address)}</td>
                <td>${escapeHtml(o.product_title)}</td>
                <td>${escapeHtml(String(o.quantity || 1))}</td>
                <td><span class="${statusClass}">${escapeHtml(o.status || '')}</span></td>
                <td>${escapeHtml(o.payment_method || 'Cash on Delivery')}</td>
                <td>${escapeHtml(o.date || '')}</td>
                <td class="action">
                    <button class="btn small accent edit-order" data-id="${escapeHtmlAttr(o.id)}"><span class="material-icons">edit</span></button>
                    <button class="btn small danger delete-order" data-id="${escapeHtmlAttr(o.id)}"><span class="material-icons">delete</span></button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        qa('.edit-order', tbody).forEach(btn => btn.addEventListener('click', e => editOrderById(e.currentTarget.dataset.id)));
        qa('.delete-order', tbody).forEach(btn => btn.addEventListener('click', async e => {
            const id = e.currentTarget.dataset.id;
            if (!confirm('Delete order?')) return;
            try { await apiFetch(`${API}/orders/${encodeURIComponent(id)}`, { method: 'DELETE' }); adminNotify('Deleted', 'success'); loadOrders(); }
            catch (err) { console.error(err); adminNotify('Delete failed', 'error'); }
        }));
    } catch (err) { console.warn(err); }
}

function editOrderById(id) {
    apiFetch(`${API}/orders`).then(res => res.json()).then(list => {
        const order = (list || []).find(x => String(x.id) === String(id)); showOrderModal(order);
    }).catch(err => console.warn(err));
}

function showOrderModal(order) {
    apiFetch(`${API}/products`).then(res => res.json()).then(products => {
        apiFetch(`${API}/coupons`).then(res => res.json()).then(promos => {
            const modalBg = el('modalBg'), modalContent = el('modalContent');
            if (!modalBg || !modalContent) return;
            modalBg.style.display = 'flex';
            const custName = order ? escapeHtmlAttr(order.customer_name || '') : '';
            const custEmail = order ? escapeHtmlAttr(order.customer_email || '') : '';
            const custPhone = order ? escapeHtmlAttr(order.customer_phone || '') : '';
            const custAddress = order ? escapeHtmlAttr(order.customer_address || '') : '';
            const qty = order ? escapeHtmlAttr(String(order.quantity || 1)) : '1';
            const dateVal = order && order.date ? order.date.replace(' ', 'T').slice(0, 16) : new Date().toISOString().slice(0, 16);
            modalContent.innerHTML = `
                <h3>${order ? 'Edit' : 'Add'} Order</h3>
                <form id="orderFormModal">
                    <label>Customer Name</label>
                    <input name="customer_name" required value="${custName}">
                    <label>Customer Email</label>
                    <input name="customer_email" type="email" required value="${custEmail}">
                    <label>Customer Phone</label>
                    <input name="customer_phone" required value="${custPhone}">
                    <label>Customer Address</label>
                    <textarea name="customer_address" required rows="2">${custAddress}</textarea>
                    <label>Product</label>
                    <select name="product_id" required>
                        ${products.map(p => `<option value="${escapeHtmlAttr(p.id)}" ${order && order.product_id == p.id ? 'selected' : ''}>${escapeHtml(p.title)}</option>`).join('')}
                    </select>
                    <label>Quantity</label>
                    <input name="quantity" type="number" min="1" value="${qty}">
                    <label>Status</label>
                    <select name="status">
                        <option value="Pending" ${order && order.status == 'Pending' ? 'selected' : ''}>Pending</option>
                        <option value="Processing" ${order && order.status == 'Processing' ? 'selected' : ''}>Processing</option>
                        <option value="Shipped" ${order && order.status == 'Shipped' ? 'selected' : ''}>Shipped</option>
                        <option value="Delivered" ${order && order.status == 'Delivered' ? 'selected' : ''}>Delivered</option>
                        <option value="Cancelled" ${order && order.status == 'Cancelled' ? 'selected' : ''}>Cancelled</option>
                    </select>
                    <label>Payment Method</label>
                    <select name="payment_method">
                        <option value="Cash on Delivery" ${order && order.payment_method == 'Cash on Delivery' ? 'selected' : ''}>Cash on Delivery</option>
                        <option value="Card" ${order && order.payment_method == 'Card' ? 'selected' : ''}>Card</option>
                    </select>
                    <label>Date</label>
                    <input name="date" type="datetime-local" value="${dateVal}">
                    <label>Promo Code</label>
                    <select name="promo_code">
                        <option value="">None</option>
                        ${promos.filter(p => p.active).map(p => `<option value="${escapeHtmlAttr(p.code)}" ${order && order.promo_code == p.code ? 'selected' : ''}>${escapeHtml(p.code)} (${escapeHtml(p.description || '')})</option>`).join('')}
                    </select>
                    <div style="display:flex;gap:12px;margin-top:12px;">
                        <button type="submit" class="btn">${order ? 'Save' : 'Add'}</button>
                        <button type="button" class="btn accent" id="orderCancel">Cancel</button>
                    </div>
                </form>
            `;
            q('#orderCancel').addEventListener('click', () => closeModal());
            q('#orderFormModal').onsubmit = async function (e) {
                e.preventDefault();
                const data = Object.fromEntries(new FormData(e.target).entries());
                const selectedProduct = (products || []).find(p => p.id == data.product_id);
                data.product_title = selectedProduct ? selectedProduct.title : '';
                data.quantity = parseInt(data.quantity, 10) || 1;
                if (!data.date) data.date = new Date().toISOString().slice(0, 16).replace('T', ' ');
                else data.date = data.date.replace('T', ' ');
                try {
                    if (order) await apiFetch(`${API}/orders/${encodeURIComponent(order.id)}`, { method: 'PUT', body: data });
                    else await apiFetch(`${API}/orders`, { method: 'POST', body: data });
                    adminNotify('Order saved', 'success');
                } catch (err) { console.error(err); adminNotify('Save failed', 'error'); }
                closeModal(); loadOrders();
            };
        }).catch(err => console.warn(err));
    }).catch(err => console.warn(err));
}

/* ------------------------------
   Content Admin (Quill) - full featured
   ------------------------------ */
(function () {
    const storiesListEl = el('storiesList');
    const titleEl = el('title');
    const slugEl = el('slug');
    const btnGenSlugEl = el('btnGenSlug');
    const sectionEl = el('section');
    const excerptEl = el('excerpt');
    const authorEl = el('author');
    const imageFileEl = el('imageFile');
    const uploadedPreviewEl = el('uploadedPreview');
    const btnClearImageEl = el('btnClearImage');
    const saveBtnEl = el('saveBtn');
    const publishBtnEl = el('btnPublish');
    const cancelBtnEl = el('btnCancel');
    const newBtnEl = el('btnNew');
    const refreshBtnEl = el('btnRefresh');
    const saveOrderBtnEl = el('btnSaveOrder');
    const searchInputEl = el('searchInput');
    const prevPageBtnEl = el('btnPrevPage');
    const nextPageBtnEl = el('btnNextPage');
    const saveStatusEl = el('saveStatus');
    const adminErrorEl = el('adminError');
    const editingIdInputEl = el('editingId');
    const editorTitleEl = el('editorTitle');
    const quillContainer = el('quillEditor');
    const bodyHiddenInput = el('body_html');
    const storyFormEl = el('storyForm');

    if (!quillContainer || !storyFormEl) return;

    let quill;
    let editingId = null;
    let uploadedImagePath = null;
    let slugTouched = false;
    let currentPage = 1;
    let currentLimit = 20;
    let currentQuery = '';

    function setStatus(msg, ok = true) { if (!saveStatusEl) return; saveStatusEl.textContent = msg || ''; saveStatusEl.style.color = ok ? '' : '#b00020'; }
    function showError(msg) { if (!adminErrorEl) { alert(msg); return; } adminErrorEl.hidden = false; adminErrorEl.textContent = msg; setTimeout(() => adminErrorEl.hidden = true, 7000); }
    function generateSlug(text) { return (text || '').toLowerCase().trim().replace(/[’'"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
    async function extractErrorText(res) {
        try { const js = await res.json(); return js.error || js.detail || JSON.stringify(js); }
        catch (e) { try { return await res.text(); } catch (e2) { return res.statusText || 'Error'; } }
    }

    function initQuill() {
        try {
            quill = new Quill('#quillEditor', {
                theme: 'snow',
                modules: {
                    toolbar: {
                        container: [
                            [{ header: [1, 2, 3, false] }],
                            ['bold', 'italic', 'underline', 'strike'],
                            [{ list: 'ordered' }, { list: 'bullet' }],
                            ['link', 'image'],
                            ['clean']
                        ],
                        handlers: { image: quillImageHandler }
                    }
                }
            });
            quill.on('text-change', () => { if (bodyHiddenInput) bodyHiddenInput.value = quill.root.innerHTML; });
        } catch (err) {
            console.warn('Quill init failed', err);
        }
    }

    async function quillImageHandler() {
        const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.click();
        input.onchange = async () => {
            const file = input.files[0]; if (!file) return;
            const fd = new FormData(); fd.append('image', file);
            try {
                const res = await apiFetch(`${CONTENT_API}/admin/upload-image`, { method: 'POST', body: fd });
                if (!res.ok) { const txt = await extractErrorText(res); alert('Image upload failed: ' + txt); return; }
                const js = await res.json(); const url = js.url || (js.path ? `/static/${js.path}` : null);
                if (url) { const range = quill.getSelection(true); quill.insertEmbed(range.index, 'image', url); quill.setSelection(range.index + 1); }
            } catch (err) { console.error(err); alert('Image upload failed'); }
        };
    }

    if (titleEl) titleEl.addEventListener('input', (e) => { if (!slugTouched && slugEl) slugEl.value = generateSlug(e.target.value); });
    if (slugEl) slugEl.addEventListener('input', () => slugTouched = true);
    if (btnGenSlugEl) btnGenSlugEl.addEventListener('click', () => { if (titleEl && slugEl) { slugEl.value = generateSlug(titleEl.value); slugTouched = true; } });

    if (btnClearImageEl) btnClearImageEl.addEventListener('click', () => { uploadedImagePath = null; if (uploadedPreviewEl) uploadedPreviewEl.innerHTML = ''; if (imageFileEl) imageFileEl.value = ''; });

    if (imageFileEl) {
        imageFileEl.addEventListener('change', async (e) => {
            const f = e.target.files[0]; if (!f) return;
            const fd = new FormData(); fd.append('image', f);
            try {
                const res = await apiFetch(`${CONTENT_API}/admin/upload-image`, { method: 'POST', body: fd });
                if (!res.ok) { const txt = await extractErrorText(res); showError('Image upload failed: ' + txt); return; }
                const js = await res.json(); uploadedImagePath = js.url || (js.path ? `/static/${js.path}` : null);
                if (uploadedPreviewEl) uploadedPreviewEl.innerHTML = uploadedImagePath ? `<img src="${uploadedImagePath}" style="max-width:220px;border-radius:6px;">` : '';
            } catch (err) { console.error(err); showError('Upload failed (network).'); }
        });
    }

    if (newBtnEl) newBtnEl.addEventListener('click', () => {
        editingId = null; if (editingIdInputEl) editingIdInputEl.value = ''; storyFormEl.reset(); quill && (quill.root.innerHTML = ''); uploadedImagePath = null; if (uploadedPreviewEl) uploadedPreviewEl.innerHTML = ''; slugTouched = false; if (editorTitleEl) editorTitleEl.textContent = 'New Story';
    });

    if (refreshBtnEl) refreshBtnEl.addEventListener('click', () => fetchStoriesAdmin());
    if (prevPageBtnEl) prevPageBtnEl.addEventListener('click', () => { if (currentPage > 1) { currentPage--; fetchStoriesAdmin(); } });
    if (nextPageBtnEl) nextPageBtnEl.addEventListener('click', () => { currentPage++; fetchStoriesAdmin(); });
    if (saveOrderBtnEl) saveOrderBtnEl.addEventListener('click', () => saveOrderAdmin());
    if (searchInputEl) searchInputEl.addEventListener('keyup', (e) => { if (e.key === 'Enter') { currentQuery = searchInputEl.value.trim(); currentPage = 1; fetchStoriesAdmin(); } });

    storyFormEl.addEventListener('submit', async (e) => {
        e.preventDefault();
        setStatus('Saving…');
        if (adminErrorEl) adminErrorEl.hidden = true;
        const payload = {
            title: titleEl ? titleEl.value.trim() : '',
            slug: slugEl ? slugEl.value.trim() : '',
            section: sectionEl ? sectionEl.value.trim() : '',
            excerpt: excerptEl ? excerptEl.value.trim() : '',
            body_html: quill ? quill.root.innerHTML : (bodyHiddenInput ? bodyHiddenInput.value : ''),
            author: authorEl ? authorEl.value.trim() : '',
            featured_image: uploadedImagePath
        };
        if (!payload.title) { showError('Title required'); setStatus('', false); return; }
        if (!payload.slug) { showError('Slug required'); setStatus('', false); return; }
        try {
            let res;
            if (editingId) res = await apiFetch(`${CONTENT_API}/admin/stories/${editingId}`, { method: 'PUT', body: payload });
            else res = await apiFetch(`${CONTENT_API}/admin/stories`, { method: 'POST', body: payload });
            if (!res.ok) { const txt = await extractErrorText(res); showError('Save failed: ' + txt); setStatus('', false); return; }
            setStatus('Saved'); editingId = null; if (editingIdInputEl) editingIdInputEl.value = ''; storyFormEl.reset(); quill && (quill.root.innerHTML = ''); if (uploadedPreviewEl) uploadedPreviewEl.innerHTML = ''; uploadedImagePath = null; slugTouched = false; fetchStoriesAdmin();
        } catch (err) { console.error(err); showError('Save failed (network).'); setStatus('', false); } finally { setTimeout(() => setStatus(''), 1600); }
    });

    if (publishBtnEl) publishBtnEl.addEventListener('click', async () => {
        const id = editingId || (editingIdInputEl ? editingIdInputEl.value : null);
        if (!id) { showError('Save first before publishing'); return; }
        try {
            const res = await apiFetch(`${CONTENT_API}/admin/stories/${id}/publish`, { method: 'POST', body: { action: 'publish' } });
            if (!res.ok) { const txt = await extractErrorText(res); showError('Publish failed: ' + txt); return; }
            setStatus('Published'); fetchStoriesAdmin();
        } catch (err) { console.error(err); showError('Publish failed (network).'); } finally { setTimeout(() => setStatus(''), 1400); }
    });

    async function fetchStoriesAdmin() {
        if (!storiesListEl) return;
        storiesListEl.innerHTML = "<div style='color:#666'>Loading…</div>";
        try {
            const params = new URLSearchParams();
            params.set('page', currentPage);
            params.set('limit', currentLimit);
            if (currentQuery) params.set('q', currentQuery);
            const res = await apiFetch(`${CONTENT_API}/admin/stories?${params.toString()}`);
            if (!res.ok) { const txt = await extractErrorText(res); showError('Load failed: ' + txt); storiesListEl.innerHTML = "<div style='color:#c00'>Unable to load stories.</div>"; return; }
            const js = await res.json(); renderStoriesAdmin(js.items || []);
        } catch (err) { console.error(err); storiesListEl.innerHTML = "<div style='color:#c00'>Error loading stories.</div>"; }
    }

    function renderStoriesAdmin(list) {
        if (!Array.isArray(list) || list.length === 0) { storiesListEl.innerHTML = "<div>No stories yet.</div>"; return; }
        storiesListEl.innerHTML = '';
        list.forEach(item => {
            const row = document.createElement('div');
            row.className = 'story-row';
            row.draggable = true;
            row.dataset.id = item.id;
            row.innerHTML = `
                <div style="display:flex;gap:10px;align-items:center;">
                    <span class="draggable-handle" title="Drag to reorder">☰</span>
                    <div>
                        <div style="font-weight:600">${escapeHtml(item.title)}</div>
                        <div style="font-size:0.9rem;color:#666">${escapeHtml(item.slug || '')} • ${escapeHtml(item.section || '')}</div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;">
                    <button class="btn small" data-action="edit" data-id="${escapeHtmlAttr(item.id)}">Edit</button>
                    <button class="btn small subtle" data-action="delete" data-id="${escapeHtmlAttr(item.id)}">Delete</button>
                </div>
            `;
            row.addEventListener('dragstart', adminHandleDragStart);
            row.addEventListener('dragover', adminHandleDragOver);
            row.addEventListener('drop', adminHandleDrop);
            row.addEventListener('dragend', adminHandleDragEnd);
            storiesListEl.appendChild(row);
        });
        qa('button[data-action]', storiesListEl).forEach(btn => btn.addEventListener('click', async (e) => {
            const action = e.currentTarget.dataset.action;
            const id = e.currentTarget.dataset.id;
            if (action === 'edit') adminEditStory(id);
            else if (action === 'delete') {
                if (!confirm('Delete this story?')) return;
                const r = await apiFetch(`${CONTENT_API}/admin/stories/${id}`, { method: 'DELETE' });
                if (!r.ok) { showError('Delete failed'); return; }
                fetchStoriesAdmin();
            }
        }));
    }

    let dragSrcEl = null;
    function adminHandleDragStart(e) { dragSrcEl = e.currentTarget; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', e.currentTarget.dataset.id); e.currentTarget.style.opacity = '0.4'; }
    function adminHandleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add('drag-over'); }
    function adminHandleDrop(e) { e.stopPropagation(); const srcId = e.dataTransfer.getData('text/plain'); const dest = e.currentTarget; if (!srcId || !dest || dest.dataset.id === srcId) return; const srcEl = Array.from(storiesListEl.children).find(n => n.dataset.id === srcId); storiesListEl.insertBefore(srcEl, dest.nextSibling); }
    function adminHandleDragEnd(e) { e.currentTarget.style.opacity = ''; Array.from(storiesListEl.children).forEach(c => c.classList.remove('drag-over')); }

    async function saveOrderAdmin() {
        const ids = Array.from(storiesListEl.children).map(c => c.dataset.id).filter(Boolean);
        if (!ids.length) return;
        try {
            const res = await apiFetch(`${CONTENT_API}/admin/stories/reorder`, { method: 'POST', body: { ids } });
            if (!res.ok) { const txt = await extractErrorText(res); showError('Save order failed: ' + txt); return; }
            setStatus('Order saved'); fetchStoriesAdmin();
        } catch (err) { console.error(err); showError('Save order failed (network).'); } finally { setTimeout(() => setStatus(''), 1500); }
    }

    async function adminEditStory(id) {
        try {
            const listRes = await apiFetch(`${CONTENT_API}/admin/stories?page=1&limit=200`);
            if (!listRes.ok) { showError('Unable to fetch story list'); return; }
            const listJs = await listRes.json();
            const item = (listJs.items || []).find(it => String(it.id) === String(id));
            if (!item) { showError('Story not found'); return; }
            editingId = item.id; if (editingIdInputEl) editingIdInputEl.value = item.id; if (editorTitleEl) editorTitleEl.textContent = 'Edit Story';
            if (titleEl) titleEl.value = item.title || ''; if (slugEl) slugEl.value = item.slug || ''; if (sectionEl) sectionEl.value = item.section || '';
            if (excerptEl) excerptEl.value = item.excerpt || ''; if (authorEl) authorEl.value = item.author || '';
            const detailRes = await apiFetch(`${CONTENT_API}/stories/${item.slug}`);
            if (detailRes.ok) {
                const djs = await detailRes.json(); quill.root.innerHTML = djs.body_html || ''; if (bodyHiddenInput) bodyHiddenInput.value = djs.body_html || '';
                uploadedImagePath = djs.featured_image || null; if (uploadedPreviewEl) uploadedPreviewEl.innerHTML = uploadedImagePath ? `<img src="${uploadedImagePath}" style="max-width:220px;border-radius:6px;">` : '';
            } else { quill.root.innerHTML = ''; if (uploadedPreviewEl) uploadedPreviewEl.innerHTML = ''; }
            slugTouched = true;
        } catch (err) { console.error(err); showError('Failed to load story for editing.'); }
    }

    initQuill();
    fetchStoriesAdmin();
})();

/* ------------------------------
   Modal helpers & init
   ------------------------------ */
function closeModal() { const mb = el('modalBg'); if (mb) mb.style.display = 'none'; }
if (el('modalBg')) { el('modalBg').onclick = function (e) { if (e.target === this) closeModal(); }; }

/* Start on brands tab */
switchTab('brands');

/* End of admin.js */