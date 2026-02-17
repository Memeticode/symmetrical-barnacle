# Geometric Interior Self-Portrait — Simplified (Image + Animation)

A client-side generative art instrument with two modes:

## Image mode
- Adjust 6 aspect sliders
- Render a still image
- Save the current configuration as a **Profile** (a “landmark”)
- Export a **Still ZIP** containing:
  - `image.png`
  - `title.txt`
  - `alt-text.txt`
  - `note.txt`
  - `metadata.json`

## Animation mode
- Build a loop by adding 2+ saved Profiles (landmarks)
- Play/Pause a seamless looping animation
- Export an **Animation ZIP** containing:
  - `animation.webm`
  - `title.txt`
  - `alt-text.txt`
  - `keyframes.json` (title + alt + aspects for each landmark)
  - `manifest.json`

Everything runs locally in the browser (no uploads, no server).

External dependency:
- JSZip (ZIP exports) loaded via CDN by default.

---

## Seamless loop model

### 3+ landmarks
The animation uses a **closed Catmull–Rom spline** per slider:
- C1 continuous (smooth velocity)
- Seamless loop by construction (end matches start)

### 2 landmarks
The animation uses a cosine-eased A↔B loop:
- Seamless and smooth (zero slope at turning points)

---

## Determinism

Still renders:
- same seed + same aspects => same image/title/alt-text

Animation:
- a fixed **Animation Seed** ensures the animation’s structure stays coherent as aspects morph.

---

## Run

### Option A: Open directly
Open `index.html` in a modern browser.

### Option B: Local dev server
```bash
npm install
npm run dev
