/*
  All previously inlined JavaScript from the brand.html template has been moved here.
  This file is static and does not contain Jinja. Template-level values are exposed
  on window.* (see brand.html) so this script uses those globals.
*/

(function () {
    // Fetch polyfill override (preserve behavior from original inline script)
    (function () {
        const ORIGINAL_FETCH = window.fetch.bind(window);
        window.fetch = function (input, init) {
            try {
                if (input && typeof input === 'object' && input.url) {
                    let newUrl = input.url;
                    if (typeof newUrl === 'string' && newUrl.indexOf('http://127.0.0.1:5000') === 0) {
                        newUrl = newUrl.replace('http://127.0.0.1:5000', '');
                        input = new Request(newUrl, input);
                    }
                } else if (typeof input === 'string') {
                    if (input.indexOf('http://127.0.0.1:5000') === 0) {
                        input = input.replace('http://127.0.0.1:5000', '');
                    }
                }
            } catch (e) { }
            return ORIGINAL_FETCH(input, init);
        };
    })();
})();

/* Config / Helpers */
const API = "/api";
const PLACEHOLDER_IMG = (window.PLACEHOLDER_IMG || '/static/images/placeholder.jpg');
const URL_CHECKOUT = (window.URL_CHECKOUT || '/checkout');
const URL_INDEX = (window.URL_INDEX || '/');
const PAYPAL_CURRENCY_GLOBAL = (window.PAYPAL_CURRENCY || 'USD');

function toStaticUrl(url) {
    if (!url) return PLACEHOLDER_IMG;
    if (typeof url !== 'string') return PLACEHOLDER_IMG;
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')) return url;
    return `/static/${url}`;
}

/* Discount fetch */
async function fetchDiscountPercent() {
    try {
        const r = await fetch(`${API}/settings/checkout_discount`);
        if (!r.ok) return 0;
        const js = await r.json();
        return parseFloat(js.percent) || 0;
    } catch (err) {
        console.warn('fetchDiscountPercent error', err);
        return 0;
    }
}

async function showDiscountBanner() {
    const percent = await fetchDiscountPercent();
    const discountInfoDiv = document.getElementById('discountPercentInfo');
    if (!discountInfoDiv) return;
    if (percent > 0) {
        discountInfoDiv.style.display = "block";
        discountInfoDiv.innerHTML = `<span>🌟 <b>Special Offer:</b> <span style="color:#27ae60">${percent}% OFF</span> applied automatically at checkout & in your cart!</span>`;
    } else {
        discountInfoDiv.style.display = "none";
    }
}
showDiscountBanner();

// --- Cart helpers ---
function getCart() { return JSON.parse(localStorage.getItem('cart') || '[]'); }
function saveCart(cart) { localStorage.setItem('cart', JSON.stringify(cart)); }
function formatPrice(value) { return `$${(Number(value) || 0).toFixed(2)}`; }

function updateCartBadge() {
    const badge = document.getElementById('cartCountBadge');
    const cart = getCart();
    if (!badge) return;
    const count = (cart || []).reduce((s, it) => s + (parseInt(it.quantity || it.qty || 1) || 0), 0);
    if (count > 0) {
        badge.style.display = 'inline-block';
        badge.textContent = count;
    } else {
        badge.style.display = 'none';
    }
}

