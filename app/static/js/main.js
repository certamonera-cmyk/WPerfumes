// app/static/js/main.js
// Full, copy-paste-ready main JavaScript for WPerfumes
// - Maintains homepage, cart and checkout UI behavior
// - Uses paypalIntegration (app/static/js/paypal.js) when available and
//   includes idempotent safeRenderPayPal to avoid duplicate PayPal buttons/icons
// - Lazy-loads FX rates, handles cart/localStorage, promo codes, and checkout flows

const API = "/api";

const SECTIONS = {
    signature: "Our Signature Perfumes",
    men: "Men's Brands",
    women: "Women's Brands",
    offers: "Hot Offers"
};

let fxRateGBPtoUSD = null;
const FX_CACHE_KEY = 'fx_gbp_usd';
const FX_TTL_MS = 60 * 60 * 1000;

async function fetchFXRateGBPtoUSD() {
    try {
        const raw = localStorage.getItem(FX_CACHE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.rate && parsed.ts && (Date.now() - parsed.ts < FX_TTL_MS)) {
                fxRateGBPtoUSD = parsed.rate;
                return fxRateGBPtoUSD;
            }
        }
        const res = await fetch('https://api.exchangerate.host/latest?base=GBP&symbols=USD');
        if (!res.ok) throw new Error(`FX fetch failed: ${res.status}`);
        const js = await res.json();
        const rate = Number(js?.rates?.USD || 0);
        if (rate && rate > 0) {
            fxRateGBPtoUSD = rate;
            localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ rate, ts: Date.now() }));
            return rate;
        } else {
            throw new Error('Invalid rate from FX provider');
        }
    } catch (err) {
        try {
            const raw = localStorage.getItem(FX_CACHE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.rate) {
                    fxRateGBPtoUSD = parsed.rate;
                    return fxRateGBPtoUSD;
                }
            }
        } catch (e) { }
        if (!fxRateGBPtoUSD) fxRateGBPtoUSD = 1.25;
        return fxRateGBPtoUSD;
    }
}

function formatCurrency(value, currency = 'GBP') {
    const n = Number(value) || 0;
    if (currency === 'GBP') {
        try {
            return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);
        } catch (e) {
            return `£${Math.round(n)}`;
        }
    } else if (currency === 'USD') {
        const rate = fxRateGBPtoUSD || 1.25;
        const converted = n * rate;
        try {
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(converted);
        } catch (e) {
            return `$${Math.round(converted)}`;
        }
    }
    return String(n);
}

function roundInteger(value) {
    return Math.round(Number(value) || 0);
}
function formatPriceInteger(value) {
    return formatCurrency(value, 'GBP');
}

let cart = JSON.parse(localStorage.getItem('cart') || '[]');
let appliedPromo = null;
let promoDiscountValue = 0;
let promoDiscountType = null;
let checkoutDiscountPercent = 0;

function setButtonState(btn, enabled, opts = {}) {
    if (!btn) return;
    btn.disabled = !enabled;
    const reason = opts.reason || '';
    btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    if (!enabled && reason) btn.setAttribute('title', reason);
    else btn.removeAttribute('title');

    btn.classList.remove('btn-active', 'btn-disabled');
    if (enabled) {
        btn.classList.add('btn-active');
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        if (opts.activeBg) btn.style.background = opts.activeBg;
        if (opts.activeTextColor) btn.style.color = opts.activeTextColor;
    } else {
        btn.classList.add('btn-disabled');
        btn.style.opacity = '0.6';
        btn.style.cursor = 'not-allowed';
        if (opts.disabledBg) btn.style.background = opts.disabledBg;
        if (opts.disabledTextColor) btn.style.color = opts.disabledTextColor;
    }
}

async function fetchAndDisplayDiscountInfo() {
    let percent = 0;
    try {
        const r = await fetch(`${API}/settings/checkout_discount`);
        if (r.ok) {
            const js = await r.json().catch(() => ({}));
            percent = parseFloat(js.percent) || 0;
        } else {
            percent = 0;
        }
    } catch (err) {
        percent = 0;
        console.warn('fetchAndDisplayDiscountInfo error', err);
    }
    checkoutDiscountPercent = percent;
    await fetchFXRateGBPtoUSD();

    const cartDiscDiv = document.getElementById('cartDiscountInfo');
    if (cartDiscDiv) {
        if (percent > 0) {
            cartDiscDiv.style.display = "block";
            cartDiscDiv.innerHTML = `<span>🌟 <b>Special Offer:</b> <span style="color:#27ae60">${percent}% OFF</span> applied automatically at checkout!</span>`;
        } else {
            cartDiscDiv.style.display = "none";
            cartDiscDiv.innerHTML = "";
        }
    }

    const checkoutDiscDiv = document.getElementById('checkoutDiscountInfo') || document.getElementById('modalDiscountInfo') || document.getElementById('discountPercentInfo');
    if (checkoutDiscDiv) {
        if (percent > 0) {
            checkoutDiscDiv.style.display = "block";
            checkoutDiscDiv.innerHTML = `<span>🌟 <b>Special Offer:</b> <span style="color:#27ae60">${percent}% OFF</span> applied automatically at checkout!</span>`;
        } else {
            checkoutDiscDiv.style.display = "none";
            checkoutDiscDiv.innerHTML = "";
        }
    }

    const blinkingOfferDiv = document.getElementById('blinking-offer');
    if (blinkingOfferDiv) {
        if (percent > 0) {
            blinkingOfferDiv.style.display = 'block';
            blinkingOfferDiv.innerHTML =
                `🌟 <b>Special Offer:</b> <span style="color:#27ae60">${percent}% OFF</span> applied automatically at checkout & in your cart!`;
            blinkingOfferDiv.classList.add('promo-visible');
        } else {
            blinkingOfferDiv.style.display = 'none';
            blinkingOfferDiv.innerHTML = '';
            blinkingOfferDiv.classList.remove('promo-visible');
        }
    }
}

