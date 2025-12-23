/* brand_detail.js
   Payment UI and PayPal rendering removed from this file per request.
   This file now focuses on product loading, adding items to cart and opening the shared checkout modal.
*/

document.addEventListener('DOMContentLoaded', function () {
    const API = "/api";
    const PLACEHOLDER_IMG = document.body && document.body.dataset && document.body.dataset.placeholder ? document.body.dataset.placeholder : '/static/images/placeholder.jpg';

    // Utility: normalize image paths returned by the backend
    function toStaticUrl(url) {
        if (!url) return PLACEHOLDER_IMG;
        if (typeof url !== 'string') return PLACEHOLDER_IMG;
        if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')) {
            return url;
        }
        return `/static/${url}`;
    }

    // Utility: safely read URL param
    function safeParam(name) {
        try {
            return decodeURIComponent(new URLSearchParams(window.location.search).get(name) || '');
        } catch (e) {
            return '';
        }
    }

    // Load similar products (simple approach)
    async function loadSimilarProducts(productId) {
        try {
            const res = await fetch(`${API}/products/similar?product_id=${encodeURIComponent(productId)}`);
            if (!res.ok) {
                console.warn('similar products request failed', res.status);
                return [];
            }
            return await res.json();
        } catch (err) {
            console.warn('loadSimilarProducts error', err);
            return [];
        }
    }

    // Render similar products slider
    function renderSimilarProducts(products) {
        const track = document.getElementById('sliderTrack');
        if (!track) return;
        track.innerHTML = '';
        (products || []).forEach(p => {
            const card = document.createElement('div');
            card.className = 'slider-card';
            const imgSrc = toStaticUrl(p.image_url || p.image_url_dynamic || '');
            card.innerHTML = `
                <img src="${imgSrc}" alt="${p.title}">
                <div class="slider-title">${p.title}</div>
                <div class="muted small">$${parseFloat(p.price || 0).toFixed(2)}</div>
            `;
            card.addEventListener('click', () => {
                const brandParam = encodeURIComponent((p.brand || '').replace(/\s+/g, '_'));
                const productParam = encodeURIComponent((p.title || '').replace(/\s+/g, '_'));
                window.location.href = `/brand/${brandParam}/product/${productParam}`;
            });
            track.appendChild(card);
        });
    }

    // Small helpers for JSON and fetch
    async function safeJson(res) {
        try {
            return await res.json();
        } catch (e) {
            return null;
        }
    }
    async function apiFetch(path, opts = {}) {
        const options = Object.assign({ credentials: 'same-origin' }, opts);
        const res = await fetch(path, options);
        return res;
    }

    // Keep reference to loaded product so buy-now can add it to cart
    window.currentProduct = null;

    // Local cart helpers (used by modal)
    function getCart() { return JSON.parse(localStorage.getItem('cart') || '[]'); }
    function saveCart(c) { localStorage.setItem('cart', JSON.stringify(c)); }

    function addProductObjectToCart(prod, qty = 1) {
        if (!prod) return;
        const id = prod.id || prod.product_id || prod._id || prod.title || (new Date().getTime());
        const title = prod.title || prod.name || (document.getElementById('productName') ? document.getElementById('productName').textContent : 'Product');
        const brand = prod.brand || (document.getElementById('brandName') ? document.getElementById('brandName').textContent : '');
        const price = Number(prod.price || prod.unit_price || prod.amount || 0);
        const image = prod.image || prod.image_url || (document.getElementById('productImage') ? document.getElementById('productImage').src : '');

        let cart = getCart();
        const existing = cart.find(i => ('' + i.id) === ('' + id));
        if (existing) {
            existing.quantity = (existing.quantity || 0) + qty;
            // update price/image/title/brand if missing
            existing.price = existing.price || price;
            existing.image = existing.image || toStaticUrl(image);
            existing.title = existing.title || title;
            existing.brand = existing.brand || brand;
        } else {
            cart.push({
                id: id,
                title: title,
                brand: brand,
                price: Number(price) || 0,
                image: image ? toStaticUrl(image) : '',
                quantity: qty
            });
        }
        saveCart(cart);
    }

    // Try to extract product info from a clicked element (data-* attributes) or surrounding product-card
    function extractProductFromElement(el) {
        if (!el) return null;
        // prefer dataset on the clicked element
        const ds = el.dataset || {};
        if (ds.title || ds.id || ds.price) {
            return {
                id: ds.id || ds.productId || ds.product_id || ds.pid,
                title: ds.title || ds.name,
                brand: ds.brand,
                price: ds.price || ds.unitPrice || ds['unit_price'],
                image: ds.image || ds.imageUrl || ds.image_url,
                quantity: ds.qty || ds.quantity || ds.count || 1
            };
        }
        // if this is inside a .product-card, try to pull details from it
        const card = el.closest ? el.closest('.product-card') : null;
        if (card) {
            const titleEl = card.querySelector('h3') || card.querySelector('.product-title') || card.querySelector('.title');
            const imgEl = card.querySelector('img') || card.querySelector('.product-image-box img');
            const priceEl = card.querySelector('.discounted-price') || card.querySelector('.price') || card.querySelector('.meta .price');
            return {
                id: card.getAttribute('data-id') || (titleEl ? titleEl.textContent.trim().replace(/\s+/g, '_') : ''),
                title: titleEl ? titleEl.textContent.trim() : '',
                brand: card.getAttribute('data-brand') || '',
                price: priceEl ? parseFloat((priceEl.textContent || '').replace(/[^0-9.]/g, '')) : 0,
                image: imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || '') : ''
            };
        }
        // fallback: no structured info
        return null;
    }

    // Render a simple modal cart summary into #modalCartSummary if present
    function populateModalCartSummary() {
        const outEl = document.getElementById('modalCartSummary') || document.getElementById('modalCartSummary');
        if (!outEl) return;
        const cart = getCart() || [];
        if (!cart.length) {
            outEl.innerHTML = '<div class="small-muted">Your cart is empty.</div>';
            return;
        }
        let html = `<table style="width:100%;border-collapse:collapse;">
            <thead><tr><th style="text-align:left">Product</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Total</th></tr></thead><tbody>`;
        let subtotal = 0;
        cart.forEach(item => {
            const qty = item.quantity || item.qty || 1;
            const price = parseFloat(item.price || 0);
            const itemTotal = price * qty;
            subtotal += itemTotal;
            html += `<tr>
                <td style="padding:8px 6px;">
                    <div style="display:flex;gap:8px;align-items:center;">
                        <img src="${toStaticUrl(item.image || item.image_url || '')}" alt="${item.title || ''}" style="width:56px;height:56px;object-fit:contain;border-radius:6px;background:#fff;border:1px solid #eee;">
                        <div>
                            <div style="font-weight:600">${item.title || item.name || ''}</div>
                            <div class="small-muted" style="font-size:13px">${item.brand || ''}</div>
                        </div>
                    </div>
                </td>
                <td style="text-align:center;">${qty}</td>
                <td style="text-align:right;">$${itemTotal.toFixed(2)}</td>
            </tr>`;
        });
        html += `</tbody>
            <tfoot>
                <tr class="total-row"><td></td><td style="font-weight:700;">Subtotal</td><td style="text-align:right;font-weight:700;">$${subtotal.toFixed(2)}</td></tr>
                <tr class="total-row"><td></td><td style="font-weight:700;">Total</td><td style="text-align:right;color:#27ae60;font-weight:700;">$${subtotal.toFixed(2)}</td></tr>
            </tfoot>
        </table>`;
        outEl.innerHTML = html;
    }

    // Open the shared checkout modal(s) used across templates
    function openCheckoutModal() {
        populateModalCartSummary();

        // Common backdrop ids in templates
        const backdropCandidates = ['checkoutBackdrop', 'checkoutModalBg', 'checkoutBackdrop', 'checkoutBackdrop', 'checkoutBackdrop'];
        let shown = false;
        backdropCandidates.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                try {
                    el.style.display = 'flex';
                    el.setAttribute('aria-hidden', 'false');
                    el.style.alignItems = 'center';
                    el.style.justifyContent = 'center';
                    shown = true;
                } catch (e) { /* ignore */ }
            }
        });

        if (!shown) {
            // fallback to checkout page if no modal present
            window.location.href = '/checkout';
            return;
        }

        // NOTE: Payment rendering (PayPal / card buttons) is intentionally not performed here.
        // That logic should live in the centralized checkout/cart/paypal pages.
    }

    // Attach Buy handlers to many possible selectors including listing "Buy" buttons.
    function attachBuyNowHandler() {
        const selectors = [
            '#buyNowBtn',
            '#addCartBtn',
            '.cta-button.buy-now',
            '.action-button.buy-now',
            'button.buy-now',
            '.buy-now',
            '.buy',
            '.btn-buy',
            '.product-actions .buy-now'
        ];

        const nodes = selectors.reduce((acc, sel) => {
            try {
                document.querySelectorAll(sel).forEach(n => acc.push(n));
            } catch (e) { /* ignore bad selectors */ }
            return acc;
        }, []);

        const uniq = Array.from(new Set(nodes));

        if (!uniq.length) {
            const addCartCompat = document.getElementById('addCartBtn');
            if (addCartCompat) {
                addCartCompat.addEventListener('click', function (e) {
                    e.preventDefault();
                    if (window.currentProduct) addProductObjectToCart(window.currentProduct, 1);
                    openCheckoutModal();
                });
            }
            return;
        }

        uniq.forEach(btn => {
            if (btn.dataset && btn.dataset._buynowAttached === '1') return;
            btn.dataset._buynowAttached = '1';
            btn.addEventListener('click', function (e) {
                try { e.preventDefault(); } catch (err) { /* ignore */ }
                const el = e.currentTarget || this;

                // Prefer structured data from the clicked element
                const fromEl = extractProductFromElement(el);
                if (fromEl) {
                    // use any numeric dataset qty or default to 1
                    const qty = parseInt(fromEl.quantity || fromEl.qty || el.dataset.qty || 1, 10) || 1;
                    addProductObjectToCart(fromEl, qty);
                } else if (window.currentProduct) {
                    addProductObjectToCart(window.currentProduct, 1);
                } else {
                    // fallback: minimal product from DOM
                    const prod = {
                        id: document.getElementById('productName') ? document.getElementById('productName').textContent : (new Date().getTime()),
                        title: document.getElementById('productName') ? document.getElementById('productName').textContent : 'Product',
                        brand: document.getElementById('brandName') ? document.getElementById('brandName').textContent : '',
                        price: (function () {
                            const p = document.getElementById('productPrice');
                            if (!p) return 0;
                            const txt = p.textContent || '';
                            const num = parseFloat(txt.replace(/[^0-9.]+/g, ''));
                            return isNaN(num) ? 0 : num;
                        })(),
                        image: (document.getElementById('productImage') && document.getElementById('productImage').src) ? document.getElementById('productImage').src : ''
                    };
                    addProductObjectToCart(prod, 1);
                }

                // Open modal (payment handled in checkout/cart pages)
                openCheckoutModal();
            });
        });
    }

    // (Optional) wishlist button: placeholder behavior (toggle visual only)
    function attachWishlistToggle() {
        const wishlistBtn = document.getElementById('wishlistBtn') || document.getElementById('productWishlistBtn');
        if (!wishlistBtn) return;
        wishlistBtn.addEventListener('click', function () {
            wishlistBtn.classList.toggle('wish-added');
            wishlistBtn.textContent = wishlistBtn.classList.contains('wish-added') ? '♥ Wishlist' : '♡ Wishlist';
            try {
                const list = JSON.parse(localStorage.getItem('wishlist') || '[]');
                const pid = window.currentProduct ? (window.currentProduct.id || window.currentProduct.product_id || window.currentProduct.title) : (document.getElementById('productName') ? document.getElementById('productName').textContent : new Date().getTime());
                const idx = list.findIndex(i => ('' + i.id) === ('' + pid));
                if (idx >= 0) { list.splice(idx, 1); } else { list.push({ id: pid, title: (window.currentProduct && window.currentProduct.title) || (document.getElementById('productName') ? document.getElementById('productName').textContent : '') }); }
                localStorage.setItem('wishlist', JSON.stringify(list));
            } catch (e) { /* ignore */ }
        });
    }

    // Load product details and wire up the page
    (async function initProductPage() {
        // Get query params first (backwards compatible)
        const queryBrand = safeParam('brand') || '';
        const queryProduct = safeParam('product') || '';
        const queryProductId = safeParam('product_id') || '';

        // Start with query params if present, otherwise fall back to path segments:
        let rawBrand = queryBrand;
        let rawProduct = queryProduct;
        let rawProductId = queryProductId;

        if (!rawBrand) {
            try {
                const parts = window.location.pathname.split('/').filter(Boolean);
                if (parts.length >= 2 && parts[0] === 'brand') {
                    rawBrand = decodeURIComponent(parts[1] || '');
                    if (parts.length >= 4 && parts[2] === 'product') {
                        rawProduct = decodeURIComponent(parts[3] || '');
                    }
                }
            } catch (e) {
                console.warn('path parsing failed', e);
            }
        }

        const brandForApi = encodeURIComponent((rawBrand || '').replace(/ /g, '_'));
        const productForApi = encodeURIComponent((rawProduct || '').replace(/ /g, '_'));
        const productIdForApi = encodeURIComponent((rawProductId || '').trim());

        if (!brandForApi) {
            console.warn('No brand specified in query string or path. Attempting to continue with empty brand.');
        }

        // If product_id present prefer the by-id endpoint
        let productApiUrl;
        if (productIdForApi) {
            productApiUrl = `${API}/product_by_id?product_id=${productIdForApi}`;
        } else {
            productApiUrl = `${API}/products/${brandForApi}/${productForApi}`;
        }

        try {
            const res = await fetch(productApiUrl);
            if (!res.ok) {
                console.warn('Product API returned', res.status);
                const nameEl = document.getElementById('productName');
                if (nameEl) nameEl.textContent = 'Product not found';
                return;
            }
            const productData = await res.json();

            // Expose the product on window for buy/Add-to-cart handler
            window.currentProduct = productData;

            // Populate UI
            const pageTitle = document.getElementById('pageTitle');
            if (pageTitle) pageTitle.textContent = `${productData.title} - ${productData.brand}`;
            const pname = document.getElementById('productName');
            if (pname) pname.textContent = productData.title;
            const bname = document.getElementById('brandName');
            if (bname) bname.textContent = productData.brand || '';
            const priceEl = document.getElementById('productPrice');
            if (priceEl) priceEl.textContent = "$" + (parseFloat(productData.price || 0)).toFixed(2);
            const descEl = document.getElementById('productDescription');
            if (descEl) descEl.textContent = productData.description || '';

            // Key notes
            const keyNotesArr = Array.isArray(productData.keyNotes) ? productData.keyNotes :
                (typeof productData.keyNotes === 'string' ? productData.keyNotes.split(';') : []);
            const keyNotesEl = document.getElementById('keyNotes');
            if (keyNotesEl) {
                keyNotesEl.innerHTML = '';
                keyNotesArr.forEach(n => {
                    const text = (typeof n === 'string') ? n.trim() : (n || '');
                    if (text) {
                        const li = document.createElement('li');
                        li.textContent = text;
                        keyNotesEl.appendChild(li);
                    }
                });
            }

            // Thumbnails
            const thumbsCol = document.getElementById('thumbnailsCol');
            if (thumbsCol) thumbsCol.innerHTML = '';
            const thumbnails = typeof productData.thumbnails === 'string' ? productData.thumbnails.split(',').map(s => s.trim()).filter(Boolean) : (productData.thumbnails || []);
            if (thumbnails.length === 0 && productData.image_url) {
                thumbnails.push(productData.image_url);
            }
            thumbnails.forEach((turl, idx) => {
                const img = document.createElement('img');
                img.src = toStaticUrl(turl);
                img.className = 'thumbnail-img';
                img.alt = `Thumbnail ${idx + 1}`;
                img.addEventListener('click', () => {
                    const mainImgEl = document.getElementById('productImage');
                    if (mainImgEl) mainImgEl.src = toStaticUrl(turl);
                    document.querySelectorAll('.thumbnail-img').forEach(x => x.classList.remove('selected'));
                    img.classList.add('selected');
                });
                if (thumbsCol) thumbsCol.appendChild(img);
                if (idx === 0) img.classList.add('selected');
            });

            // Set main image
            const mainImg = document.getElementById('productImage');
            const mainSrc = (thumbnails.length > 0) ? thumbnails[0] : (productData.image_url || '');
            if (mainImg) mainImg.src = toStaticUrl(mainSrc);

            // product tags
            const tagsEl = document.getElementById('productTags');
            if (tagsEl) {
                if (productData.tags) {
                    const tags = typeof productData.tags === 'string' ? productData.tags.split(',').map(s => s.trim()).filter(Boolean) : productData.tags;
                    tagsEl.textContent = 'Tags: ' + tags.join(', ');
                } else {
                    tagsEl.textContent = '';
                }
            }

            // Similar products
            const similar = await loadSimilarProducts(productData.id);
            renderSimilarProducts(similar);

            // Attach buy now handler now that we have productData
            attachBuyNowHandler();

            // attach wishlist toggle if present (keeps a distinct wishlist button from buy-now)
            attachWishlistToggle();

        } catch (err) {
            console.error('Failed to load product', err);
            const nameEl = document.getElementById('productName');
            if (nameEl) nameEl.textContent = 'Product unavailable';
            const descEl = document.getElementById('productDescription');
            if (descEl) descEl.textContent = '';
        }
    })();

});