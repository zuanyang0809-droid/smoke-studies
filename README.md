# Smoke Studies

Hand-drawn style smoke you can paint with, in the spirit of the 2D effects in *Arcane*. Three studies share one set of shading rules and one renderer-agnostic **Style JSON**; only the number of dimensions changes.

| Study | What it is | How it reads |
| --- | --- | --- |
| **01 · 2D brush** | One stable-fluids grid over the whole window, toon shaded on the GPU | Smoke |
| **02 · 2.5D cards** | Each stroke is its own 2D fluid card placed in 3D space | Smoke, now with space |
| **03 · 3D volume** | A GPU smoke fluid you can orbit around, ray-marched as translucent layers | Smoke again (the older particle renderers: liquid) |

The series grew out of one observation: **dimensionality changes the perceived material.** The same bands, hue shift, age tint and mottle that read as drawn smoke on a flat plane start to read as something thicker once the shape has a real 3D surface. The 2.5D study sits in between, the way Arcane composites flat 2D FX elements into 3D shots: every card is still a drawing, but the cards occupy space. The first 3D versions read as liquid; [docs/3d-smoke-research.md](docs/3d-smoke-research.md) works out why (one hard, opaque iso-surface, blobby splats, no light through the volume) and what makes stylized 3D smoke read as smoke (translucent layers, self-shadowing, turbulent filaments, expansion, rim light). The current 3D study is built on those findings, and the old renderers stay behind a switch for comparison.

Made for *Drawing++* (Zach Lieberman, MIT Media Lab, Fall 2026), assignment 3, generative nature.

**Live demos:** [zuanyang0809-droid.github.io/smoke-studies](https://zuanyang0809-droid.github.io/smoke-studies/)

## Run locally

Needs Node.js 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173/); it redirects to the landing page in `demos/`.

```bash
npm test
```

```bash
npm run build
```

`npm run build` writes the static site to `dist/`, with base path `/smoke-studies/` for GitHub Pages; `npm run preview` serves that build.

## Controls

Every study fills the window (black by default; the background is part of the Style JSON). All controls sit in the panel on the right, which you can hide with its button or the **\\** key; the panel remembers whether it was open.

- **Drag** to draw. **Brush** smoke drifts away and smolders while you hold still; a **Living stroke** keeps emitting until you clear it.
- **Undo / redo**, one stroke at a time (up to 30): **Ctrl / Cmd + Z** undoes, **Ctrl / Cmd + R** or **Ctrl / Cmd + Shift + Z** redoes (the page does not reload). The shortcuts do nothing while you type in the Style JSON editor. Undoing a brush stroke puts the smoke back to how it was when the stroke began; redo draws the stroke again. Undoing a living stroke stops it, and its smoke fades. *Clear* also clears the history.
- **2.5D:** Shift + drag rotates the space freely, all the way round to the backs of the cards (they show mirrored), and the next stroke starts a new card facing you. *Draw depth* pushes new cards forward or back; double-click turns back to the front. *Recolor all* repaints existing smoke, *Next stroke only* keeps it. Undoing the stroke that created a card removes the card; redo brings it back where it was.
- **3D:** drag orbits (or draws in *Draw* view; Shift swaps the two), right-drag pans, scroll zooms. Draw anywhere in view: the smoke box follows your strokes. *Renderer* switches between the fluid (default) and the two particle renderers; switching between the fluid and the particles starts a fresh scene.
- **Preset**, **Style JSON** (edit, apply, copy, download) and **Saved effects** work in every study. Saved effects live in `localStorage` under one key, so an effect saved in 2D loads in 2.5D and 3D too.

## How it works

### Simulation is separate from rendering

```
            Style JSON (styles/)
                 │
     ┌───────────┴────────────┐
  sim params              look params
     │                        │
 src/sim/  ──── fields ────▶ src/render/  ──▶ canvas / WebGL
```

The simulation knows nothing about color, and the renderers never move smoke. They meet in a few fields:

- **2D / 2.5D:** `Fluid2D` is one stable-fluids grid (Stam 1999) with vorticity confinement (Fedkiw et al. 2001). It has about 32,000 cells with the window's aspect (for example 239 × 134 on a 16:9 window), so smoke can use the whole window at a fixed cost; the prototypes used 160 × 107. Besides velocity and density it advects a **texture** field (brush noise carried by the flow), an **age** field (frames since the smoke left its source) and, in 2.5D, per-cell **RGB**, so strokes keep their own colors.
- **3D:** `Fluid3D` is a stable-fluids solver on the GPU: 64 × 96 × 64 voxels in a half-float texture atlas, with buoyancy from heat, vorticity confinement, expansion, Jacobi pressure and MacCormack advection of density, heat, texture and age. The box moves with your strokes and keeps room above them, and smoke fades with age at its own height (the Dissipation slider), so nothing collects at the top. The older `Particles3D` follows a curl-noise velocity field (Bridson et al. 2007) with no box at all.