function showOrderConfirmation(total) {
    const el = document.getElementById('orderConfirmationMsg') || document.getElementById('orderConfirmationMsg');
    if (el) {
        el.innerHTML = `
        <div class="success-msg" style="margin-bottom:8px;">
            Your Order has been received. Please check your Email.
        </div>
        <div class="order-total-msg" style="color:#27ae60;font-size:1.05em;">
            Total is ${formatCurrency(total, 'GBP')} (${formatCurrency(total, 'USD')})
        </div>
    `;
        const bg = document.getElementById('orderConfirmationModalBg');
        if (bg) bg.style.display = 'flex';
    }
}
function hideOrderConfirmation() {
    const bg = document.getElementById('orderConfirmationModalBg');
    if (bg) bg.style.display = 'none';
}

function saveCart() {
    localStorage.setItem('cart', JSON.stringify(cart));
}

function findCartIndexById(id) {
    return cart.findIndex(item => item.id === id);
}

function updateCartCount() {
    const cartCountEl = document.getElementById('cartCountBadge');
    if (!cartCountEl) return;
    const totalQty = cart.reduce((sum, item) => sum + (item.qty || item.quantity || 0), 0);
    if (totalQty > 0) {
        cartCountEl.textContent = totalQty;
        cartCountEl.style.display = 'inline-flex';
    } else {
        cartCountEl.style.display = 'none';
    }
}

function addToCart(product) {
    const id = product.id || product.title;
    const idx = findCartIndexById(id);
    if (idx >= 0) {
        cart[idx].qty = (cart[idx].qty || cart[idx].quantity || 1) + 1;
    } else {
        cart.push({ ...product, id: id, qty: 1 });
    }
    saveCart();
    updateCartCount();

    if (document.getElementById('checkoutModalBg')) {
        showCheckoutModal();
    } else if (document.getElementById('cartModalBg')) {
        showCartModal();
    } else {
        window.location.href = (typeof window !== 'undefined') ? '/cart' : '';
    }
}

function showCartModal() {
    const bg = document.getElementById("cartModalBg");
    if (bg) bg.style.display = 'flex';
    fetchAndDisplayDiscountInfo();
    renderCartModal();
}
function hideCartModal() {
    const bg = document.getElementById('cartModalBg');
    if (bg) bg.style.display = 'none';
}
function renderCartModal() {
    const cartListDiv = document.getElementById('cartList');
    if (!cartListDiv) return;
    if (cart.length === 0) {
        cartListDiv.innerHTML = `<div class="cart-modal-empty">Your cart is empty.</div>`;
        const totalEl = document.getElementById('cartModalTotal');
        if (totalEl) totalEl.textContent = '';
        const cartDiscDiv = document.getElementById('cartDiscountInfo');
        if (cartDiscDiv) cartDiscDiv.style.display = "none";
        const checkoutBtn = document.getElementById('openCheckoutFromCart');
        if (checkoutBtn) setButtonState(checkoutBtn, false, { disabledBg: '#ccc', reason: 'Cart is empty' });
        return;
    }
    let html = '';
    let total = 0, discountedTotal = 0;
    for (const [idx, item] of cart.entries()) {
        const price = (item.price || 0) * (item.qty || item.quantity || 1);
        total += price;
        let discountedPrice = price;
        if (checkoutDiscountPercent > 0) {
            discountedPrice = price * (1 - checkoutDiscountPercent / 100);
        }
        discountedTotal += discountedPrice;
        const priceGBP = formatCurrency((item.price || 0) * (item.qty || item.quantity || 1), 'GBP');
        const priceUSD = formatCurrency((item.price || 0) * (item.qty || item.quantity || 1), 'USD');
        html += `
        <div class="cart-list-item" data-id="${item.id}">
            <div class="cart-list-details">
                <img class="cart-list-img" src="${item.image_url || item.image || ''}" alt="${item.title}" loading="lazy" decoding="async">
                <div>
                    <div class="cart-list-title">${item.title}</div>
                    <div class="cart-list-price">${priceGBP} <span class="small-muted" style="font-size:0.95em;margin-left:6px;">≈ ${priceUSD}</span></div>
                </div>
            </div>
            <div class="cart-qty-controls">
                <button class="cart-qty-btn" onclick="updateCartModalQuantity(${idx}, -1)">-</button>
                <span class="cart-qty-display">${item.qty || item.quantity || 1}</span>
                <button class="cart-qty-btn" onclick="updateCartModalQuantity(${idx}, 1)">+</button>
            </div>
        </div>`;
    }
    cartListDiv.innerHTML = html;
    let totalHtml = `Total: ${formatCurrency(total, 'GBP')} (${formatCurrency(total, 'USD')})`;
    if (checkoutDiscountPercent > 0) {
        totalHtml += `<br><span style="color:#27ae60;font-size:0.98em;">After Discount: ${formatCurrency(discountedTotal, 'GBP')} (${formatCurrency(discountedTotal, 'USD')}) (-${checkoutDiscountPercent}%)</span>`;
    }
    const cartTotalEl = document.getElementById('cartModalTotal');
    if (cartTotalEl) cartTotalEl.innerHTML = totalHtml;

    const checkoutBtn = document.getElementById('openCheckoutFromCart');
    if (checkoutBtn) setButtonState(checkoutBtn, true, { activeBg: '#2d8f7c', activeTextColor: '#fff' });
}

window.updateCartModalQuantity = function (idx, change) {
    if (cart[idx]) {
        const newQty = (cart[idx].qty || cart[idx].quantity || 1) + change;
        if (newQty > 0) {
            cart[idx].qty = newQty;
        } else {
            cart.splice(idx, 1);
        }
        saveCart();
        updateCartCount();
        renderCartModal();
    }
}