/* Render checkout preview inside modal */
function renderCheckoutModalCart() {
    const cart = getCart() || [];
    const section = document.getElementById('cartSection');
    const discountDiv = document.getElementById('checkoutDiscountInfo');
    if (!section) return;
    if (!cart.length) {
        section.innerHTML = '<div class="empty-cart">Your cart is empty.</div>';
        if (discountDiv) discountDiv.style.display = 'none';
        return;
    }

    let subtotal = 0;
    let html = '<table style="width:100%;border-collapse:collapse;margin-bottom:12px;"><thead><tr><th style="text-align:left">Product</th><th style="text-align:center;width:72px;">Qty</th><th style="text-align:right">Total</th></tr></thead><tbody>';
    cart.forEach(item => {
        const qty = parseInt(item.quantity || item.qty || 1);
        const price = parseFloat(item.price || 0);
        const total = price * qty;
        subtotal += total;
        const img = toStaticUrl(item.image || item.image_url || '');
        html += `<tr style="border-bottom:1px solid #eee;"><td style="padding:8px 6px;">
            <div style="display:flex;gap:10px;align-items:center;">
                <img src="${img}" alt="${(item.title || item.name || '')}" style="width:56px;height:56px;object-fit:contain;border-radius:6px;background:#fff;border:1px solid #eee;">
                <div style="min-width:0;">
                    <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;">${item.title || item.name || ''}</div>
                    <div class="small-muted" style="font-size:13px">${item.brand || ''}</div>
                    <div class="small-muted" style="font-size:13px">${formatPrice(price)} each</div>
                </div>
            </div>
        </td><td style="text-align:center;">${qty}</td><td style="text-align:right;">${formatPrice(total)}</td></tr>`;
    });
    html += '</tbody></table>';

    const discountPercent = (window.checkoutDiscountPercent || 0);
    const discountedTotal = subtotal * (1 - (discountPercent / 100));
    if (discountPercent > 0) {
        if (discountDiv) {
            discountDiv.style.display = 'block';
            discountDiv.innerHTML = `🌟 <b>Special Offer:</b> <span style="color:#27ae60">${discountPercent}% OFF</span> applied automatically!`;
        }
        html += `<div style="display:flex;gap:12px;align-items:center;justify-content:space-between;margin-top:6px;">
            <div style="font-weight:700;">Subtotal</div><div style="font-weight:700;">${formatPrice(subtotal)}</div>
        </div>
        <div style="display:flex;gap:12px;align-items:center;justify-content:space-between;margin-top:6px;">
            <div style="font-weight:700;color:#27ae60;">Total (after discount)</div><div style="font-weight:700;color:#27ae60;">${formatPrice(discountedTotal)}</div>
        </div>`;
    } else {
        if (discountDiv) discountDiv.style.display = 'none';
        html += `<div style="display:flex;gap:12px;align-items:center;justify-content:space-between;margin-top:6px;">
            <div style="font-weight:700;">Total</div><div style="font-weight:700;">${formatPrice(subtotal)}</div>
        </div>`;
    }

    html += `<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">
        <button id="continueToCheckoutBtn" style="background:#2d8f7c;color:#fff;padding:8px 12px;border-radius:6px;border:none;cursor:pointer;">Proceed to Checkout</button>
        <button id="closeCheckoutPreviewBtn" style="background:#f0f0f0;color:#222;padding:8px 12px;border-radius:6px;border:1px solid #e6e6e6;cursor:pointer;">Continue Shopping</button>
    </div>`;

    section.innerHTML = html;

    // attach handlers
    const contBtn = document.getElementById('continueToCheckoutBtn');
    if (contBtn) {
        contBtn.addEventListener('click', function () {
            window.location.href = (URL_CHECKOUT || '/');
        });
    }
    const closeBtn = document.getElementById('closeCheckoutPreviewBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', function () {
            closeCheckoutModal();
        });
    }
}

