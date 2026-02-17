# Geometric Interior Self-Portrait — Simplified (Image + Animation)

Two modes:

## Image mode
- Adjust 6 aspect sliders
- Save the configuration as a **Profile** (a landmark)
- Export a **Still ZIP**:
  - `image.png`
  - `title.txt`
  - `alt-text.txt`
  - `note.txt`
  - `metadata.json`

## Animation mode
- Add 2+ saved Profiles into a loop
- Seamless looping animation rendered at **24 fps**
- Export an **Animation ZIP**:
  - `animation.webm`
  - `title.txt`
  - `alt-text.txt`
  - `keyframes.json` (title + alt + aspects for each landmark)
  - `manifest.json`

Everything runs locally in the browser (no uploads, no server).

---

## Seamless loop model

### 3+ landmarks
- Closed Catmull–Rom spline per slider (smooth continuity)
- **Time-warp** (under the hood): lingers near landmarks, accelerates between them, still seamless

### 2 landmarks
- Cosine A↔B loop (smooth turnarounds)
- Subtle time-warp applied to avoid over-slowing

---

## Run

Open `index.html`, or:

```bash
npm install
npm run dev