// New helper: safeRenderPayPal - uses paypalIntegration and guards container mounted flag
async function safeRenderPayPal(containerSelector, opts = { currency: 'USD', successUrl: '/' }) {
    try {
        const container = (typeof containerSelector === 'string') ? document.querySelector(containerSelector) : containerSelector;
        if (!container) return;
        // if already mounted skip
        if (container.getAttribute && container.getAttribute('data-paypal-mounted') === '1') return;
        if (window.paypalIntegration && typeof window.paypalIntegration.ensureSdkLoaded === 'function') {
            await window.paypalIntegration.ensureSdkLoaded();
            await window.paypalIntegration.renderPayPalButtons(containerSelector, opts);
        } else if (typeof window.renderPayPalButtons === 'function') {
            // legacy alias - render but that implementation should also guard
            window.renderPayPalButtons(containerSelector, opts);
        } else {
            // No integration available; do not attempt to load hard-coded SDK here to avoid duplicates.
            console.warn('PayPal integration not available; PayPal buttons not rendered for', containerSelector);
        }
    } catch (e) {
        console.warn('safeRenderPayPal failed', e);
    }
}

function tryRenderModalPayPal(opts = { currency: 'USD', successUrl: '/' }) {
    // Replace the older approach with the safeRenderPayPal which is idempotent
    safeRenderPayPal('#modal_paypal_button_container', opts);
}

function showCheckoutModal() {
    const bg = document.getElementById("checkoutModalBg");
    if (bg) bg.style.display = 'flex';
    fetchAndDisplayDiscountInfo();
    renderCheckoutView();
    setTimeout(() => {
        tryRenderModalPayPal({ currency: 'USD', successUrl: '/' });
    }, 220);
}
function hideCheckoutModal() {
    const bg = document.getElementById('checkoutModalBg');
    if (bg) bg.style.display = 'none';
}

function togglePaymentButtons() {
    const contexts = [
        { paymentId: 'paymentSelect', placeId: 'checkoutBtn', buyId: 'buyNowBtn' },
        { paymentId: 'modal_paymentSelect', placeId: 'modalPlaceOrderBtn', buyId: 'modalBuyNowBtn' }
    ];

    contexts.forEach(ctx => {
        const paymentEl = document.getElementById(ctx.paymentId);
        const placeBtn = document.getElementById(ctx.placeId);
        const buyBtn = document.getElementById(ctx.buyId);
        const hintEl = document.getElementById((ctx.paymentId === 'modal_paymentSelect') ? 'modalPaymentHint' : 'paymentHint') || document.getElementById('modalPaymentHint') || document.getElementById('paymentHint');

        if (!paymentEl) return;
        const payment = paymentEl.value || 'Cash on Delivery';

        if (!cart || !cart.length) {
            setButtonState(placeBtn, false, { disabledBg: '#ccc', reason: 'Cart is empty' });
            setButtonState(buyBtn, false, { disabledBg: '#ccc', reason: 'Cart is empty' });
            if (hintEl) hintEl.innerText = 'Your cart is empty.';
            return;
        }

        if (payment === 'Cash on Delivery' || payment === 'Cash on delivery') {
            setButtonState(placeBtn, true, { activeBg: '#2d8f7c', activeTextColor: '#fff' });
            setButtonState(buyBtn, false, { disabledBg: '#bdbdbd', disabledTextColor: '#fff', reason: 'Buy Now requires card payment (Visa/Mastercard).' });
            if (hintEl) hintEl.innerText = 'Cash on Delivery selected — use "Place Order".';
        } else {
            setButtonState(placeBtn, false, { disabledBg: '#bdbdbd', disabledTextColor: '#fff', reason: 'Place Order is disabled for card payments.' });
            setButtonState(buyBtn, true, { activeBg: '#4aa3ff', activeTextColor: '#fff' });
            if (hintEl) hintEl.innerText = `${payment} selected — use "Buy Now" to pay with card.`;
        }
    });
}

function getCartTotal() {
    return cart.reduce((sum, item) => sum + (item.price || 0) * (item.qty || item.quantity || 1), 0);
}

function getDiscountedTotal() {
    let total = getCartTotal();
    let discount = checkoutDiscountPercent || 0;
    if (appliedPromo && promoDiscountType && promoDiscountValue) {
        if (promoDiscountType === 'percent') {
            discount = promoDiscountValue;
            return total * (1 - (discount / 100));
        } else if (promoDiscountType === 'fixed') {
            return Math.max(0, total - promoDiscountValue);
        }
    }
    return total * (1 - (discount / 100));
}