/* Cart modal rendering */
function renderCartModal() {
    const cart = getCart() || [];
    const list = document.getElementById('cartList');
    const totalEl = document.getElementById('cartModalTotal');
    const discountDiv = document.getElementById('cartDiscountInfo');
    if (!list) return;
    if (!cart.length) {
        list.innerHTML = '<div class="cart-modal-empty">Your cart is empty.</div>';
        if (totalEl) totalEl.textContent = '';
        if (discountDiv) discountDiv.style.display = 'none';
        return;
    }

    let html = '';
    let total = 0;
    cart.forEach((item, idx) => {
        const qty = parseInt(item.quantity || item.qty || 1);
        const price = parseFloat(item.price || 0);
        const line = price * qty;
        total += line;
        const img = toStaticUrl(item.image || item.image_url || '');
        html += `
        <div class="cart-list-item" data-idx="${idx}" style="display:flex;gap:10px;padding:10px 6px;border-bottom:1px solid #eee;align-items:center;">
            <img src="${img}" alt="${item.title || ''}" style="width:64px;height:64px;object-fit:contain;border-radius:6px;background:#fff;border:1px solid #eee;">
            <div style="flex:1;min-width:0;">
                <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.title || ''}</div>
                <div class="small-muted">${item.brand || ''}</div>
                <div style="margin-top:6px;display:flex;gap:8px;align-items:center;">
                    <button type="button" data-idx="${idx}" data-change="-1" class="cart-qty-btn" style="padding:6px 8px;border-radius:6px;border:1px solid #ddd;background:#fff;cursor:pointer;">-</button>
                    <span class="cart-qty-display" style="min-width:28px;text-align:center;display:inline-block;">${qty}</span>
                    <button type="button" data-idx="${idx}" data-change="1" class="cart-qty-btn" style="padding:6px 8px;border-radius:6px;border:1px solid #ddd;background:#fff;cursor:pointer;">+</button>
                </div>
            </div>
            <div style="text-align:right;min-width:90px;">
                <div style="font-weight:700;">${formatPrice(line)}</div>
                <button type="button" data-remove-idx="${idx}" class="cart-remove-btn" style="margin-top:8px;background:#e74c3c;color:#fff;border:none;padding:6px 8px;border-radius:6px;cursor:pointer;">Remove</button>
            </div>
        </div>`;
    });

    list.innerHTML = html;
    if (totalEl) totalEl.innerHTML = `<div style="font-weight:700;">Total: ${formatPrice(total)}</div>`;

    // attach qty and remove handlers
    list.querySelectorAll('.cart-qty-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            const idx = parseInt(this.getAttribute('data-idx'));
            const change = parseInt(this.getAttribute('data-change'));
            if (!isNaN(idx)) window.updateCartModalQuantity(idx, change);
        });
    });
    list.querySelectorAll('.cart-remove-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const ridx = parseInt(this.getAttribute('data-remove-idx'));
            if (!isNaN(ridx)) {
                let c = getCart();
                c.splice(ridx, 1);
                saveCart(c);
                updateCartBadge();
                renderCartModal();
            }
        });
    });

    // show discount info if available
    const discountPercent = (window.checkoutDiscountPercent || 0);
    if (discountPercent > 0 && discountDiv) {
        discountDiv.style.display = 'block';
        discountDiv.innerHTML = `🌟 <b>Special Offer:</b> <span style="color:#27ae60">${discountPercent}% OFF</span> applied automatically!`;
    } else if (discountDiv) {
        discountDiv.style.display = 'none';
    }
}

/* cart modal quantity helper */
window.updateCartModalQuantity = function (idx, change) {
    let cart = getCart() || [];
    if (!cart[idx]) return;
    const currentQty = parseInt(cart[idx].quantity || cart[idx].qty || 1);
    const newQty = currentQty + change;
    if (newQty > 0) {
        cart[idx].quantity = newQty;
    } else {
        cart.splice(idx, 1);
    }
    saveCart(cart);
    updateCartBadge();
    renderCartModal();
};

/* open/close checkout modal */
function openCheckoutModal() {
    const bg = document.getElementById('checkoutModalBg');
    if (!bg) return;
    bg.style.display = 'flex';
    bg.style.alignItems = 'center';
    bg.style.justifyContent = 'center';
    renderCheckoutModalCart();

    // ensure button state reflects selected payment method
    try { updatePaymentButtonsStateCheckout(); } catch (e) { /* ignore */ }

    // Try to render PayPal buttons inside the checkout modal if the SDK is available.
    try {
        if (window.paypal && document.querySelector('#modal_paypal_button_container')) {
            const container = document.querySelector('#modal_paypal_button_container');
            if (!container.innerHTML.trim()) {
                renderPayPalButtons('#modal_paypal_button_container', { currency: (PAYPAL_CURRENCY_GLOBAL || 'USD'), successUrl: URL_INDEX || '/' });
            }
        }
    } catch (err) {
        console.warn('PayPal render attempt failed', err);
    }
}