The **toon rules** are the same everywhere: density plus texture above a threshold becomes a flat silhouette; occlusion sampled toward the light picks one of three bands; the palette rotates hue warm in the light and cool in the shadow; age shifts the bands from warm and light to cool and grey; texture extremes pick up two side colors (mottle); density below its blurred neighborhood darkens (AO); fresh, dense smoke gets glowing ember veins. These rules exist three times, once per renderer:

| Renderer | Used by | Where the rules run |
| --- | --- | --- |
| `render/toon-gl.js` + `toon-card.frag.glsl` | 2D, 2.5D | fields uploaded to textures on the frame step, shaded per pixel in GLSL; 2.5D cards are quads in one WebGL canvas |
| `render/toon2d.js` | tests | the CPU reference the GLSL port follows; the parity tests check it against the prototypes |
| `render/smoke-volume.js` + `smoke-light` / `smoke-march` | 3D (default) | light march per voxel, then a translucent ray march quantized into bands and three opacity levels |
| `render/screenspace.js` + `toon-screen.frag.glsl` | 3D (particles) | particles splatted to a screen grid on the CPU, shaded in GLSL |
| `render/volume.js` + `volume.frag.glsl` | 3D (particles) | particles splatted to a fitted 48 × 64 × 48 voxel grid, ray-marched to a surface |

The renderer switch makes the "material" question testable. Screen-space shading keeps the drawn-smoke look but stays flat. The particle volume finds a true 3D surface and turns liquid. The fluid keeps the drawn bands and lets light and the eye see into the smoke, so it reads as smoke again.

### Style JSON

`styles/smoke-style.schema.json` describes the look with normalized values (0 to 1, plus hue shift in degrees and hex colors), independent of any renderer. `styles/presets.json` holds four presets (Incense, Arcane smoke bomb, Lavender blast, Dust). The schema is the single source of truth: `src/core/style.js` derives the defaults and the validator from it. Each module owns its own mapping to internal units, for example:

| Style field | `Fluid2D` | `Particles3D` |
| --- | --- | --- |
| `motion.rise` | buoyancy `0.008 × rise` per frame | rise speed `0.26 × rise` cells per frame |
| `motion.curl` | vorticity confinement `0.4 × curl` | curl-noise gain `8 × curl` |
| `motion.dissipation` | extra decay `0.025 × dissipation` | weight decay `0.04 × dissipation` |

### CPU and GPU

In 2D and 2.5D the fluid runs on the CPU in plain JavaScript (typed arrays, no dependencies), which keeps it readable and testable; bounding-box simulation and adaptive scheduling (busy cards step every other frame with a doubled time step) keep 24 cards interactive. Shading every pixel of a full window on the CPU was too slow, so it runs on the GPU: on the frame step, only the region around the smoke is uploaded as half-float textures, and a GLSL port of `toon2d.js` shades it every display frame (raw WebGL2, no three.js on those pages). In 3D, the simulation itself runs on the GPU too.

## Project structure

```
src/
  core/      noise, hue-shift palette and palette cache, Style JSON load / validate / merge, undo / redo history
  sim/       fluid2d, layer2d (fluid + strokes + embers), undo2d, emitters, embers, scheduler,
             particles3d, fluid3d (GPU solver, shaders/*.glsl)
  render/    toon-gl + gl (2D / 2.5D on the GPU), card-space (2.5D cards as matrices), toon2d (CPU reference),
             smoke-volume (3D fluid), screenspace + volume + ember-points (3D particles), shaders/*.glsl
  ui/        panel, shortcuts, palette, controls (sliders bound to Style JSON), saved effects, tilt (2.5D), orbit (3D)
  apps/      brush-2d, cards-2_5d, volume-3d: entry points that only wire modules together
demos/       thin HTML pages and the landing page (the site root)
styles/      Style JSON schema and presets
docs/        research notes (3d-smoke-research.md)
tests/       Vitest: color / palette, style, simulation, history and shortcuts, card space, prototype parity
archive/     the original single-file prototypes, kept to show the process
```

The 2D and 2.5D apps share `Fluid2D`, `SmokeLayer2D`, `Emitter2D` and `ToonRendererGL`; the only difference is how many layers there are and how they are placed. The 2D study is a single card facing the camera.

### From prototypes to modules

The studies started as single-file HTML prototypes, iterated quickly in the browser (see `archive/`): 2D v10 is the brush, v11 adds a transparent canvas and CSS tilt, v12 to v15 develop the 2.5D cards (per-cell color, adaptive scheduling, bounding-box simulation), and 3D v1 / v2 are the volume and screen-space versions. This repository is the same work restructured into modules. `tests/parity.test.js` runs the archived v10, v15, 3D v1 and 3D v2 files in a Node vm next to the new modules, with the same scripted input and seeded random numbers, and requires **bit-identical** density, color, particle and pixel output. Pixels are compared through the CPU reference renderer; the GLSL ports and the 3D fluid were checked by eye in the browser.