function renderCheckoutView() {
    const cartSection = document.getElementById('cartSection');
    const paymentWrapper = document.getElementById("paymentSelectWrapper");
    const orderForm = document.getElementById("orderForm");
    const promoWrapper = document.getElementById("promoWrapper");

    if (!cartSection) return;

    if (!cart.length) {
        cartSection.innerHTML = '<div class="cart-empty">Your cart is empty.</div>';
        if (orderForm) orderForm.style.display = "none";
        if (paymentWrapper) paymentWrapper.style.display = "none";
        if (promoWrapper) promoWrapper.style.display = "none";
        const checkoutDiscDiv = document.getElementById('checkoutDiscountInfo');
        if (checkoutDiscDiv) checkoutDiscDiv.style.display = "none";
        togglePaymentButtons();
        return;
    }

    let html = `<table>
        <thead>
            <tr>
                <th>Product</th>
                <th style="width:120px;">Qty</th>
                <th>Price</th>
                <th>Remove</th>
            </tr>
        </thead>
        <tbody>
        ${cart.map((item, idx) => `
        <tr>
            <td>${item.title}</td>
            <td style="display:flex; align-items:center; gap:5px; padding-top: 10px; padding-bottom: 10px;">
                <button type="button" onclick="updateCheckoutQuantity(${idx}, -1)" class="qty-control-btn">-</button>
                <span style="min-width: 20px; text-align: center;">${item.qty || item.quantity || 1}</span>
                <button type="button" onclick="updateCheckoutQuantity(${idx}, 1)" class="qty-control-btn">+</button>
            </td>
            <td>${formatCurrency((item.price || 0) * (item.qty || item.quantity || 1), 'GBP')} <span class="small-muted" style="margin-left:6px;">≈ ${formatCurrency((item.price || 0) * (item.qty || item.quantity || 1), 'USD')}</span></td>
            <td>
                <button type="button" onclick="removeCheckoutItem(${idx})" 
                        style="background:#e74c3c;padding:2px 9px;border-radius:4px; font-weight: bold; width: 30px; height: 30px; line-height: 1;">✕</button>
            </td>
        </tr>`).join('')}
        </tbody>
        <tfoot>
            <tr>
                <td colspan="3" class="total">Total:</td>
                <td class="total">${formatCurrency(getCartTotal(), 'GBP')} (${formatCurrency(getCartTotal(), 'USD')})</td>
            </tr>
            ${(checkoutDiscountPercent || (appliedPromo && promoDiscountType && promoDiscountValue)) ? `
            <tr>
                <td colspan="3" class="total" style="color:#27ae60;">${appliedPromo ? `Promo (${appliedPromo})` : 'Discount'}:</td>
                <td class="total" style="color:#27ae60;">
                    -${formatCurrency(getCartTotal() - getDiscountedTotal(), 'GBP')} (${formatCurrency(getCartTotal() - getDiscountedTotal(), 'USD')})
                </td>
            </tr>
            <tr>
                <td colspan="3" class="total">Total after Discount:</td>
                <td class="total"><b>${formatCurrency(getDiscountedTotal(), 'GBP')} (${formatCurrency(getDiscountedTotal(), 'USD')})</b></td>
            </tr>` : ''}
        </tfoot>
    </table>`;

    cartSection.innerHTML = html;
    if (paymentWrapper) paymentWrapper.style.display = "block";
    if (promoWrapper) promoWrapper.style.display = "block";
    if (orderForm) orderForm.style.display = "block";

    togglePaymentButtons();
}

window.removeCheckoutItem = function (idx) {
    cart.splice(idx, 1);
    saveCart();
    updateCartCount();
    renderCheckoutView();
};

window.updateCheckoutQuantity = function (idx, change) {
    if (cart[idx]) {
        const newQuantity = (cart[idx].qty || cart[idx].quantity || 1) + change;
        if (newQuantity > 0) {
            cart[idx].qty = newQuantity;
        } else {
            cart.splice(idx, 1);
        }
        saveCart();
        updateCartCount();
        renderCheckoutView();
    }
};

