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

export function initTheme(selectEl) {
    const stored = localStorage.getItem(LS_KEY) || 'system';
    selectEl.value = stored;
    applyTheme(stored);

    // Re-apply when OS preference changes (only matters when set to 'system')
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if ((localStorage.getItem(LS_KEY) || 'system') === 'system') {
            applyTheme('system');
        }
    });

    selectEl.addEventListener('change', () => {
        const value = selectEl.value;
        localStorage.setItem(LS_KEY, value);
        applyTheme(value);
    });
}