function closeCheckoutModal() {
    const bg = document.getElementById('checkoutModalBg');
    if (!bg) return;
    bg.style.display = 'none';
}

/* DOM event wiring and product loading */
document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'checkoutModalCloseBtn') {
        closeCheckoutModal();
    }
    if (e.target && e.target.id === 'cartModalCloseBtn') {
        const cb = document.getElementById('cartModalBg');
        if (cb) cb.style.display = 'none';
    }
});

document.addEventListener('DOMContentLoaded', function () {
    const cartBtn = document.getElementById('cartBtn');
    if (cartBtn) {
        cartBtn.addEventListener('click', function (e) {
            const modalExists = !!document.getElementById('cartModalBg');
            if (modalExists) {
                e.preventDefault();
                renderCartModal();
                const cb = document.getElementById('cartModalBg');
                if (cb) cb.style.display = 'flex';
                return;
            }
        });
    }

    // page initialization...
    const params = new URLSearchParams(window.location.search);
    const brandParamRaw = params.get('brand') || '';
    const brandForDisplay = decodeURIComponent(brandParamRaw).replace(/_/g, ' ').trim();
    const brandForApi = encodeURIComponent((brandForDisplay || '').replace(/ /g, '_'));

    const brandHeaderEl = document.getElementById('brandHeader');
    const brandTitleEl = document.getElementById('brandTitle');
    if (brandHeaderEl) brandHeaderEl.textContent = brandForDisplay ? `House of ${brandForDisplay} Fragrances` : "Brand Fragrances";
    if (brandTitleEl) brandTitleEl.textContent = brandForDisplay ? `${brandForDisplay} Fragrances` : "Brand Fragrances";

    fetch(`${API}/brands`)
        .then(res => {
            if (!res.ok) throw new Error('Failed to fetch brands');
            return res.json();
        })
        .then(brands => {
            const b = brands.find(x => x.name === brandForDisplay);
            if (b && b.description) {
                const descEl = document.getElementById('brandDesc');
                if (descEl) descEl.textContent = b.description;
            } else {
                const descEl = document.getElementById('brandDesc');
                if (descEl) descEl.textContent = "";
            }
        })
        .catch(err => {
            console.warn('Error loading brands:', err);
            const descEl = document.getElementById('brandDesc');
            if (descEl) descEl.textContent = "";
        });

    const productsApiPath = brandForApi ? `${API}/products/${brandForApi}` : `${API}/products`;
    fetch(productsApiPath)
        .then(res => {
            if (!res.ok) throw new Error('Failed to fetch products');
            return res.json();
        })
        .then(products => {
            const grid = document.getElementById('productGrid');
            if (!grid) return;
            grid.innerHTML = '';
            (products || []).forEach(product => {
                let rawId = '';
                if (product.id) {
                    rawId = product.id;
                } else if (product._id) {
                    if (typeof product._id === 'string') rawId = product._id;
                    else if (product._id.$oid) rawId = product._id.$oid;
                    else rawId = JSON.stringify(product._id);
                } else {
                    rawId = '';
                }
                const pidRaw = rawId ? String(rawId) : '';
                const pid = pidRaw ? encodeURIComponent(pidRaw) : '';

                const priceVal = parseFloat(product.price || 0);
                const discounted = (window.checkoutDiscountPercent && window.checkoutDiscountPercent > 0)
                    ? (priceVal * (1 - (window.checkoutDiscountPercent / 100)))
                    : priceVal;
                const productSlug = encodeURIComponent((product.title || '').replace(/ /g, '_'));
                const brandQuery = encodeURIComponent(brandForDisplay || product.brand || '');
                const productLink = `/brand_detail?brand=${brandQuery}&product=${productSlug}${pid ? `&product_id=${pid}` : ''}`;

                grid.innerHTML += `
                <div class="product-card">
                    <a href="${productLink}" title="View ${brandForDisplay || product.brand} ${product.title}">
                        <div class="product-image-box">
                            <img src="${toStaticUrl(product.image_url)}" alt="${brandForDisplay || product.brand} ${product.title}">
                        </div>
                        <h3>${product.title}</h3>
                    </a>
                    <div class="meta">
                        <span class="price" style="${window.checkoutDiscountPercent > 0 ? 'text-decoration: line-through; color: #888;' : ''}">$${(priceVal).toFixed(2)}</span>
                        ${window.checkoutDiscountPercent > 0 ? `<span class="discounted-price">$${(discounted).toFixed(2)} <span style="font-size:0.92em;color:#888;">(-${window.checkoutDiscountPercent}% Off)</span></span>` : ''}
                        ${product.quantity === 0 ? '<span class="sold-out">Sold Out</span>' : ''}
                    </div>
                    <div class="product-actions">
                        <button class="action-button buy-now" data-id="${pidRaw}" data-title="${product.title}" data-brand="${product.brand}" data-price="${priceVal}" data-image="${product.image_url}" data-qty="1">⚡ Buy Now</button>
                        <button class="action-button wishlist-btn" data-id="${pidRaw}" data-title="${product.title}" data-brand="${product.brand}" data-price="${priceVal}" data-image="${product.image_url}">♡ Wishlist</button>
                    </div>
                </div>
                `;
            });

            // BUY NOW handlers
            document.querySelectorAll('.buy-now').forEach(btn => {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    const pid = this.getAttribute('data-id') || (new Date().getTime() + '');
                    const title = this.getAttribute('data-title') || '';
                    const qty = parseInt(this.getAttribute('data-qty')) || 1;
                    const brand = this.getAttribute('data-brand') || '';
                    let priceVal = parseFloat(this.getAttribute('data-price') || 0);
                    if (!priceVal) {
                        const priceEl = this.closest('.product-card').querySelector('.discounted-price') || this.closest('.product-card').querySelector('.price');
                        const priceText = priceEl ? (priceEl.textContent || '') : '';
                        priceVal = parseFloat((priceText || '').replace(/[^0-9.]/g, '')) || 0;
                    }
                    const imageSrc = (this.getAttribute('data-image') && this.getAttribute('data-image').trim()) ? toStaticUrl(this.getAttribute('data-image')) : ((this.closest('.product-card').querySelector('img') || {}).src || '');

                    // POST order-attempts (best-effort)
                    fetch(`${API}/order-attempts`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            email: "",
                            product: title,
                            qty: qty,
                            status: "Carted"
                        })
                    }).catch(() => { });

                    // update localStorage cart
                    let cart = JSON.parse(localStorage.getItem('cart') || "[]");
                    const existing = cart.find(i => ('' + i.id) === ('' + pid));
                    if (existing) {
                        existing.quantity = (existing.quantity || 0) + qty;
                    } else {
                        cart.push({
                            id: pid,
                            title: title,
                            brand: brand,
                            price: Number(priceVal) || 0,
                            image: imageSrc,
                            quantity: qty
                        });
                    }
                    localStorage.setItem('cart', JSON.stringify(cart));
                    updateCartBadge();

                    // open the checkout preview/modal
                    openCheckoutModal();
                });
            });

            // WISHLIST handlers
            document.querySelectorAll('.wishlist-btn').forEach(btn => {
                const setState = (el, added) => {
                    if (added) {
                        el.classList.add('wish-added');
                        el.textContent = '♥ Wishlist';
                    } else {
                        el.classList.remove('wish-added');
                        el.textContent = '♡ Wishlist';
                    }
                };
                const wishlist = JSON.parse(localStorage.getItem('wishlist') || '[]');
                const pid = btn.getAttribute('data-id');
                if (wishlist.find(w => ('' + w.id) === ('' + pid))) {
                    setState(btn, true);
                }

                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    const id = this.getAttribute('data-id') || (new Date().getTime() + '');
                    const title = this.getAttribute('data-title') || '';
                    const brand = this.getAttribute('data-brand') || '';
                    const price = parseFloat(this.getAttribute('data-price') || 0);
                    const image = this.getAttribute('data-image') ? toStaticUrl(this.getAttribute('data-image')) : '';
                    let list = JSON.parse(localStorage.getItem('wishlist') || '[]') || [];
                    const existingIndex = list.findIndex(i => ('' + i.id) === ('' + id));
                    if (existingIndex >= 0) {
                        list.splice(existingIndex, 1);
                        localStorage.setItem('wishlist', JSON.stringify(list));
                        setState(this, false);
                    } else {
                        list.push({ id, title, brand, price, image });
                        localStorage.setItem('wishlist', JSON.stringify(list));
                        setState(this, true);
                    }
                });
            });

            updateCartBadge();
        })
        .catch(err => {
            console.warn('Error loading products:', err);
        });

    const openCheckoutBtn = document.getElementById('openCheckoutFromCart');
    if (openCheckoutBtn) {
        openCheckoutBtn.addEventListener('click', function (e) {
            const href = openCheckoutBtn.getAttribute('href');
            if (href && href !== '#' && href.trim() !== '') {
                return;
            }
            e.preventDefault();
            const cartBg = document.getElementById('cartModalBg');
            if (cartBg) cartBg.style.display = 'none';
            const checkoutBg = document.getElementById('checkoutModalBg');
            if (checkoutBg) checkoutBg.style.display = 'flex';
            try { updatePaymentButtonsStateCheckout(); } catch (e) { /* ignore */ }
        });
    }
    const overlayClose = document.getElementById('overlayCloseBtn');
    if (overlayClose) overlayClose.addEventListener('click', function () {
        const overlay = document.getElementById('productDetailOverlay');
        if (overlay) overlay.style.display = 'none';
    });

    // attach listener to payment select to toggle button states
    const paymentSelectEl = document.getElementById('paymentSelect');
    if (paymentSelectEl) {
        paymentSelectEl.addEventListener('change', function () {
            try { updatePaymentButtonsStateCheckout(); } catch (e) { /* ignore */ }
        });
    }

    // ensure initial disabled/enabled state
    try { updatePaymentButtonsStateCheckout(); } catch (e) { /* ignore */ }
});

