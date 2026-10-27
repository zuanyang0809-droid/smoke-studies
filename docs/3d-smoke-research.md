# Why the 3D study read as liquid, and what makes stylized 3D smoke read as smoke

A short research pass before rebuilding study 03. The first two 3D versions (archive `3d/smoke-brush-3d-v1.html` and `v2.html`, still available behind the *Renderer* switch) use the same hand-drawn rules as the 2D study, but people see liquid, not smoke. This note collects why, what the references do differently, and what was built.

## What the old versions do

- **Motion:** unbounded curl-noise particles (Bridson et al. 2007) with buoyancy and short impulses from fast strokes. There is no pressure solve and no interaction between particles: every particle follows the same smooth, procedural velocity field.
- **v2 screen-space:** particles are splatted into a screen grid with a cone kernel, then shaded in 2D with the toon rules (threshold, three bands from occlusion toward the light, hue shift, mottle, AO, ember core).
- **v1 volume:** particles are splatted into a fitted 48 × 64 × 48 voxel grid, blurred, and ray-marched to the first density iso-surface, which is shaded with the same bands.

## Why it reads as liquid

1. **A hard iso-surface.** Both renderers turn density into a single opaque silhouette at one threshold. A sharp boundary with nothing behind it is the visual signature of a liquid (or a gel). Smoke has no surface; you see *into* it.
2. **Smooth, blobby splats.** Every particle contributes the same round kernel, and v1 blurs the voxels on top of that. Unions of round kernels make metaballs, which read as droplets and goo.
3. **Uniform thickness and opacity.** Opacity is the same everywhere inside the silhouette (`opacity` 0.92), so thin wisps and the dense core look equally solid. Real smoke and good stylized smoke always have a thin, see-through fringe around a denser body.
4. **No turbulent filaments.** Curl noise is smooth and divergence-free, but it is a *given* field: particles do not stretch each other, roll up at shear layers, or form thin sheets. The motion looks like a viscous fluid being stirred.
5. **Opaque self-lit surfaces.** Light and shadow bands come from a probe a few cells toward the light, like a surface normal. There is no light transport through the volume, so the shading behaves like a lit solid with a toon ramp.
6. **No expansion.** Puffs keep their size as they rise, and fade only by weight. Smoke expands and thins as it rises, which is one of the strongest cues that it is a gas.

## What makes stylized volumetric smoke read as smoke

- **Translucency with a density gradient.** A smoke shape is a stack of soft layers: a dense core, a semi-transparent body and a thin rim you can see through. Opacity follows accumulated density along the view ray (Beer–Lambert), not a single threshold.
- **Self-shadowing.** Light is absorbed on its way *into* the volume, so the side away from the light and the inside of folds go dark, while thin edges facing the light glow. This is what separates a gas from a lit surface.
- **Wispy, turbulent edges.** Edges break into filaments and curls at a scale smaller than the main shape. Simulations get this from vorticity confinement (Fedkiw, Stam, Jensen 2001), which puts back the small swirls that numerical damping removes, and from added sub-grid detail (Wavelet Turbulence, Kim, Thürey, James, Gross 2008).
- **Stretched filaments from real fluid motion.** A pressure-projected velocity field with buoyancy creates rising plumes, mushroom caps and rolled-up vortex rings by itself. Sharp advection (MacCormack instead of plain semi-Lagrangian) keeps those filaments from blurring away.
- **Expansion and dissipation.** Hot fresh smoke rises fast, cools, slows and spreads; density thins with age.
- **Rim light.** Back-lit thin edges are brighter than the body, a cue stylized FX (Arcane, Spider-Verse) exaggerate.

## How stylized tools keep it graphic

