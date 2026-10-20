# Chladni Plate Simulator

An interactive, in-browser simulator of **Chladni figures**: the patterns sand forms on a vibrating plate. Sand gets bounced off the parts of the plate that move and collects along the **nodal lines**, where the plate stays still. Change the driving frequency and the figure changes. When the frequency lands on one of the plate's natural modes (a resonance), the pattern turns sharp.

Plain HTML, CSS and JavaScript. The sources in `js/` are ES modules; they are bundled with three.js into one classic script, `dist/chladni.js`, so the app opens straight from disk.

## Features

- **Continuous frequency control** from 20 Hz to 5 kHz on a logarithmic slider. You can also type an exact value, nudge it by ±1%, or jump to the previous or next resonance.
- **Plate shapes**: square and circle.
- **Four visual layers**, each of which can be switched on or off:
  - **Sand particles**: up to 40,000 grains that random-walk off the moving areas and drift toward the nodes.
  - **Amplitude heatmap** of |u| (inferno-like colormap).
  - **Nodal lines**: the zero-level contour of the displacement.
  - **3D plate**: a slow-motion, orbitable view of the deformation.
- **Resonance meter**, plus a readout of the nearest mode and how far the current frequency is from it.
- **Auto sweep** that moves the frequency back and forth across the whole range on a log scale, at an adjustable speed in octaves per second.
- **Amplitude** and **damping** controls. Low damping gives sharp, narrow resonances. High damping widens them, so neighbouring modes blend together.
- **Sound**: a sine tone at the driving frequency, with a volume slider. The output level is capped for safety.
- Responsive layout. On desktop the controls sit in a side panel. On phones the panel moves below the plate.

## Controls and shortcuts

| Key | Action |
| --- | --- |
| `←` / `→` | Frequency −1% / +1% (hold `Shift` for ±10%) |
| `[` / `]` | Previous / next resonance |
| `Space` | Start / stop the auto sweep |
| `S` | Scatter the sand again |

Shortcuts do nothing while a text or number field has focus. Sliders and radio buttons keep their usual arrow-key behaviour.

Browsers only allow audio after a user gesture, so sound stays off until you turn on **Sound → Play tone**.

## Physics notes

The simulator uses an **analytic approximation** of the plate's vibration modes. It does not solve the plate equation numerically. The physics lives in `js/physics/` behind a small API (`computeField`, `findResonances`, `getModes`), so a numerical solver can replace it later without changes to the renderers.

Domain coordinates are `x, y ∈ [-1, 1]`. The circle is `x² + y² ≤ 1`.

**Square plate** (free edges, Chladni/Ritz-style approximation), with `X = (x+1)/2` and `Y = (y+1)/2`:

```
φ(x, y) = cos(mπX)·cos(nπY) + s·cos(nπX)·cos(mπY),   0 ≤ m ≤ n ≤ 12, s = ±1
f       = 16 Hz · (m² + n²) · (1 + 0.03·s)            (no split when m = n)
```

**Circular plate** (free-edge approximation):

```
φ(r, θ) = J_n(α_nk · r) · cos(nθ),   α_nk = k-th positive zero of J_n'
f       = 5 Hz · α_nk²,               n = 0..10, k = 1..6
```

**Driven response.** At driving frequency `f`, each mode `i` is weighted by the response of a damped oscillator, with `r = f / fᵢ`:

```
wᵢ = sgn(1 − r²) / sqrt((1 − r²)² + (2ζr)²)
```

The six strongest modes are summed into the displacement field `u` and normalised. The resonance meter shows `max|w|·2ζ`, which is 1 exactly on a mode.

**Sand.** Each grain takes a random step proportional to the local |u|, so it gets kicked where the plate moves. It also drifts down the gradient of |u|, which pulls it toward the nodes. Over time it settles on the nodal lines.

**3D view.** Real plates vibrate at hundreds of hertz, far too fast to see, so the 3D plate always oscillates at a slow 1.2 Hz.

## Run locally

Download or clone the repository and **double-click `index.html`**. No server needed.

## Development

After changing anything in `js/`, rebuild the bundle and commit `dist/chladni.js` along with your changes:

```bash
npm install
npm run build   # js/ + three.js → dist/chladni.js
npm test        # physics tests
```

## Deploy on GitHub Pages

1. Push the repository to GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then select the `main` branch and the `/ (root)` folder.
4. After a minute, the site is live at `https://<user>.github.io/<repo>/`.

The empty `.nojekyll` file stops Pages from running Jekyll on the files.

## File structure

```
index.html                 page markup, loads dist/chladni.js
css/style.css              dark theme, layout, custom controls
js/main.js                 bootstrap, render loop, wiring between modules
js/state.js                app state + subscribe
js/ui.js                   control panel bindings, readouts, keyboard shortcuts
js/audio.js                Web Audio sine-tone engine
js/physics/bessel.js       Bessel J_n, J_n' and zeros of J_n'
js/physics/modes.js        mode tables for square and circle plates
js/physics/field.js        driven field, resonance search, gradients
js/render/colormap.js      inferno-like colour LUT
js/render/view2d.js        2D compositor (plate, heatmap, nodal lines, sand)
js/render/sand.js          sand particle system
js/render/plate3d.js       Three.js vibrating plate
dist/chladni.js            built bundle (npm run build), what index.html loads
package.json               build/test scripts; pins esbuild and three
tests/physics.test.mjs     physics tests: node tests/physics.test.mjs
```

## Debug handle

For scripting and automated checks, the page exposes `window.chladni`:

```js
chladni.state               // live app state
chladni.field               // current Field object
chladni.sand                // SandSystem
chladni.setFrequency(f)
chladni.setShape('circle')
chladni.setLayer('nodal', true)
```
