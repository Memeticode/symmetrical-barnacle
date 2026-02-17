# Geometric Interior Self-Portrait — Timeline + WebM Export

A client-side generative art instrument for creating “geometric interior self-portraits”:

- Static render (PNG + title + alt-text + note + metadata via ZIP)
- Animated timeline (morph between 2+ profiles)
- Export animated loop as **WebM** (in-browser via MediaRecorder)

Everything runs locally in the browser. No uploads. No server.

External dependency:
- JSZip (for ZIP exports) loaded via CDN by default (can be vendored)

---

## Run

### Option A: Open directly
Open `index.html` in a modern browser.

### Option B: Local dev server
```bash
npm install
npm run dev
