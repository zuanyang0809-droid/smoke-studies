# Smoke Studies

Hand-drawn style smoke you can paint with, in the spirit of the 2D effects in *Arcane*. Three studies share one set of shading rules and one renderer-agnostic **Style JSON**; only the number of dimensions changes.

| Study | What it is | How it reads |
| --- | --- | --- |
| **01 · 2D brush** | One stable-fluids grid, toon shaded on the CPU | Smoke |
| **02 · 2.5D cards** | Each stroke is its own 2D fluid card placed in 3D space | Smoke, now with space |
| **03 · 3D volume** | Unbounded curl-noise particles you can orbit around | Liquid |

The series grew out of one observation: **dimensionality changes the perceived material.** The same bands, hue shift, age tint and mottle that read as drawn smoke on a flat plane start to read as something thicker once the shape has a real 3D surface. The 2.5D study sits in between, the way Arcane composites flat 2D FX elements into 3D shots: every card is still a drawing, but the cards occupy space.

Made for *Drawing++* (Zach Lieberman, Harvard GSD, Fall 2026), assignment 3, generative nature.

**Live demos:** after publishing (see below), at `https://<your-github-username>.github.io/smoke-studies/`.

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

- **Drag** to draw. **Brush** smoke drifts away and smolders while you hold still; a **Living stroke** keeps emitting until you clear it.
- **2.5D:** Shift + drag rotates the space, and the next stroke starts a new card facing you. *Draw depth* pushes new cards forward or back; double-click faces the front again. *Recolor all* repaints existing smoke, *Next stroke only* keeps it.
- **3D:** drag orbits (or draws in *Draw* view; Shift swaps the two), right-drag pans, scroll zooms. *Renderer* switches between screen-space and volume rendering.
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

- **2D / 2.5D:** `Fluid2D` is one stable-fluids grid (Stam 1999) at 160 × 107 cells with vorticity confinement (Fedkiw et al. 2001). Besides velocity and density it advects a **texture** field (brush noise carried by the flow), an **age** field (frames since the smoke left its source) and, in 2.5D, per-cell **RGB**, so strokes keep their own colors.
- **3D:** `Particles3D` follows a curl-noise velocity field (Bridson et al. 2007), so the smoke has no box to live in. Each particle carries the same texture and age values.

The **toon rules** are the same everywhere: density plus texture above a threshold becomes a flat silhouette; occlusion sampled toward the light picks one of three bands; the palette rotates hue warm in the light and cool in the shadow; age shifts the bands from warm and light to cool and grey; texture extremes pick up two side colors (mottle); density below its blurred neighborhood darkens (AO); fresh, dense smoke gets glowing ember veins. These rules exist three times, once per renderer:

| Renderer | Used by | Where the rules run |
| --- | --- | --- |
| `render/toon2d.js` | 2D, 2.5D | CPU, per pixel, with dirty rects so 24 cards stay interactive |
| `render/screenspace.js` + `toon-screen.frag.glsl` | 3D (default) | particles splatted to a screen grid on the CPU, shaded in GLSL |
| `render/volume.js` + `volume.frag.glsl` | 3D (alternative) | particles splatted to a fitted 48 × 64 × 48 voxel grid, ray-marched in GLSL |

The two 3D renderers read the same particles and the same style, which makes the "material" question testable: screen-space shading keeps the drawn-smoke look from any angle, while the ray-marched volume finds a true 3D surface and turns liquid.

### Style JSON

`styles/smoke-style.schema.json` describes the look with normalized values (0 to 1, plus hue shift in degrees and hex colors), independent of any renderer. `styles/presets.json` holds four presets (Incense, Arcane smoke bomb, Lavender blast, Dust). The schema is the single source of truth: `src/core/style.js` derives the defaults and the validator from it. Each module owns its own mapping to internal units, for example:

| Style field | `Fluid2D` | `Particles3D` |
| --- | --- | --- |
| `motion.rise` | buoyancy `0.008 × rise` per frame | rise speed `0.26 × rise` cells per frame |
| `motion.curl` | vorticity confinement `0.4 × curl` | curl-noise gain `8 × curl` |
| `motion.dissipation` | extra decay `0.025 × dissipation` | weight decay `0.04 × dissipation` |

### CPU now, GPU later

The 2D and 2.5D studies run the fluid and the shading on the CPU in plain JavaScript (typed arrays, no dependencies). That keeps the code readable and made iteration fast, and bounding-box simulation plus dirty-rect rendering plus adaptive scheduling (busy cards step every other frame with a doubled time step) keep many cards interactive. The structure is ready for a GPU port: `Fluid2D` maps onto ping-pong render targets in WebGL2 or compute passes in WebGPU, and `toon2d.js` already has a GLSL twin in `toon-screen.frag.glsl`.

## Project structure