async function logOrderAttempt(item, status = "Carted") {
    const emailEl = document.getElementById("email");
    const email = emailEl ? emailEl.value : "";
    try {
        await fetch(`${API}/order-attempts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, product: item.title, qty: item.qty || item.quantity || 1, status })
        });
    } catch (error) { /* ignore */ }
}

// Homepage/rendering: include lazy loading and decoding hints
function createSignatureSection(products) {
    let html = `<section id="signature">
        <div class="section-heading-row signature">
            <h3 class="signature">Our Signature Perfumes</h3>
        </div>
        <hr class="section-divider">
        <div class="card-section-wrapper">
            <div class="card-container">`;
    if (!products || products.length === 0) {
        html += `<div style="padding:20px;color:#aaa;">No products available yet.</div>`;
    } else {
        for (const p of products) {
            const productObj = { ...p, id: p.id || p._id || p.title };
            html += `
            <div class="product-card" role="button" tabindex="0">
                <div class="card-image-wrapper">
                    <img src="${p.image_url || window.PLACEHOLDER_IMG}" alt="${p.title}" class="product-image" loading="lazy" decoding="async" width="400" height="400">
                </div>
                <div class="card-details">
                    <div class="card-name">${p.title}</div>
                    <small>${formatCurrency(p.price || 0, 'GBP')}</small>
                </div>
                <button class="add-cart-btn" data-product='${JSON.stringify(productObj)}' aria-label="Buy Now">Buy Now</button>
            </div>`;
        }
    }
    html += `</div></div></section>`;
    return html;
}

function createSection(sectionKey, products) {
    if (sectionKey === 'signature') {
        return createSignatureSection(products);
    }
    const headingRowClass = sectionKey === 'signature' ? 'section-heading-row signature' : 'section-heading-row';
    let html = `<section id="${sectionKey}">
        <div class="${headingRowClass}">
            <h3 class="${sectionKey === 'signature' ? 'signature' : ''}">${SECTIONS[sectionKey]}</h3>
        </div>
        <hr class="section-divider">
        <div class="card-section-wrapper">
            <div class="card-container">`;
    if (!products || products.length === 0) {
        html += `<div style="padding:20px;color:#aaa;">No products available yet.</div>`;
    } else {
        for (const p of products) {
            const productObj = { ...p, id: p.id || p._id || p.title };
            html += `
            <div class="product-card" role="button" tabindex="0">
                <div class="card-image-wrapper">
                    <img src="${p.image_url || window.PLACEHOLDER_IMG}" alt="${p.title}" class="product-image" loading="lazy" decoding="async" width="400" height="400">
                </div>
                <div class="card-details">
                    <div class="card-name">${p.title}</div>
                    <small>${formatCurrency(p.price || 0, 'GBP')}</small>
                </div>
                <button class="add-cart-btn" data-product='${JSON.stringify(productObj)}' aria-label="Buy Now">Buy Now</button>
            </div>`;
        }
    }
    html += `</div></div></section>`;
    return html;
}

async function loadHomepageSections() {
    try {
        const res = await fetch(`${API}/homepage-products`);
        if (!res.ok) {
            console.warn('loadHomepageSections: failed to fetch homepage products');
            return;
        }
        const data = await res.json();
        let html = '';
        for (const key of Object.keys(SECTIONS)) {
            html += createSection(key, data[key] || []);
        }
        const containerEl = document.getElementById("homepage-sections");
        if (containerEl) containerEl.innerHTML = html;

        const sigSection = document.getElementById("signature");
        if (!sigSection) return;
        const container = sigSection.querySelector(".card-container");
        if (!container) return;

        container.style.animation = "none";

        function getScrollDistance() {
            const parentWidth = sigSection.querySelector(".card-section-wrapper").offsetWidth;
            const cardsWidth = container.scrollWidth;
            if (cardsWidth <= parentWidth) return 0;
            return cardsWidth - parentWidth;
        }

        let direction = 1, pos = 0, scrollDist = getScrollDistance(), speed = 0.8, rafId = null;

        function animate() {
            scrollDist = getScrollDistance();
            if (scrollDist <= 0) {
                container.style.transform = "translateX(0)";
                return;
            }
            pos += speed * direction;
            if (pos >= scrollDist) { pos = scrollDist; direction = -1; }
            else if (pos <= 0) { pos = 0; direction = 1; }
            container.style.transform = `translateX(${-pos}px)`;
            rafId = requestAnimationFrame(animate);
        }

        function startAnim() {
            if (rafId) cancelAnimationFrame(rafId);
            pos = 0;
            direction = 1;
            container.style.transform = "translateX(0)";
            scrollDist = getScrollDistance();
            if (scrollDist > 0 && window.matchMedia('(prefers-reduced-motion: no-preference)').matches) rafId = requestAnimationFrame(animate);
        }
        startAnim();
        container.addEventListener("mouseenter", () => { if (rafId) cancelAnimationFrame(rafId); });
        container.addEventListener("mouseleave", () => { rafId = requestAnimationFrame(animate); });
        window.addEventListener("resize", startAnim);

        document.querySelectorAll('.add-cart-btn').forEach(btn => {
            btn.onclick = function (e) {
                e.stopPropagation();
                const product = JSON.parse(this.getAttribute('data-product'));
                addToCart(product);
            };
        });

        attachProductCardListeners();
    } catch (err) {
        console.warn('loadHomepageSections error', err);
    }
}

function getProductDetailApiUrl(brand, title) {
    const apiBrand = encodeURIComponent(brand.replace(/ /g, "_"));
    const apiProduct = encodeURIComponent(title.replace(/ /g, "_"));
    return `${API}/products/${apiBrand}/${apiProduct}`;
}

function showProductDetailOverlay(card, brand, title) {
    const overlay = document.getElementById('productDetailOverlay');
    const overlayContent = document.getElementById('overlayContent');
    if (!overlay || !overlayContent) return;
    overlay.style.display = "block";
    overlay.style.left = (card.getBoundingClientRect().left + window.scrollX + card.offsetWidth + 8) + "px";
    overlay.style.top = (card.getBoundingClientRect().top + window.scrollY - 10) + "px";
    overlayContent.innerHTML = "Loading...";
    fetch(getProductDetailApiUrl(brand, title))
        .then(res => res.json())
        .then(product => {
            overlayContent.innerHTML = `
                <img src="${product.image_url || window.DEFAULT_PRODUCT_IMG}" alt="${product.title}" loading="lazy" decoding="async" width="150" height="150" />
                <h2>${product.title}</h2>
                <div class="overlay-brand">${product.brand}</div>
                <div class="overlay-price">${formatCurrency(product.price || 0, 'GBP')}</div>
                <div class="overlay-desc">${product.description || ''}</div>
                <div class="overlay-notes"><b>Key Notes:</b> ${Array.isArray(product.keyNotes) ? product.keyNotes.join(', ') : (product.keyNotes || '')}</div>
                <div class="overlay-tags"><b>Tags:</b> ${product.tags || 'None'}</div>
            `;
        })
        .catch(err => {
            overlayContent.innerHTML = '<div style="color:#c00;">Failed to load product details.</div>';
            console.warn('showProductDetailOverlay error', err);
        });
}

function hideProductDetailOverlay() {
    const overlay = document.getElementById('productDetailOverlay');
    if (overlay) overlay.style.display = 'none';
}

function attachProductCardListeners() {
    document.querySelectorAll('.product-card').forEach(card => {
        let productData = null;
        const btn = card.querySelector('.add-cart-btn');
        if (btn) {
            try { productData = JSON.parse(btn.getAttribute('data-product')); } catch (e) { productData = null; }
        }
        let brand = productData?.brand || '';
        let title = productData?.title || productData?.name || '';
        let productId = productData?.id || productData?._id || '';

        card.addEventListener('click', function (e) {
            if (e.target && e.target.classList && e.target.classList.contains('add-cart-btn')) return;
            if (brand && title) {
                const brandParam = encodeURIComponent(String(brand).replace(/\s+/g, '_'));
                const productSlug = encodeURIComponent(String(title).replace(/\s+/g, '_'));
                const idPart = productId ? `&product_id=${encodeURIComponent(productId)}` : '';
                window.location.href = `/brand_detail?brand=${brandParam}&product=${productSlug}${idPart}`;
            }
        });

        card.addEventListener('mouseenter', function () {
            if (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) return;
            if (brand && title) showProductDetailOverlay(card, brand, title);
        });
        card.addEventListener('mouseleave', hideProductDetailOverlay);

        card.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                card.click();
            }
        });
    });
}

document.getElementById && document.getElementById('overlayCloseBtn') && (document.getElementById('overlayCloseBtn').onclick = hideProductDetailOverlay);

document.addEventListener('DOMContentLoaded', function () {
    const cartBtn = document.getElementById('cartBtn');
    const cartModalClose = document.getElementById('cartModalCloseBtn');
    const cartModalBg = document.getElementById('cartModalBg');

    if (cartBtn) cartBtn.addEventListener('click', (e) => {
        const modalExists = !!document.getElementById('cartModalBg');
        if (modalExists) {
            e.preventDefault();
            showCartModal();
        }
    });
    if (cartModalClose) cartModalClose.addEventListener('click', hideCartModal);
    if (cartModalBg) cartModalBg.addEventListener('click', (e) => { if (e.target === e.currentTarget) hideCartModal(); });

    const checkoutClose = document.getElementById('checkoutModalCloseBtn');
    const checkoutBg = document.getElementById('checkoutModalBg');
    const paymentSelect = document.getElementById('paymentSelect');
    if (checkoutClose) checkoutClose.addEventListener('click', hideCheckoutModal);
    if (checkoutBg) checkoutBg.addEventListener('click', (e) => { if (e.target === e.currentTarget) hideCheckoutModal(); });
    if (paymentSelect) paymentSelect.addEventListener('change', togglePaymentButtons);

    const modalPaymentSelect = document.getElementById('modal_paymentSelect');
    if (modalPaymentSelect) modalPaymentSelect.addEventListener('change', togglePaymentButtons);

    const applyPromoBtn = document.getElementById('applyPromoBtn');
    if (applyPromoBtn) {
        applyPromoBtn.onclick = async function () {
            const codeEl = document.getElementById('promoInput');
            const msgDiv = document.getElementById('promoMsg');
            const code = codeEl ? codeEl.value.trim() : '';
            if (msgDiv) msgDiv.textContent = '';
            if (!code) {
                if (msgDiv) msgDiv.textContent = 'Please enter a promo code.';
                return;
            }
            if (msgDiv) msgDiv.textContent = 'Checking...';
            try {
                const res = await fetch(`${API}/coupons`);
                if (!res.ok) throw new Error('Failed to fetch coupons');
                const promos = await res.json();
                const today = new Date().toISOString().slice(0, 10);
                const found = promos.find(p =>
                    p.code.toLowerCase() === code.toLowerCase() &&
                    p.active &&
                    (!p.start_date || p.start_date <= today) &&
                    (!p.end_date || p.end_date >= today)
                );
                if (!found) {
                    appliedPromo = null;
                    promoDiscountValue = 0;
                    promoDiscountType = null;
                    if (msgDiv) msgDiv.textContent = "Invalid or expired promo code.";
                    renderCheckoutView();
                } else {
                    appliedPromo = found.code;
                    promoDiscountType = found.discount_type;
                    promoDiscountValue = found.discount_value;
                    if (msgDiv) msgDiv.textContent = `Promo applied: ${found.description} (${found.discount_type === 'percent' ? found.discount_value + '%' : '$' + found.discount_value} off)`;
                    renderCheckoutView();
                }
            } catch (err) {
                if (msgDiv) msgDiv.textContent = "Error checking promo code.";
                console.warn('applyPromoBtn error', err);
            }
        };
    }

    const orderForm = document.getElementById('orderForm');
    if (orderForm) {
        orderForm.onsubmit = async function (e) {
            e.preventDefault();
            if (!cart.length) return;
            const customer = (document.getElementById('customer') || {}).value || '';
            const email = (document.getElementById('email') || {}).value || '';
            const phone = (document.getElementById('phone') || {}).value || '';
            const address = (document.getElementById('address') || {}).value || '';
            const payment_method = (document.getElementById('paymentSelect') || {}).value || '';
            let anyFailed = false;
            let msgDiv = document.getElementById('orderMsg');
            if (msgDiv) msgDiv.innerHTML = "";

            const checkoutBtn = document.getElementById('checkoutBtn');
            const buyNowBtn = document.getElementById('buyNowBtn');
            if (checkoutBtn) setButtonState(checkoutBtn, false, { disabledBg: '#ccc' });
            if (buyNowBtn) setButtonState(buyNowBtn, false, { disabledBg: '#ccc' });

            for (const item of cart) {
                await logOrderAttempt(item, "CheckedOut");
                try {
                    const res = await fetch(`${API}/orders`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            customer_name: customer,
                            customer_email: email,
                            customer_phone: phone,
                            customer_address: address,
                            product_id: item.id || item.product_id || '',
                            product_title: item.title || item.name || '',
                            quantity: item.qty || item.quantity || 1,
                            status: "Pending",
                            payment_method,
                            promo_code: appliedPromo || undefined,
                            date: new Date().toISOString().slice(0, 19).replace('T', ' ')
                        })
                    });

                    if (!res.ok) {
                        // Read server response to surface details for debugging
                        let errText = "";
                        try {
                            const js = await res.json().catch(() => null);
                            if (js && typeof js === 'object') {
                                // prefer detailed fields if present
                                if (js.detail) errText = typeof js.detail === 'string' ? js.detail : JSON.stringify(js.detail);
                                else errText = JSON.stringify(js);
                            } else {
                                errText = await res.text().catch(() => res.statusText || `HTTP ${res.status}`);
                            }
                        } catch (readErr) {
                            errText = res.statusText || `HTTP ${res.status}`;
                        }
                        throw new Error(`Order placement failed: ${res.status} ${errText}`);
                    }
                } catch (error) {
                    anyFailed = true;
                    if (msgDiv) {
                        // include server-provided details when available
                        msgDiv.innerHTML += `<div class="error-msg">Network error: Failed to place order for ${item.title}.<br><small style="color:#666">${(error && error.message) ? error.message : ''}</small></div>`;
                    }
                    console.warn('order submission error', error);
                }
            }

            if (!anyFailed) {
                const orderTotal = getDiscountedTotal();
                hideCheckoutModal();
                showOrderConfirmation(orderTotal);

                setTimeout(() => {
                    cart = [];
                    appliedPromo = null;
                    promoDiscountValue = 0;
                    promoDiscountType = null;
                    saveCart();
                    renderCartModal();
                    updateCartCount();
                    if (orderForm) orderForm.reset();
                    const promoInput = document.getElementById('promoInput');
                    if (promoInput) promoInput.value = '';
                    const promoMsg = document.getElementById('promoMsg');
                    if (promoMsg) promoMsg.textContent = '';
                    hideOrderConfirmation();
                }, 3000);
            } else {
                togglePaymentButtons();
            }
        };
    }

    const buyNowBtn = document.getElementById('buyNowBtn');
    if (buyNowBtn) {
        buyNowBtn.addEventListener('click', async function () {
            const customer = {};
            const custEl = document.getElementById('customer');
            const emailEl = document.getElementById('email');
            const phoneEl = document.getElementById('phone');
            const addressEl = document.getElementById('address');
            if (custEl) customer.name = custEl.value || '';
            if (emailEl) customer.email = emailEl.value || '';
            if (phoneEl) customer.phone = phoneEl.value || '';
            if (addressEl) customer.address = addressEl.value || '';

            try { localStorage.setItem('paypal_customer', JSON.stringify(customer)); } catch (e) { }

            const itemsForServer = cart.map(i => ({
                id: i.id || i.product_id || '',
                title: i.title || i.name || '',
                unit_price: Number(i.price || 0),
                quantity: Number(i.qty || i.quantity || 1),
                currency: 'USD'
            }));
            try { localStorage.setItem('paypal_items', JSON.stringify(itemsForServer)); } catch (e) { }

            // Prefer paypalIntegration API (defined in static/js/paypal.js). If not present, fallback.
            if (window.paypalIntegration && typeof window.paypalIntegration.initiateCardCheckout === 'function') {
                try {
                    await window.paypalIntegration.initiateCardCheckout(itemsForServer, { currency: 'USD', returnUrl: window.location.origin + '/paypal/return' });
                    // If redirect occurs, code below won't run.
                } catch (err) {
                    console.error('Buy Now (card) initiation failed', err);
                    const orderMsg = document.getElementById('orderMsg');
                    const detail = (err && err.message) ? err.message : String(err);
                    if (orderMsg) {
                        if (detail.toLowerCase().includes('401') || detail.toLowerCase().includes('unauthorized')) {
                            orderMsg.innerHTML = `<div style="color:#e74c3c;font-weight:700;">Payment provider credentials appear missing or invalid on the server.</div>
                            <div style="color:#666;margin-top:8px;">Please ensure PAYPAL_CLIENT_ID and PAYPAL_SECRET are set as environment variables on the server (use sandbox values for development), and restart the application.</div>
                            <div style="color:#666;margin-top:8px;font-size:0.9em;">Server error details: ${detail}</div>`;
                        } else {
                            orderMsg.innerHTML = `<div style="color:#e74c3c;font-weight:700;">Failed to initiate payment. ${detail}</div>`;
                        }
                    }
                    togglePaymentButtons();
                }
            } else if (typeof window.initiateCardCheckout === 'function') {
                // legacy alias
                try {
                    await window.initiateCardCheckout(itemsForServer, { currency: 'USD', returnUrl: window.location.origin + '/paypal/return' });
                } catch (err) {
                    console.error('Buy Now (legacy) initiation failed', err);
                    const orderMsg = document.getElementById('orderMsg');
                    if (orderMsg) orderMsg.innerHTML = '<div style="color:#e74c3c;">Failed to initiate payment. Please try again.</div>';
                    togglePaymentButtons();
                }
            } else {
                // No PayPal integration available: fallback to local order-confirmation flow
                const orderTotal = getDiscountedTotal();
                hideCheckoutModal();
                showOrderConfirmation(orderTotal);
                setTimeout(() => {
                    cart = [];
                    appliedPromo = null;
                    promoDiscountValue = 0;
                    promoDiscountType = null;
                    saveCart();
                    renderCartModal();
                    updateCartCount();
                    if (orderForm) orderForm.reset();
                    const promoInput = document.getElementById('promoInput');
                    if (promoInput) promoInput.value = '';
                    const promoMsg = document.getElementById('promoMsg');
                    if (promoMsg) promoMsg.textContent = '';
                    hideOrderConfirmation();
                }, 3000);
            }
        });
    }

    const modalBuyNow = document.getElementById('modalBuyNowBtn');
    if (modalBuyNow) {
        modalBuyNow.addEventListener('click', async function () {
            const customer = {};
            const custEl = document.getElementById('modal_customer');
            const emailEl = document.getElementById('modal_email');
            const phoneEl = document.getElementById('modal_phone');
            const addressEl = document.getElementById('modal_address');
            if (custEl) customer.name = custEl.value || '';
            if (emailEl) customer.email = emailEl.value || '';
            if (phoneEl) customer.phone = phoneEl.value || '';
            if (addressEl) customer.address = addressEl.value || '';

            try { localStorage.setItem('paypal_customer', JSON.stringify(customer)); } catch (e) { }

            const cartLocal = JSON.parse(localStorage.getItem('cart') || "[]");
            const itemsForServer = cartLocal.map(i => ({
                id: i.id || i.product_id || '',
                title: i.title || i.name || '',
                unit_price: Number(i.price || 0),
                quantity: Number(i.qty || i.quantity || 1),
                currency: 'USD'
            }));
            try { localStorage.setItem('paypal_items', JSON.stringify(itemsForServer)); } catch (e) { }

            if (window.paypalIntegration && typeof window.paypalIntegration.initiateCardCheckout === 'function') {
                try {
                    await window.paypalIntegration.initiateCardCheckout(itemsForServer, { currency: 'USD', returnUrl: window.location.origin + '/paypal/return' });
                } catch (err) {
                    console.error('Modal Buy Now (card) initiation failed', err);
                    const orderMsg = document.getElementById('modalOrderMsg');
                    const detail = (err && err.message) ? err.message : String(err);
                    if (orderMsg) {
                        if (detail.toLowerCase().includes('401') || detail.toLowerCase().includes('unauthorized')) {
                            orderMsg.innerHTML = `<div style="color:#e74c3c;font-weight:700;">Payment provider credentials appear missing or invalid on the server.</div>
                            <div style="color:#666;margin-top:8px;">Please ensure PAYPAL_CLIENT_ID and PAYPAL_SECRET are set as environment variables on the server (use sandbox values for development), and restart the application.</div>
                            <div style="color:#666;margin-top:8px;font-size:0.9em;">Server error details: ${detail}</div>`;
                        } else {
                            orderMsg.innerHTML = `<div style="color:#e74c3c;font-weight:700;">Failed to start card (PayPal) checkout.</div><div style="color:#666;margin-top:8px;font-size:0.9em;">${detail}</div>`;
                        }
                    }
                    updateModalPaymentButtonsState();
                }
            } else if (typeof window.initiateCardCheckout === 'function') {
                try {
                    await window.initiateCardCheckout(itemsForServer, { currency: 'USD', returnUrl: window.location.origin + '/paypal/return' });
                } catch (err) {
                    console.error('Modal Buy Now (legacy) initiation failed', err);
                    const orderMsg = document.getElementById('modalOrderMsg');
                    if (orderMsg) orderMsg.innerHTML = '<div style="color:#e74c3c;">Failed to initiate payment. Please try again.</div>';
                    updateModalPaymentButtonsState();
                }
            } else {
                // fallback: local confirmation if PayPal not available
                const orderTotal = getDiscountedTotal();
                const modalOrderForm = document.getElementById('modalOrderForm');
                if (modalOrderForm) modalOrderForm.reset();
                hideCheckoutModal();
                showOrderConfirmation(orderTotal);
                setTimeout(() => {
                    cart = [];
                    appliedPromo = null;
                    promoDiscountValue = 0;
                    promoDiscountType = null;
                    saveCart();
                    renderCartModal();
                    updateCartCount();
                    hideOrderConfirmation();
                    const mPromo = document.getElementById('modal_promo_code');
                    if (mPromo) mPromo.value = '';
                }, 3000);
            }
        });
    }

    const orderConfirmationClose = document.getElementById('orderConfirmationModalCloseBtn');
    const orderConfirmationBg = document.getElementById('orderConfirmationModalBg');
    if (orderConfirmationClose) orderConfirmationClose.addEventListener('click', hideOrderConfirmation);
    if (orderConfirmationBg) orderConfirmationBg.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) hideOrderConfirmation();
    });

    const allPaymentSelects = document.querySelectorAll('#paymentSelect, #modal_paymentSelect, select.payment-select');
    allPaymentSelects.forEach(sel => sel.addEventListener('change', togglePaymentButtons));

    fetchAndDisplayDiscountInfo();
    setInterval(fetchAndDisplayDiscountInfo, 60000);
    loadHomepageSections();
    updateCartCount();
    togglePaymentButtons();

    fetchFXRateGBPtoUSD().then(() => {
        if (document.getElementById('cartList')) renderCartModal();
        if (document.getElementById('cartSection')) renderCheckoutView();
    });

    try {
        const heroAudio = document.getElementById('heroAudio');
        const muteBtn = document.getElementById('heroAudioMuteBtn');
        const muteIcon = document.getElementById('heroAudioMuteIcon');

        function updateMuteIcon() {
            if (!muteIcon || !heroAudio) return;
            muteIcon.textContent = heroAudio.muted ? '🔇' : '🔊';
        }

        if (muteBtn && heroAudio) {
            muteBtn.addEventListener('click', function () {
                heroAudio.muted = !heroAudio.muted;
                updateMuteIcon();
            });
            updateMuteIcon();
        }
    } catch (err) {
        console.warn('Hero audio init failed', err);
    }

    tryRenderModalPayPal({ currency: 'USD', successUrl: '/' });
});

// Compatibility aliases
if (typeof window !== 'undefined') {
    window.openCheckoutModal = window.openCheckoutModal || function () { try { showCheckoutModal(); } catch (e) { console.warn('openCheckoutModal alias failed', e); } };
    window.closeCheckoutModal = window.closeCheckoutModal || function () { try { hideCheckoutModal(); } catch (e) { console.warn('closeCheckoutModal alias failed', e); } };

    window.openCartModal = window.openCartModal || function () { try { showCartModal(); } catch (e) { console.warn('openCartModal alias failed', e); } };
    window.closeCartModal = window.closeCartModal || function () { try { hideCartModal(); } catch (e) { console.warn('closeCartModal alias failed', e); } };

    window.showCheckoutModal = window.showCheckoutModal || showCheckoutModal;
    window.hideCheckoutModal = window.hideCheckoutModal || hideCheckoutModal;
    window.showCartModal = window.showCartModal || showCartModal;
    window.hideCartModal = window.hideCartModal || hideCartModal;
    window.renderCartModal = window.renderCartModal || renderCartModal;
    window.renderCheckoutView = window.renderCheckoutView || renderCheckoutView;
    window.saveCart = window.saveCart || saveCart;
}