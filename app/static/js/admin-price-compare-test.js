// app/static/js/admin-price-compare-test.js
// Simple helper to add a Test Fetch button to the Price Comparison admin card.
// It looks for the #priceComparisonCard element and appends a small control
// that lets admins paste a URL and optional selector and run a one-off fetch.

(function () {
    function el(id) { return document.getElementById(id); }

    function createTestControl() {
        var card = document.getElementById('priceComparisonCard');
        if (!card) return;

        var wrapper = document.createElement('div');
        wrapper.style.marginTop = '12px';
        wrapper.style.display = 'flex';
        wrapper.style.gap = '8px';
        wrapper.style.alignItems = 'center';

        var input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Competitor product URL (e.g. https://vperfumes.example/p/123)';
        input.style.flex = '1';
        input.id = 'pc_test_url';

        var sel = document.createElement('input');
        sel.type = 'text';
        sel.placeholder = 'CSS selector (optional, e.g. .price)';
        sel.style.width = '240px';
        sel.id = 'pc_test_selector';

        var btn = document.createElement('button');
        btn.textContent = 'Test fetch';
        btn.className = 'btn small';
        btn.id = 'pc_test_btn';

        var out = document.createElement('pre');
        out.id = 'pc_test_out';
        out.style.width = '100%';
        out.style.maxHeight = '220px';
        out.style.overflow = 'auto';
        out.style.marginTop = '8px';
        out.style.padding = '8px';
        out.style.background = '#fafafa';
        out.style.border = '1px solid #eee';

        wrapper.appendChild(input);
        wrapper.appendChild(sel);
        wrapper.appendChild(btn);

        // insert wrapper before the tip paragraph (if exists) else append
        var tip = card.querySelector('div[style*="Tip:"]') || null;
        if (tip && tip.parentNode) {
            tip.parentNode.insertBefore(wrapper, tip);
            tip.parentNode.insertBefore(out, tip);
        } else {
            card.appendChild(wrapper);
            card.appendChild(out);
        }

        btn.addEventListener('click', async function () {
            var url = document.getElementById('pc_test_url').value.trim();
            var selector = document.getElementById('pc_test_selector').value.trim();
            if (!url) { alert('Enter a URL to test'); return; }
            out.textContent = 'Fetching…';
            try {
                var payload = { url: url };
                if (selector) payload.selector = selector;
                var res = await fetch('/api/scrape-price', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                var js = await res.json();
                out.textContent = JSON.stringify(js, null, 2);
            } catch (err) {
                out.textContent = 'Error: ' + String(err);
            }
        });
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(createTestControl, 50);
    } else {
        document.addEventListener('DOMContentLoaded', createTestControl);
    }
})();