- **EmberGen.** Nello Fontani's 2D-look explosion breakdown (80.lv) uses the scene style *colored thin strokes* with **low quantization**, so the palette has few flat shades. It also uses large voxels, simple shapes, density remapping, strong scene AO and a high **smoke dilate** to merge small details into bold masses. The quantization is applied to *lighting through a real volume*, so the result stays translucent and layered.
- **Arcane and Spider-Verse.** Both blend hand-drawn 2D FX with 3D. Spider-Verse FX (Pav Grochola and team, SIGGRAPH 2019) art-directed simulations with hand-drawn line work and stylized rendering, because the simulation alone did not give the look. The common thread: few flat value steps, hue-shifted shadows, a lighter rim and opacity in clear steps, not continuous gradients.
- **Kuwahara or posterize passes** in compositing (another 80.lv EmberGen breakdown) flatten a real volumetric render into painted shapes.

## Real-time on the web

Pavel Dobryakov's *WebGL Fluid Simulation* shows a stable-fluids solver running entirely on the GPU in the browser, in 2D: advection, vorticity confinement, divergence, Jacobi pressure and gradient subtraction as fragment-shader passes over ping-pong textures. In 3D, the same passes run on a volume stored as a 2D **texture atlas** of z slices (a "flat 3D texture"), which WebGL can render into in one draw call per pass.

## Decision

A full GPU fluid is feasible in WebGL2, so study 03 now runs one:

- **Simulation** (`src/sim/fluid3d.js`): 64 × 96 × 64 voxels stored as an atlas of half-float textures. Per step: splat sources (brush, living strokes, impulses) with point sprites, then buoyancy from temperature and density, vorticity confinement plus a little noise turbulence, semi-Lagrangian velocity advection, expansion from heat in the divergence, 20 Jacobi pressure iterations and gradient subtraction. Density, temperature, advected brush texture and age are carried with **MacCormack** advection (clamped). The domain is a box that **moves to follow the strokes**, so you can draw anywhere in view; boundaries are open.
- **Lighting** (`src/render/smoke-volume.js`, on the frame step): for each voxel, transmittance toward the light (a short light march, Beer–Lambert) and an ambient term from six short marches.
- **Rendering:** a ray march accumulates translucent density front to back (Beer–Lambert). It keeps the opacity and the opacity-weighted light, texture and age along the ray, and then stylizes:
  - light is quantized into the same three hue-shifted bands as the 2D study (the advected brush texture perturbs the band edges);
  - opacity is posterized into three levels, so the smoke is a thin rim, a translucent body and a dense core instead of one surface;
  - the thin outer level gets a rim light;
  - age tint, mottle, AO and ember core follow the 2D rules.
- **Embers** ride a sparse set of curl-noise tracers that are born with the smoke.

The old particle renderers stay behind the *Renderer* switch, which keeps the comparison that started the series.

## References

- Jos Stam, *Stable Fluids*, SIGGRAPH 1999.
- Ronald Fedkiw, Jos Stam, Henrik Wann Jensen, *Visual Simulation of Smoke*, SIGGRAPH 2001 (vorticity confinement).
- Robert Bridson, Jim Hourihan, Marcus Nordenstam, *Curl-Noise for Procedural Fluid Flow*, SIGGRAPH 2007.
- Andrew Selle, Ronald Fedkiw, ByungMoon Kim, Yingjie Liu, Jarek Rossignac, *An Unconditionally Stable MacCormack Method*, Journal of Scientific Computing 2008.
- Theodore Kim, Nils Thürey, Doug James, Markus Gross, *Wavelet Turbulence for Fluid Simulation*, SIGGRAPH 2008. [Project page](https://www.cs.cornell.edu/~tedkim/wturb)
- *Making Anime-Inspired Stylized 3D Explosions with JangaFX's EmberGen* (Nello Fontani), 80.lv. [Article](https://80.lv/articles/making-anime-inspired-stylized-3d-explosions-with-jangafx-s-embergen/)
- *How to Achieve a 2D Look with 3D Smoke*, 80.lv. [Article](https://80.lv/articles/how-to-achieve-a-2d-look-with-3d-smoke)
- *Spider-Verse: realism and design at SIGGRAPH*, fxphd. [Article](https://www.fxphd.com/fxblog/spider-verse-at-siggraph/)
- Pavel Dobryakov, *WebGL Fluid Simulation*. [GitHub](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation)
