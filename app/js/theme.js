/**
 * Minimal system/light/dark theme manager.
 *
 * - Stores preference in localStorage ('system' | 'light' | 'dark')
 * - 'system' follows the OS preference and updates live via matchMedia listener
 * - Applies theme by setting data-theme attribute on <html>
 * - CSS variables in index.html handle the actual styling
 */

const LS_KEY = 'geo-self-portrait-theme';

function applyTheme(pref) {
    const root = document.documentElement;
    if (pref === 'system') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.setAttribute('data-theme', isDark ? 'dark' : 'light');
    } else {
        root.setAttribute('data-theme', pref);
    }
}

function positionSlider(switcher, slider, activeBtn) {
    if (!activeBtn) return;
    slider.style.width = activeBtn.offsetWidth + 'px';
    slider.style.transform = `translateX(${activeBtn.offsetLeft - 3}px)`;
}

export function initTheme(switcherEl) {
    const slider = switcherEl.querySelector('.theme-slider');
    const buttons = switcherEl.querySelectorAll('.theme-option');
    const stored = localStorage.getItem(LS_KEY) || 'system';

    applyTheme(stored);

    // Set initial active state
    buttons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === stored);
    });

    // Position slider after layout is ready
    requestAnimationFrame(() => {
        // Disable transition for initial position
        slider.style.transition = 'none';
        const activeBtn = switcherEl.querySelector('.theme-option.active');
        positionSlider(switcherEl, slider, activeBtn);
        // Force reflow, then re-enable transition
        slider.offsetHeight;
        slider.style.transition = '';
    });

    // Re-apply when OS preference changes (only matters when set to 'system')
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if ((localStorage.getItem(LS_KEY) || 'system') === 'system') {
            applyTheme('system');
        }
    });

    // Button click handler
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const value = btn.dataset.theme;
            localStorage.setItem(LS_KEY, value);
            applyTheme(value);

            buttons.forEach(b => b.classList.toggle('active', b === btn));
            positionSlider(switcherEl, slider, btn);
        });
    });

    // Reposition slider on resize (button widths may change)
    window.addEventListener('resize', () => {
        const activeBtn = switcherEl.querySelector('.theme-option.active');
        positionSlider(switcherEl, slider, activeBtn);
    });
}