```
src/
  core/      noise, hue-shift palette and palette cache, Style JSON load / validate / merge
  sim/       fluid2d, layer2d (fluid + strokes + embers), particles3d, emitters, embers, scheduler
  render/    toon2d (CPU), css-cards (2.5D compositor), screenspace + volume + ember-points (WebGL), shaders/*.glsl
  ui/        palette, controls (sliders bound to Style JSON), saved effects, tilt (2.5D), orbit (3D)
  apps/      brush-2d, cards-2_5d, volume-3d: entry points that only wire modules together
demos/       thin HTML pages and the landing page (the site root)
styles/      Style JSON schema and presets
tests/       Vitest: color / palette, style validation and merge, simulation, prototype parity
archive/     the original single-file prototypes, kept to show the process
```

The 2D and 2.5D apps share `Fluid2D`, `SmokeLayer2D`, `Emitter2D` and `ToonRenderer2D`; the only difference is how many layers there are and how they are composited.

### From prototypes to modules

The studies started as single-file HTML prototypes, iterated quickly in the browser (see `archive/`): 2D v10 is the brush, v11 adds a transparent canvas and CSS tilt, v12 to v15 develop the 2.5D cards (per-cell color, adaptive scheduling, bounding-box simulation), and 3D v1 / v2 are the volume and screen-space versions. This repository is the same work restructured into modules. `tests/parity.test.js` runs the archived v10, v15, 3D v1 and 3D v2 files in a Node vm next to the new modules, with the same scripted input and seeded random numbers, and requires **bit-identical** density, color, particle and pixel output.

Additions over the prototypes: the preset picker and Style JSON editor in the 2D and 2.5D studies (previously 3D only), saved effects shared across all three studies (saves from the prototypes are migrated), a Download button for Style JSON, and the renderer switch in 3D, which brings the v1 volume renderer back next to v2.

## Publish with GitHub Desktop

1. In GitHub Desktop choose **File → Add Local Repository…** and pick this folder.
2. Click **Publish repository**. Keep the name `smoke-studies` (or see the note below), and untick *Keep this code private* if you want free GitHub Pages hosting.
3. On github.com, open the repository and go to **Settings → Pages**. Under *Build and deployment*, set **Source: GitHub Actions**.
4. Go to the **Actions** tab. The first run of *Deploy to GitHub Pages* may have failed because Pages was not enabled yet; open it and choose **Re-run all jobs** (or run the workflow manually). Later pushes from GitHub Desktop deploy automatically.
5. The site appears at `https://<your-github-username>.github.io/smoke-studies/`.

The workflow (`.github/workflows/deploy.yml`) installs dependencies, runs the tests, builds with the repository name as base path, and deploys `dist/`. If you rename the repository, the deployed site follows automatically; for a local build under another name, run `BASE_PATH=/new-name/ npm run build`.

## References

Simulation

- Jos Stam, *Stable Fluids*, SIGGRAPH 1999. [Search](https://scholar.google.com/scholar?q=Stam+Stable+Fluids+1999)
- Ronald Fedkiw, Jos Stam, Henrik Wann Jensen, *Visual Simulation of Smoke* (vorticity confinement), SIGGRAPH 2001. [Search](https://scholar.google.com/scholar?q=Fedkiw+Stam+Jensen+Visual+Simulation+of+Smoke)
- Robert Bridson, Jim Hourihan, Marcus Nordenstam, *Curl-Noise for Procedural Fluid Flow*, SIGGRAPH 2007. [Search](https://scholar.google.com/scholar?q=Bridson+Curl-Noise+for+Procedural+Fluid+Flow)

Stylized smoke

- Abraham and Fussell, *Smoke Brush*. [Search](https://scholar.google.com/scholar?q=Smoke+Brush+Abraham+Fussell)
- *DualSmoke*: sketch-based smoke illustration design. [Search](https://scholar.google.com/scholar?q=DualSmoke+smoke+illustration)
- Byungsoo Kim, Vinicius C. Azevedo, Markus Gross, Barbara Solenthaler, *Transport-Based Neural Style Transfer for Smoke Simulations*, SIGGRAPH Asia 2019. [Search](https://scholar.google.com/scholar?q=Transport-Based+Neural+Style+Transfer+for+Smoke+Simulations)
- Ondřej Jamriška et al., *LazyFluids: Appearance Transfer for Fluid Animations*, SIGGRAPH 2015. [Search](https://scholar.google.com/scholar?q=LazyFluids+Appearance+Transfer+for+Fluid+Animations)

Visual references (observed, not included in this repository)

- Arcane FX on Sakugabooru: [#270219](https://www.sakugabooru.com/post/show/270219) (S2 smoke bomb), [#170624](https://www.sakugabooru.com/post/show/170624) (S1 wall collapse dust). No video or frames from the show are included here.
- Nello Fontani's stylized smoke tests in EmberGen (lavender smoke with hue-shifted shadows), the starting point for the *Lavender blast* preset.

## About this code

The ideas, visual direction, references and iteration are mine. The code was developed together with Claude (Anthropic's AI assistant): the prototypes were written in conversation, and Claude Code restructured them into this modular project, with the tests above checking that the behavior did not change.

## License

[MIT](LICENSE) © 2026 Anyang Zu