/* Global discount initialization */
(async function initDiscountGlobal() {
    window.checkoutDiscountPercent = await fetchDiscountPercent();
})();

/* Payment button state helpers */
function setButtonState(btn, enabled, reason) {
    if (!btn) return;
    btn.disabled = !enabled;
    if (enabled) {
        btn.classList.remove('btn-disabled');
        btn.classList.add('btn-active');
        btn.setAttribute('aria-disabled', 'false');
        btn.tabIndex = 0;
        btn.removeAttribute('title');
    } else {
        btn.classList.remove('btn-active');
        btn.classList.add('btn-disabled');
        btn.setAttribute('aria-disabled', 'true');
        btn.tabIndex = -1;
        if (reason) btn.setAttribute('title', reason);
    }
}

function updatePaymentButtonsStateCheckout() {
    const cartLocal = JSON.parse(localStorage.getItem('cart') || "[]");
    const cartEmpty = !cartLocal || !cartLocal.length;
    const paymentEl = document.getElementById('paymentSelect');
    const placeBtn = document.getElementById('checkoutBtn');
    const buyBtn = document.getElementById('buyNowBtn');
    const hint = document.getElementById('orderMsg');

    if (!placeBtn || !buyBtn) return;

    if (cartEmpty) {
        setButtonState(placeBtn, false, 'Cart is empty');
        setButtonState(buyBtn, false, 'Cart is empty');
        if (hint) hint.innerText = 'Your cart is empty.';
        return;
    }

    const payment = paymentEl ? (paymentEl.value || '').trim() : 'Cash on Delivery';

    if (/cash/i.test(payment)) {
        // Cash on Delivery selected
        setButtonState(placeBtn, true);
        setButtonState(buyBtn, false, 'Buy Now requires card payment (Visa/Mastercard).');
        if (hint) hint.innerText = 'Cash on Delivery selected — use "Place Order".';
    } else {
        // Card selected (Visa/Mastercard)
        setButtonState(placeBtn, false, 'Place Order is disabled for card payments.');
        setButtonState(buyBtn, true);
        if (hint) hint.innerText = `${payment} selected — use "Buy Now" to pay with card.`;
    }
}