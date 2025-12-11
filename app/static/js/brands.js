// app/static/js/brands.js
// Derived from the previous men.js implementation — adapted and renamed to brands.js.
// - Runs on /men, /women and /brands pages (guarded).
// - Renders Top Picks and provides a paginated brands view (auto-slide).
// - Exposes a debug API under window.brandsPage

(function () {
    'use strict';

    // -----------------------------------------------------------------------
    // Configuration
    // -----------------------------------------------------------------------
    const API = "/api";
    const BRANDSPERPAGE = 5;
    const AUTO_SLIDE_DURATION = 4000;
    const TOPPICKS_VISIBLE = 5; // visible items in top-picks at once (desktop)
    const TOPPICKS_SLIDE_INTERVAL = 4000; // ms
    const PLACEHOLDER_IMG = (typeof window !== 'undefined' && window.PLACEHOLDER_IMG) ? window.PLACEHOLDER_IMG : '/static/images/placeholder.jpg';
    const DEFAULT_PRODUCT_IMG = (typeof window !== 'undefined' && window.DEFAULT_PRODUCT_IMG) ? window.DEFAULT_PRODUCT_IMG : '/static/images/default.jpg';
    const LOG_PREFIX = 'brands.js:';

    // -----------------------------------------------------------------------
    // Internal state
    // -----------------------------------------------------------------------
    let ALL_BRANDS = [];
    let currentBrands = [];
    let currentPage = 1;
    let autoSlideInterval = null;
    let currentSearch = '';

    // Top picks slider state
    let topPicksInterval = null;
    let topPicksCurrentPage = 0;
    let topPicksPages = 1;
    let topPicksWrapper = null;
    let topPicksTrack = null;

    // Page guard: run heavy init on /men, /women, or /brands
    const _PATHNAME = (typeof window !== 'undefined' && window.location && window.location.pathname) ? window.location.pathname : '';
    const IS_BRANDS_MEN_WOMEN_PAGE = _PATHNAME.startsWith('/men') || _PATHNAME.startsWith('/women') || _PATHNAME.startsWith('/brands');

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    function log(...args) { try { console.debug(LOG_PREFIX, ...args); } catch (e) { /* ignore */ } }
    function warn(...args) { try { console.warn(LOG_PREFIX, ...args); } catch (e) { /* ignore */ } }
    function error(...args) { try { console.error(LOG_PREFIX, ...args); } catch (e) { /* ignore */ } }

    function isString(x) { return typeof x === 'string' || x instanceof String; }
    function toStaticUrl(url) {
        if (!url) return PLACEHOLDER_IMG;
        if (!isString(url)) return PLACEHOLDER_IMG;
        if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')) return url;
        return `/static/${url}`;
    }

    function escapeHtmlAttr(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function escapeText(s) {
        if (s === null || s === undefined) return '';
        return String(s);
    }

    async function safeFetch(url, opts = {}) {
        try {
            const res = await fetch(url, Object.assign({ credentials: 'include' }, opts));
            if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
            return res;
        } catch (e) {
            warn('safeFetch error', url, e);
            throw e;
        }
    }

    async function safeFetchJson(url, opts = {}) {
        const res = await safeFetch(url, opts);
        try { return await res.json(); } catch (e) { warn('parse json failed', url, e); return null; }
    }

    // -----------------------------------------------------------------------
    // Discount display (small copy from main.js to keep UX consistent)
    // -----------------------------------------------------------------------
    async function fetchDiscountPercent() {
        try {
            const r = await fetch(`${API}/settings/checkout_discount`);
            if (!r.ok) throw new Error('no-discount');
            const js = await r.json().catch(() => ({}));
            const percent = parseFloat(js.percent) || 0;
            const discountInfoDiv = document.getElementById('discountPercentInfo');
            if (discountInfoDiv) {
                if (percent > 0) {
                    discountInfoDiv.style.display = "block";
                    discountInfoDiv.innerHTML = `<span>🌟 <b>Special Offer:</b> <span style="color:#27ae60">${percent}% OFF</span> applied automatically at checkout & in your cart!</span>`;
                } else {
                    discountInfoDiv.style.display = "none";
                    discountInfoDiv.innerHTML = '';
                }
            }
            log('checkout discount percent', percent);
        } catch (err) {
            warn('fetchDiscountPercent error', err);
            const discountInfoDiv = document.getElementById('discountPercentInfo');
            if (discountInfoDiv) discountInfoDiv.style.display = "none";
        }
    }

    // -----------------------------------------------------------------------
    // Brands list (paginated) + auto-pagination controls
    // -----------------------------------------------------------------------
    function displayBrands(brands = [], page = 1) {
        const brandList = document.getElementById('brandList') || document.getElementById('brandGrid');
        if (!brandList) { warn('#brandList/#brandGrid not found'); return; }
        brandList.style.opacity = 0;
        setTimeout(() => {
            // If this is the ul (#brandList) layout, render li; if grid, assume cards already
            const isUL = brandList.tagName.toLowerCase() === 'ul';
            if (isUL) brandList.innerHTML = '';
            else brandList.innerHTML = '';

            const start = (page - 1) * BRANDSPERPAGE;
            const items = (brands || []).slice(start, start + BRANDSPERPAGE);
            if (!items.length) {
                if (isUL) brandList.innerHTML = `<li style="color:#888;padding:12px;">No brands found.</li>`;
                else {
                    const empty = document.createElement('div');
                    empty.style.color = '#888';
                    empty.style.padding = '12px';
                    empty.textContent = 'No brands found.';
                    brandList.appendChild(empty);
                }
                brandList.style.opacity = 1;
                return;
            }
            for (const b of items) {
                const brandName = b.name || 'Unknown Brand';
                if (isUL) {
                    const li = document.createElement('li');
                    li.innerHTML = `
              <div class="product-image-container">
                <img src="${toStaticUrl(b.logo || b.logo_url)}" alt="${escapeHtmlAttr(brandName)}" class="product-image">
              </div>
              <div class="product-name" title="${escapeHtmlAttr(brandName)}">${escapeText(brandName)}</div>
            `;
                    li.setAttribute('data-brand', (b.name || '').replace(/ /g, '_'));
                    li.addEventListener('click', () => {
                        window.location.href = `/brand?brand=${encodeURIComponent(brandName)}`;
                    });
                    brandList.appendChild(li);
                } else {
                    const a = document.createElement('a');
                    a.className = 'brand-link';
                    a.href = `/brand?brand=${encodeURIComponent((brandName || '').replace(/\s+/g, '_'))}`;
                    a.setAttribute('aria-label', `View ${brandName}`);
                    const card = document.createElement('div');
                    card.className = 'brand-card';
                    // Render ONLY image + name (no description) to meet design requirement
                    card.innerHTML = `
                      <img src="${toStaticUrl(b.logo || b.logo_url)}" alt="${escapeHtmlAttr(brandName)}">
                      <h3>${escapeText(brandName)}</h3>
                    `;
                    a.appendChild(card);
                    brandList.appendChild(a);
                }
            }
            brandList.style.opacity = 1;
            log('displayBrands', 'page', page, 'shown', items.length);
        }, 120);
    }

    function setupPagination(brands = []) {
        const controls = document.getElementById('paginationControls');
        const toggleBtn = document.getElementById('autoSlideToggle');
        if (!controls || !toggleBtn) { warn('pagination controls or toggle missing'); return; }

        // preserve toggle
        const preserved = toggleBtn.cloneNode(true);
        controls.innerHTML = '';
        controls.appendChild(preserved);

        const pageCount = Math.max(1, Math.ceil((brands || []).length / BRANDSPERPAGE));
        for (let i = 1; i <= pageCount; i++) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = i;
            btn.setAttribute('data-page', i);
            if (i === currentPage) btn.classList.add('active');
            btn.addEventListener('click', (e) => {
                stopAutoPagination();
                currentPage = parseInt(e.target.dataset.page, 10) || 1;
                displayBrands(currentBrands, currentPage);
                setupPagination(currentBrands);
                const container = document.getElementById('brandListContainer');
                if (container) window.scrollTo({ top: container.offsetTop, behavior: 'smooth' });
            });
            controls.insertBefore(btn, preserved);
        }

        preserved.addEventListener('click', handleAutoSlideToggle);
    }

    function autoPaginate() {
        const totalPages = Math.max(1, Math.ceil((currentBrands || []).length / BRANDSPERPAGE));
        currentPage++;
        if (currentPage > totalPages) currentPage = 1;
        displayBrands(currentBrands, currentPage);
        setupPagination(currentBrands);
    }

    function startAutoPagination() {
        if (autoSlideInterval === null && currentBrands.length > BRANDSPERPAGE) {
            autoSlideInterval = setInterval(autoPaginate, AUTO_SLIDE_DURATION);
            const btn = document.getElementById('autoSlideToggle');
            if (btn) { btn.textContent = "⏸️ Stop Auto-Slide"; btn.classList.add('active'); }
            log('auto pagination started');
        }
    }

    function stopAutoPagination() {
        if (autoSlideInterval !== null) {
            clearInterval(autoSlideInterval);
            autoSlideInterval = null;
            const btn = document.getElementById('autoSlideToggle');
            if (btn) { btn.textContent = "▶️ Start Auto-Slide"; btn.classList.remove('active'); }
            log('auto pagination stopped');
        }
    }

    function handleAutoSlideToggle() {
        if (autoSlideInterval === null) startAutoPagination();
        else stopAutoPagination();
    }

    // -----------------------------------------------------------------------
    // Top Picks slider helpers
    // -----------------------------------------------------------------------
    function setupTopPicksSlider(wrapper, track) {
        try {
            if (!wrapper || !track) return;
            topPicksWrapper = wrapper;
            topPicksTrack = track;
            const cardCount = track.children.length;
            // compute visible count based on CSS breakpoints; keep default as TOPPICKS_VISIBLE
            const visible = computeVisibleCount();
            topPicksPages = Math.max(1, Math.ceil(cardCount / visible));
            topPicksCurrentPage = 0;
            // initial transform reset
            track.style.transform = 'translateX(0px)';
            track.style.transition = 'transform 0.6s cubic-bezier(.22,.9,.32,1)';

            // pause on hover/focus
            wrapper.addEventListener('mouseenter', pauseTopPicksAutoSlide);
            wrapper.addEventListener('focusin', pauseTopPicksAutoSlide);
            wrapper.addEventListener('mouseleave', resumeTopPicksAutoSlide);
            wrapper.addEventListener('focusout', resumeTopPicksAutoSlide);

            // recompute pages and re-position on resize
            window.addEventListener('resize', () => {
                const prevPages = topPicksPages;
                const v = computeVisibleCount();
                const newPages = Math.max(1, Math.ceil(cardCount / v));
                topPicksPages = newPages;
                // clamp current page
                if (topPicksCurrentPage >= newPages) topPicksCurrentPage = 0;
                // apply immediate transform to keep correct position
                applyTopPicksTransform();
            });

            // start auto-slide if multiple pages
            if (topPicksPages > 1) {
                startTopPicksAutoSlide();
            } else {
                stopTopPicksAutoSlide();
            }

            log('TopPicks slider initialized', { cardCount, visible, topPicksPages });
        } catch (e) {
            warn('setupTopPicksSlider failed', e);
        }
    }

    function computeVisibleCount() {
        // align with CSS breakpoints: <520 => 2, <900 => 3, else 5
        try {
            const w = (typeof window !== 'undefined') ? window.innerWidth : 1200;
            if (w <= 520) return 2;
            if (w <= 900) return 3;
            return TOPPICKS_VISIBLE;
        } catch (e) {
            return TOPPICKS_VISIBLE;
        }
    }

    function applyTopPicksTransform() {
        if (!topPicksWrapper || !topPicksTrack) return;
        try {
            // translate by page * wrapper width (this ensures exactly one page shift)
            const pageWidth = topPicksWrapper.clientWidth;
            const x = topPicksCurrentPage * pageWidth;
            topPicksTrack.style.transform = `translateX(-${x}px)`;
        } catch (e) {
            warn('applyTopPicksTransform failed', e);
        }
    }

    function nextTopPicksPage() {
        try {
            if (!topPicksTrack) return;
            topPicksCurrentPage++;
            if (topPicksCurrentPage >= topPicksPages) {
                topPicksCurrentPage = 0; // loop back
            }
            applyTopPicksTransform();
        } catch (e) {
            warn('nextTopPicksPage error', e);
        }
    }

    function startTopPicksAutoSlide() {
        if (topPicksInterval !== null) return;
        if (!topPicksTrack || !topPicksWrapper) return;
        if (topPicksPages <= 1) return;
        topPicksInterval = setInterval(nextTopPicksPage, TOPPICKS_SLIDE_INTERVAL);
        log('top picks auto-slide started');
    }

    function stopTopPicksAutoSlide() {
        if (topPicksInterval !== null) {
            clearInterval(topPicksInterval);
            topPicksInterval = null;
            log('top picks auto-slide stopped');
        }
    }

    function pauseTopPicksAutoSlide() {
        stopTopPicksAutoSlide();
    }

    function resumeTopPicksAutoSlide() {
        // resume only if there is more than 1 page
        if (topPicksPages > 1) startTopPicksAutoSlide();
    }

    // -----------------------------------------------------------------------
    // Load dynamic Top Picks by Lifestyle
    // -----------------------------------------------------------------------
    async function loadDynamicTopPicksByLifestyle() {
        try {
            const [tpRes, prodRes] = await Promise.all([fetch(`${API}/top-picks`), fetch(`${API}/products`)]);
            if (!tpRes.ok) throw new Error(`top-picks fetch failed (${tpRes.status})`);
            const topPicks = await tpRes.json();
            const products = prodRes.ok ? await prodRes.json() : [];

            // (Rendering code unchanged from earlier version but adapted to use slider track)
            const prodMap = {};
            if (Array.isArray(products)) {
                products.forEach(p => {
                    if (!p) return;
                    const addKey = k => { if (k) prodMap[String(k)] = p; };
                    addKey(p.id); addKey(p._id); addKey(p.product_id);
                });
            }

            const picks = Array.isArray(topPicks) ? topPicks.filter(tp => tp.pushed) : [];
            const container = document.getElementById('dynamicTopPicksByLifestyleContainer');
            if (!container) { warn('dynamicTopPicks container missing'); return; }

            container.innerHTML = '';
            if (!picks || picks.length === 0) {
                try {
                    const path = (typeof window !== 'undefined' && window.location && window.location.pathname) ? window.location.pathname : '';
                    const isTargetPage = path.startsWith('/men') || path.startsWith('/women') || path.startsWith('/brands');
                    if (isTargetPage) {
                        container.innerHTML = "<div style='color:#888;font-size:1.05em'>No Top Picks by Lifestyle available. Check back soon!</div>";
                    } else {
                        container.innerHTML = "";
                    }
                } catch (e) {
                    container.innerHTML = "";
                }
                return;
            }

            // Create slider wrapper + track
            const wrapper = document.createElement('div');
            wrapper.className = 'slider-wrapper';
            const track = document.createElement('div');
            track.className = 'slider-track';
            wrapper.appendChild(track);
            container.appendChild(wrapper);

            // Render picks into the track
            for (const tp of picks) {
                let prod = null;
                try {
                    if (tp && tp.product_id) {
                        prod = prodMap[String(tp.product_id)] || prodMap[tp.product_id] || null;
                    }
                    if (!prod && tp) {
                        const trial = ['id', '_id', 'product_id'];
                        for (const k of trial) {
                            if (!prod && tp[k]) prod = prodMap[String(tp[k])] || null;
                        }
                    }
                    if (!prod && tp && tp.product_title && Array.isArray(products)) {
                        const tt = String(tp.product_title).toLowerCase().trim();
                        prod = products.find(p => {
                            const candidate = String(p.title || p.name || '').toLowerCase().trim();
                            return candidate && candidate === tt;
                        }) || null;
                    }
                } catch (e) {
                    warn('product resolution failure', tp, e);
                }

                const imgUrl = prod ? (prod.image_url ? toStaticUrl(prod.image_url) : (prod.image ? toStaticUrl(prod.image) : DEFAULT_PRODUCT_IMG)) : (tp.image_url ? toStaticUrl(tp.image_url) : DEFAULT_PRODUCT_IMG);
                const resolvedTitle = (prod && (prod.title || prod.name)) || tp.product_title || '';
                const resolvedBrand = (prod && (prod.brand || prod.manufacturer)) || tp.brand || '';
                const resolvedPrice = (prod && (typeof prod.price !== 'undefined' && prod.price !== null)) ? prod.price : (tp.price || '—');

                const card = document.createElement('div');
                card.className = 'dynamic-top-pick-card';

                card.innerHTML = `
          <div class="image-wrapper" style="background:#fff;">
            <img src="${escapeHtmlAttr(imgUrl)}" alt="${escapeHtmlAttr(resolvedTitle || 'Product')}" />
          </div>
          <div class="dynamic-top-pick-name" aria-hidden="false" role="heading" style="
              padding: 8px 12px 0 12px;
              font-weight:700;
              font-size:1.02em;
              color:#3e2723;
              text-align:left;
              overflow:hidden;
              text-overflow:ellipsis;
              white-space:nowrap;
          "></div>
          <div class="dynamic-top-pick-details" style="padding:6px 12px 10px 12px;">
            <div class="dynamic-top-pick-brand" style="font-size:0.95em;color:#2d8f7c;margin-top:6px;"></div>
            <div class="dynamic-top-pick-tags" style="font-size:0.87em;color:#666;margin-top:6px;">Lifestyle: ${Array.isArray(tp.tags) ? tp.tags.join(', ') : (tp.tags || '')}</div>
            <div class="dynamic-top-pick-price" style="font-weight:700;color:#e53935;margin-top:6px;">${(resolvedPrice === '—') ? '' : 'AED ' + Number(resolvedPrice).toFixed(2)}</div>
          </div>
          <div class="dynamic-top-pick-actions" style="display:flex;gap:8px;padding:10px 12px;border-top:1px solid rgba(0,0,0,0.03);background:#fafafa;">
            <button class="buy-now" style="background:#3e2723;color:#fff;border:none;border-radius:6px;padding:8px 12px;font-weight:700;cursor:pointer;">Buy Now</button>
            <button class="wishlist-btn" style="background:transparent;border:1px solid #e0e0e0;padding:8px 10px;border-radius:6px;cursor:pointer;">♡ Wishlist</button>
          </div>
        `;

                // append card to track (not to container)
                track.appendChild(card);

                try {
                    const nameEl = card.querySelector('.dynamic-top-pick-name');
                    if (nameEl) {
                        let nameToShow = resolvedTitle || (prod && (prod.title || prod.name)) || tp.product_title || '';
                        if (!nameToShow && prod && prod.brand && prod.sku) {
                            nameToShow = `${prod.brand} ${prod.sku}`;
                        }
                        if (!nameToShow) {
                            nameToShow = 'Product';
                            warn('Top Pick missing title', tp);
                        }
                        nameEl.textContent = nameToShow;
                        nameEl.setAttribute('title', nameToShow);
                    }
                } catch (e) {
                    warn('failed to set top pick name', e);
                }

                try {
                    const brandEl = card.querySelector('.dynamic-top-pick-brand');
                    if (brandEl) brandEl.textContent = resolvedBrand || '';
                } catch (e) { /* ignore */ }

                try {
                    const productForCart = {
                        id: prod ? (prod.id || prod._id || prod.product_id) : (tp.product_id || resolvedTitle || 'product'),
                        title: resolvedTitle || tp.product_title || 'Product',
                        price: (prod && (prod.price || prod.price === 0)) ? Number(prod.price) : (tp.price ? Number(tp.price) : 0),
                        image_url: imgUrl
                    };
                    const productUrl = prod ? (`/product?id=${encodeURIComponent(prod.id || prod._id || prod.product_id)}`) : (`/product?title=${encodeURIComponent(resolvedTitle || tp.product_title || '')}`);

                    const buyBtn = card.querySelector('.buy-now');
                    if (buyBtn) {
                        buyBtn.addEventListener('click', (e) => {
                            try {
                                e.preventDefault(); e.stopPropagation();
                                if (typeof addToCart === 'function') {
                                    addToCart(productForCart);
                                } else {
                                    window.location.href = productUrl;
                                }
                            } catch (err) {
                                warn('buy handler error', err);
                                window.location.href = productUrl;
                            }
                        });
                    }

                    const wishBtn = card.querySelector('.wishlist-btn');
                    if (wishBtn) {
                        wishBtn.addEventListener('click', (e) => {
                            e.preventDefault(); e.stopPropagation();
                            wishBtn.textContent = '✓ Saved';
                            wishBtn.disabled = true;
                        });
                    }
                } catch (e) {
                    warn('failed to wire actions for top-pick', e);
                }
            } // end for each pick

            // initialize slider after all cards appended
            try {
                setupTopPicksSlider(wrapper, track);
            } catch (e) {
                warn('setupTopPicksSlider failed', e);
            }

            log('Top Picks rendered', picks.length);
        } catch (e) {
            error('loadDynamicTopPicksByLifestyle error', e);
            const container = document.getElementById('dynamicTopPicksByLifestyleContainer');
            if (container) container.innerHTML = "<div style='color:#c00'>Failed to load Top Picks.</div>";
        }
    }

    // -----------------------------------------------------------------------
    // Load brands (small helper)
    // -----------------------------------------------------------------------
    async function loadBrands() {
        try {
            const r = await fetch(`${API}/brands`);
            if (!r.ok) throw new Error(`brands fetch failed (${r.status})`);
            const brands = await r.json();
            ALL_BRANDS = Array.isArray(brands) ? brands : [];
            currentBrands = ALL_BRANDS.slice();
            currentPage = 1;
            displayBrands(currentBrands, currentPage);
            setupPagination(currentBrands);
            populateBrandFilter(ALL_BRANDS);
            updateStatusMessage('');
            log('brands loaded', ALL_BRANDS.length);
        } catch (e) {
            warn('loadBrands error', e);
            const brandList = document.getElementById('brandList') || document.getElementById('brandGrid');
            if (brandList) brandList.innerHTML = "<div style='color:#888'>Failed to load brands. Try again later.</div>";
        }
    }

    // -----------------------------------------------------------------------
    // Populate Brand select control with options from a filtered list
    // -----------------------------------------------------------------------
    function populateBrandFilter(brands) {
        const bf = document.getElementById('brandFilter');
        if (!bf) return;
        // preserve current selection if possible
        const previous = bf.value || '';
        bf.innerHTML = '';
        const allOpt = document.createElement('option');
        allOpt.value = '';
        allOpt.textContent = 'All Brands';
        bf.appendChild(allOpt);

        // unique brand names in order
        const seen = new Set();
        (brands || []).forEach(b => {
            const name = (b && b.name) ? String(b.name).trim() : '';
            if (!name) return;
            const key = name.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            const opt = document.createElement('option');
            opt.value = (name || '').replace(/ /g, '_');
            opt.textContent = name;
            bf.appendChild(opt);
        });

        // restore previous if still present
        try {
            if (previous) bf.value = previous;
        } catch (e) { /* ignore */ }
    }

    function updateStatusMessage(gender) {
        const status = document.getElementById('brandStatus');
        if (!status) return;
        const ctx = gender ? (gender.charAt(0).toUpperCase() + gender.slice(1)) : 'All';
        status.textContent = `${ctx} Products. Select a brand or use the filter above.`;
    }

    // -----------------------------------------------------------------------
    // Filters wiring
    // -----------------------------------------------------------------------
    function wireFilters() {
        const genderFilter = document.getElementById('genderFilter');
        const brandFilter = document.getElementById('brandFilter');
        const brandStatus = document.getElementById('brandStatus');
        const searchInput = document.getElementById('searchBrand');

        function applyAllFilters() {
            const selectedGender = genderFilter ? (genderFilter.value || '') : '';
            const selectedBrand = brandFilter ? (brandFilter.value || '') : '';
            const search = currentSearch || '';

            // filter ALL_BRANDS -> currentBrands
            currentBrands = ALL_BRANDS.slice().filter(b => {
                if (!b) return false;
                // gender check
                if (selectedGender) {
                    const g = (b.gender || b.sex || b.genders || '').toString().toLowerCase();
                    const tags = (b.tags || []).join ? (b.tags || []).join(',').toLowerCase() : (b.tags || '').toString().toLowerCase();
                    if (!(g.indexOf(selectedGender) !== -1 || tags.indexOf(selectedGender) !== -1)) return false;
                }
                // brand check
                if (selectedBrand) {
                    if (((b.name || '').replace(/ /g, '_').toLowerCase()) !== selectedBrand.toLowerCase()) return false;
                }
                // search check
                if (search) {
                    const q = search.toLowerCase().trim();
                    const n = (b.name || '').toString().toLowerCase();
                    const d = (b.description || '').toString().toLowerCase();
                    if (!(n.indexOf(q) !== -1 || d.indexOf(q) !== -1)) return false;
                }
                return true;
            });

            currentPage = 1;
            displayBrands(currentBrands, currentPage);
            setupPagination(currentBrands);
            // populate brandFilter based on gender filter (so brand list shows only matching brands)
            if (genderFilter) {
                const filteredForBrandOpts = ALL_BRANDS.slice().filter(b => {
                    if (!selectedGender) return true;
                    const g = (b.gender || b.sex || b.genders || '').toString().toLowerCase();
                    const tags = (b.tags || []).join ? (b.tags || []).join(',').toLowerCase() : (b.tags || '').toString().toLowerCase();
                    return (g.indexOf(selectedGender) !== -1) || (tags.indexOf(selectedGender) !== -1);
                });
                populateBrandFilter(filteredForBrandOpts);
            } else {
                populateBrandFilter(ALL_BRANDS);
            }
            updateStatusMessage(selectedGender);
            // if auto-slide running restart to pick up new page count
            if (autoSlideInterval !== null) {
                stopAutoPagination();
                startAutoPagination();
            }
        }

        if (genderFilter) {
            genderFilter.addEventListener('change', () => {
                // reset brand select when gender changes
                if (brandFilter) {
                    brandFilter.value = '';
                }
                applyAllFilters();
            });
        }

        if (brandFilter) {
            brandFilter.addEventListener('change', () => {
                applyAllFilters();
            });
        }

        if (searchInput) {
            let debounceT = null;
            searchInput.addEventListener('input', function () {
                if (debounceT) clearTimeout(debounceT);
                debounceT = setTimeout(() => {
                    currentSearch = (searchInput.value || '').trim();
                    applyAllFilters();
                }, 160);
            });
        }

        // Reset button
        const resetBtn = document.getElementById('showAllBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                if (genderFilter) genderFilter.value = '';
                if (brandFilter) brandFilter.value = '';
                if (searchInput) { searchInput.value = ''; currentSearch = ''; }
                currentBrands = ALL_BRANDS.slice();
                currentPage = 1;
                displayBrands(currentBrands, currentPage);
                setupPagination(currentBrands);
                populateBrandFilter(ALL_BRANDS);
                updateStatusMessage('');
                if (autoSlideInterval !== null) {
                    stopAutoPagination();
                    startAutoPagination();
                }
            });
        }
    }

    // -----------------------------------------------------------------------
    // Init
    // -----------------------------------------------------------------------
    function init() {
        log('init start');

        // Skip if not on men/women/brands page
        if (!IS_BRANDS_MEN_WOMEN_PAGE) {
            log('brands.js: not a men/women/brands page; skipping initialization to avoid injecting Top Picks on other pages.');
            return;
        }

        // Wire auto-slide toggle
        const autoSlideToggle = document.getElementById('autoSlideToggle');
        if (autoSlideToggle) autoSlideToggle.addEventListener('click', handleAutoSlideToggle);

        // Kick off background tasks
        fetchDiscountPercent();
        loadBrands();
        loadDynamicTopPicksByLifestyle();

        // Wire filters once
        wireFilters();

        // Small reveal and auto-start auto pagination if many brands
        setTimeout(() => {
            const bl = document.getElementById('brandListContainer') || document.getElementById('brandGrid');
            if (bl) bl.classList.add('slide-in-reveal');
            setTimeout(() => {
                if (currentBrands.length > BRANDSPERPAGE) startAutoPagination();
            }, 800);
        }, 300);

        try { setInterval(fetchDiscountPercent, 30000); } catch (e) { /* ignore */ }

        log('init done');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // -----------------------------------------------------------------------
    // Expose debug API
    // -----------------------------------------------------------------------
    if (typeof window !== 'undefined') {
        window.brandsPage = window.brandsPage || {};
        window.brandsPage.startAutoPagination = startAutoPagination;
        window.brandsPage.stopAutoPagination = stopAutoPagination;
        window.brandsPage.loadDynamicTopPicksByLifestyle = loadDynamicTopPicksByLifestyle;
        window.brandsPage.fetchDiscountPercent = fetchDiscountPercent;
        window.brandsPage.reloadBrands = async function () { await loadBrands(); };
        window.brandsPage.debugDump = function () {
            try {
                return {
                    pathname: _PATHNAME,
                    isBrandsMenWomen: IS_BRANDS_MEN_WOMEN_PAGE,
                    brandsCount: ALL_BRANDS.length,
                    currentBrandsCount: currentBrands.length,
                    currentPage,
                    autoSlideRunning: autoSlideInterval !== null,
                    topPicks: {
                        pages: topPicksPages,
                        currentPage: topPicksCurrentPage,
                        autoRunning: topPicksInterval !== null
                    }
                };
            } catch (e) { return { error: e && e.message }; }
        };

        // expose control helpers for top picks slider
        window.brandsPage.startTopPicksAutoSlide = startTopPicksAutoSlide;
        window.brandsPage.stopTopPicksAutoSlide = stopTopPicksAutoSlide;
        window.brandsPage.nextTopPicksPage = nextTopPicksPage;
    }

})();