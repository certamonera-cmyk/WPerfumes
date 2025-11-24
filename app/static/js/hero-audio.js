// static/js/hero-audio.js
// Robust hero audio controller:
// - Creates the mute button if it's missing (backwards-compatible with older markup).
// - Attempts to autoplay muted (allowed by browsers) and retries play/unmute on user gesture.
// - Persists user's mute preference in localStorage.
// - Updates accessibility attributes and an optional status element.
// - Handles visibilitychange to pause/resume for resource savings.
//
// Works with the index.html audio markup:
// <audio id="heroAudio" loop preload="auto" playsinline> ... </audio>
// optional controls:
// <button id="heroAudioMuteBtn"><span id="heroAudioMuteIcon">🔈</span></button>
// <span id="heroAudioStatus"></span>
(function () {
    const AUDIO_ID = 'heroAudio';
    const BUTTON_ID = 'heroAudioMuteBtn';
    const ICON_ID = 'heroAudioMuteIcon';
    const STATUS_ID = 'heroAudioStatus';
    const STORAGE_KEY = 'hero_audio_muted_v1';

    function el(id) { return document.getElementById(id); }

    function setIcon(iconEl, muted) {
        if (!iconEl) return;
        try {
            iconEl.textContent = muted ? '🔇' : '🔊';
        } catch (e) { /* ignore */ }
    }

    function setButtonAria(btn, muted) {
        if (!btn) return;
        try {
            btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
            btn.setAttribute('aria-label', muted ? 'Unmute hero audio' : 'Mute hero audio');
            btn.title = muted ? 'Unmute audio' : 'Mute audio';
        } catch (e) { /* ignore */ }
    }

    function setStatusText(statusEl, txt) {
        if (!statusEl) return;
        try {
            statusEl.style.display = txt ? '' : 'none';
            statusEl.textContent = txt || '';
        } catch (e) { /* ignore */ }
    }

    function persistMuted(muted) {
        try {
            localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
        } catch (e) { /* ignore */ }
    }

    function getPersistedMuted() {
        try {
            const v = localStorage.getItem(STORAGE_KEY);
            if (v === null) return null;
            return v === '1';
        } catch (e) {
            return null;
        }
    }

    async function tryPlay(audioEl, statusEl) {
        if (!audioEl) return false;
        try {
            await audioEl.play();
            setStatusText(statusEl, '');
            return true;
        } catch (err) {
            // Autoplay blocked or other playback error
            console.warn('Hero audio play() failed or autoplay blocked:', err);
            setStatusText(statusEl, 'Tap the audio button to start audio');
            return false;
        }
    }

    // If audio or button missing, create fallback UI/button to ensure users can unmute
    function ensureButtonExists(audio, muteBtn, muteIcon) {
        if (muteBtn && muteIcon) return { muteBtn, muteIcon };
        const player = document.getElementById('hero-audio-player') || (audio && audio.parentNode) || document.body;

        // Create button
        const btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.className = 'hero-audio-btn';
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('aria-label', 'Mute/unmute hero audio');
        btn.title = 'Mute/unmute audio';
        btn.type = 'button';
        const icon = document.createElement('span');
        icon.id = ICON_ID;
        icon.textContent = '🔈';
        btn.appendChild(icon);

        // Insert near the audio element when possible
        try {
            if (player && player.insertBefore && audio && audio.parentNode === player) {
                player.insertBefore(btn, audio);
            } else if (audio && audio.parentNode) {
                audio.parentNode.insertBefore(btn, audio);
            } else {
                (player || document.body).appendChild(btn);
            }
        } catch (e) {
            (document.body).appendChild(btn);
        }

        return { muteBtn: el(BUTTON_ID), muteIcon: el(ICON_ID) };
    }

    function updateUI(audio, muteBtn, muteIcon, status) {
        if (!audio || !muteBtn || !muteIcon) return;
        if (audio.muted) {
            setIcon(muteIcon, true);
            setButtonAria(muteBtn, true);
            setStatusText(status, 'Muted');
        } else {
            setIcon(muteIcon, false);
            setButtonAria(muteBtn, false);
            setStatusText(status, 'Playing');
        }
    }

    function init() {
        const audio = el(AUDIO_ID);
        if (!audio) {
            console.warn('hero-audio: audio element not found (#' + AUDIO_ID + ')');
            return;
        }

        let muteBtn = el(BUTTON_ID);
        let muteIcon = el(ICON_ID);
        let status = el(STATUS_ID);

        // Create button if missing
        ({ muteBtn, muteIcon } = ensureButtonExists(audio, muteBtn, muteIcon));

        // Ensure status element reference (may be absent)
        if (!status) status = el(STATUS_ID);

        // Apply sensible defaults: prefer muted by default for autoplay policies,
        // but respect persisted user preference if present.
        const persisted = getPersistedMuted();
        const initialMuted = (persisted === null) ? true : !!persisted;
        try {
            audio.muted = initialMuted;
        } catch (e) { /* ignore */ }

        // Reflect initial UI
        updateUI(audio, muteBtn, muteIcon, status);

        // Attempt to autoplay (muted is most likely allowed)
        setTimeout(() => {
            tryPlay(audio, status).then(ok => {
                if (!ok && audio.muted) {
                    // If muted autoplay failed, still prompt the user to start playback via the button
                    setStatusText(status, 'Tap the audio button to start audio');
                }
            }).catch(() => setStatusText(status, 'Tap the audio button to start audio'));
        }, 50);

        // Button click toggles mute/unmute — this is a user gesture and will allow audible play
        if (muteBtn) {
            muteBtn.addEventListener('click', async function (ev) {
                ev && ev.preventDefault && ev.preventDefault();
                try {
                    const newMuted = !audio.muted;
                    audio.muted = newMuted;
                    persistMuted(newMuted);
                    updateUI(audio, muteBtn, muteIcon, status);

                    // If unmuting, try to play (user gesture should allow it)
                    if (!newMuted) {
                        await tryPlay(audio, status);
                    }
                } catch (e) {
                    console.warn('hero-audio: mute toggle failed', e);
                }
            }, { passive: true });

            // keyboard accessibility
            muteBtn.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    muteBtn.click();
                }
            });
        }

        // Pause/resume on visibility change to save CPU/bandwidth
        document.addEventListener('visibilitychange', () => {
            try {
                if (document.hidden) {
                    if (!audio.paused) audio.pause();
                } else {
                    // attempt to resume if muted (autoplay allowed) or if user had previously unmuted
                    const persistedMuted = getPersistedMuted();
                    const wantUnmuted = persistedMuted === false;
                    if (!audio.paused && audio.muted && !wantUnmuted) {
                        // already muted and playing — leave it
                        return;
                    }
                    if (audio.muted || wantUnmuted) {
                        tryPlay(audio, status).catch(() => { });
                    }
                }
            } catch (e) { /* ignore */ }
        });

        // Make sure UI stays consistent if audio properties are changed elsewhere
        audio.addEventListener('volumechange', () => updateUI(audio, muteBtn, muteIcon, status));
        audio.addEventListener('play', () => updateUI(audio, muteBtn, muteIcon, status));
        audio.addEventListener('pause', () => updateUI(audio, muteBtn, muteIcon, status));
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(init, 0);
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();