Additions over the prototypes: the full-window layout with a side panel, GPU shading for 2D and 2.5D, unbounded 2.5D rotation, undo / redo, the 3D fluid, the preset picker and Style JSON editor in the 2D and 2.5D studies (previously 3D only), saved effects shared across all three studies (saves from the prototypes are migrated), a Download button for Style JSON, and the renderer switch in 3D, which keeps the v1 and v2 renderers next to the fluid.

## Publish with GitHub Desktop

1. In GitHub Desktop choose **File → Add Local Repository…** and pick this folder.
2. Click **Publish repository**. Keep the name `smoke-studies` (or see the note below), and untick *Keep this code private* if you want free GitHub Pages hosting.
3. On github.com, open the repository and go to **Settings → Pages**. Under *Build and deployment*, set **Source: GitHub Actions**.
4. Go to the **Actions** tab. The first run of *Deploy to GitHub Pages* may have failed because Pages was not enabled yet; open it and choose **Re-run all jobs** (or run the workflow manually). Later pushes from GitHub Desktop deploy automatically.
5. The site appears at `https://zuanyang0809-droid.github.io/smoke-studies/`.

The workflow (`.github/workflows/deploy.yml`) installs dependencies, runs the tests, builds with the repository name as base path, and deploys `dist/`. If you rename the repository, the deployed site follows automatically; for a local build under another name, run `BASE_PATH=/new-name/ npm run build`.

## References

Simulation

- Jos Stam, *Stable Fluids*, SIGGRAPH 1999. [Search](https://scholar.google.com/scholar?q=Stam+Stable+Fluids+1999)
- Ronald Fedkiw, Jos Stam, Henrik Wann Jensen, *Visual Simulation of Smoke* (vorticity confinement), SIGGRAPH 2001. [Search](https://scholar.google.com/scholar?q=Fedkiw+Stam+Jensen+Visual+Simulation+of+Smoke)
- Robert Bridson, Jim Hourihan, Marcus Nordenstam, *Curl-Noise for Procedural Fluid Flow*, SIGGRAPH 2007. [Search](https://scholar.google.com/scholar?q=Bridson+Curl-Noise+for+Procedural+Fluid+Flow)
- Andrew Selle, Ronald Fedkiw, ByungMoon Kim, Yingjie Liu, Jarek Rossignac, *An Unconditionally Stable MacCormack Method*, Journal of Scientific Computing 2008. [Search](https://scholar.google.com/scholar?q=An+Unconditionally+Stable+MacCormack+Method)
- Theodore Kim, Nils Thürey, Doug James, Markus Gross, *Wavelet Turbulence for Fluid Simulation*, SIGGRAPH 2008. [Project page](https://www.cs.cornell.edu/~tedkim/wturb)
- Pavel Dobryakov, *WebGL Fluid Simulation*. [GitHub](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation)

Stylized smoke

- Abraham and Fussell, *Smoke Brush*. [Search](https://scholar.google.com/scholar?q=Smoke+Brush+Abraham+Fussell)
- *DualSmoke*: sketch-based smoke illustration design. [Search](https://scholar.google.com/scholar?q=DualSmoke+smoke+illustration)
- Byungsoo Kim, Vinicius C. Azevedo, Markus Gross, Barbara Solenthaler, *Transport-Based Neural Style Transfer for Smoke Simulations*, SIGGRAPH Asia 2019. [Search](https://scholar.google.com/scholar?q=Transport-Based+Neural+Style+Transfer+for+Smoke+Simulations)
- Ondřej Jamriška et al., *LazyFluids: Appearance Transfer for Fluid Animations*, SIGGRAPH 2015. [Search](https://scholar.google.com/scholar?q=LazyFluids+Appearance+Transfer+for+Fluid+Animations)

Visual references (observed, not included in this repository)

- Arcane FX on Sakugabooru: [#270219](https://www.sakugabooru.com/post/show/270219) (S2 smoke bomb), [#170624](https://www.sakugabooru.com/post/show/170624) (S1 wall collapse dust). No video or frames from the show are included here.
- Nello Fontani's stylized smoke tests in EmberGen (lavender smoke with hue-shifted shadows), the starting point for the *Lavender blast* preset; his 80.lv breakdown (*colored thin strokes*, low quantization, smoke dilate) informed the 3D fluid renderer. [Article](https://80.lv/articles/making-anime-inspired-stylized-3d-explosions-with-jangafx-s-embergen/)

## About this code

The ideas, visual direction, references and iteration are mine. The code was developed together with Claude (Anthropic's AI assistant): the prototypes were written in conversation, and Claude Code restructured them into this modular project, with the tests above checking that the behavior did not change.

## License

[MIT](LICENSE) © 2026 Anyang Zu
