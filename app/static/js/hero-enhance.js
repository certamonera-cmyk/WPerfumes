// static/js/hero-enhance.js
// Sparkle effect on hover for CTA button in hero section
document.addEventListener('DOMContentLoaded', function () {
    const cta = document.querySelector('.hero-cta-btn');
    if (!cta) return;
    cta.addEventListener('mouseenter', () => {
        for (let i = 0; i < 10; i++) {
            const sparkle = document.createElement('span');
            sparkle.className = 'hero-sparkle';
            sparkle.style.left = (Math.random() * 90 + 5) + '%';
            sparkle.style.top = (Math.random() * 90 + 5) + '%';
            cta.appendChild(sparkle);
            setTimeout(() => sparkle.remove(), 900);
        }
    });
});