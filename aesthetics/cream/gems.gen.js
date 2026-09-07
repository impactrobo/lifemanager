/**
 * C.R.E.A.M — chaos emerald web derivatives.
 *
 * Turns the Blender exports (`<colour>-twopiece-diamond.png`, 1080x1080 RGBA) into the small
 * WebP files the theme actually loads:  node aesthetics/cream/gems.gen.js
 *
 * Sits next to its output the way fx.ts sits next to fx.js and runic/runes.gen.js sits next to
 * its runes, and is never loaded by the app. The output .webp files ARE committed — GitHub
 * Pages does no build.
 *
 * Why this exists: the raw exports are ~770 KB each, 5.4 MB for the set, and about 75% of every
 * canvas is empty alpha because the stone only occupies a band across the middle. The Home tiles
 * render around 114 CSS px. So each file is
 *   1. cropped to the stone's real alpha bounds (drops the dead 75%),
 *   2. scaled to TARGET_W, comfortably ~3x the largest size it's ever drawn at,
 *   3. darkened with a soft scrim over the crown/table facet — the renders blow out to near
 *      white exactly where the tile's icon and label sit, and this is baked in rather than done
 *      with a masked ::after in CSS (which also means the tile fetches each gem ONCE, as a
 *      background, not twice),
 *   4. re-encoded as WebP.
 *
 * FORMAT: WebP (~25-35 KB each, ~190 KB for the set, vs ~900 KB as PNG). Supported everywhere
 * this app runs — iOS 14+ / 2020, every current browser. A brief scare made it look like WebKit
 * wouldn't paint these; that turned out to be first-load latency, not a paint bug (the phone
 * renders them fine given a moment). What DID matter from that pass and is kept: the theme
 * writes `url()` straight into each rule rather than through a `--gem-img` custom property
 * (cleaner, and `var()` inside `mask`/`background` shorthands is genuinely dicey in WebKit), and
 * the scrim is baked here instead of being a second image fetched as a CSS mask.
 *
 * It also prints a suggested `--gem-glow` per stone (that one IS still a custom property — it's
 * a plain colour, which every engine handles), averaged from that render's own most-saturated
 * pixels so the drop-shadow halo matches the rendered hue. Pasted into theme.css by hand.
 *
 * Chromium (a devDependency via Playwright) does the decode, resize, composite and PNG encode,
 * so this needs no image library. The `*-clear-diamond.png` set is deliberately left alone:
 * it's kept in the repo unused, for a future variant.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/** Longest edge of the emitted file. Tiles draw at ~114 CSS px; this is ~3.3x that. */
const TARGET_W = 380;
/** A couple of transparent pixels kept around the stone so drop-shadow() has something to bite. */
const PAD = 2;

const DIR = __dirname;
const COLOURS = ['green', 'yellow', 'magenta', 'red', 'cyan', 'blue', 'white'];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('about:blank');

  for (const colour of COLOURS) {
    const src = path.join(DIR, `${colour}-twopiece-diamond.png`);
    if (!fs.existsSync(src)) throw new Error(`missing source render: ${src}`);
    const b64 = fs.readFileSync(src).toString('base64');

    const out = await page.evaluate(async ({ dataUrl, targetW, pad }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();

      const full = document.createElement('canvas');
      full.width = img.width;
      full.height = img.height;
      const fg = full.getContext('2d');
      fg.drawImage(img, 0, 0);
      const data = fg.getImageData(0, 0, full.width, full.height).data;

      // --- one pass: alpha bounds, and the peak saturation present ---
      let minX = full.width, minY = full.height, maxX = -1, maxY = -1;
      const sat = (r, g, b) => {
        const mx = Math.max(r, g, b);
        return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
      };
      const usable = (r, g, b) => {
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return lum >= 40 && lum <= 232; // drop the near-black facets and the blown-out specular
      };
      let maxSat = 0;
      for (let y = 0; y < full.height; y++) {
        for (let x = 0; x < full.width; x++) {
          const i = (y * full.width + x) * 4;
          if (data[i + 3] === 0) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          if (!usable(r, g, b)) continue;
          const s = sat(r, g, b);
          if (s > maxSat) maxSat = s;
        }
      }
      // --- average only the pixels near peak saturation, for the glow colour ---
      // Averaging over the whole stone returns grey (green -> rgba(98,124,99)): these renders
      // carry a lot of white internal reflection. The halo has to be the hue you read.
      const satFloor = maxSat * 0.55;
      let rSum = 0, gSum = 0, bSum = 0, n = 0;
      for (let y = 0; y < full.height; y++) {
        for (let x = 0; x < full.width; x++) {
          const i = (y * full.width + x) * 4;
          if (data[i + 3] === 0) continue;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          if (!usable(r, g, b)) continue;
          if (sat(r, g, b) < satFloor) continue;
          rSum += r; gSum += g; bSum += b; n++;
        }
      }
      let glow = [255, 255, 255];
      if (n && maxSat > 0.12) {
        const avg = [rSum / n, gSum / n, bSum / n];
        const k = 235 / Math.max(...avg, 1); // lift toward the brightest channel so it looks lit
        glow = avg.map((c) => Math.round(Math.min(255, c * k)));
      }

      // --- crop + downscale in one draw ---
      const cropX = Math.max(0, minX - pad);
      const cropY = Math.max(0, minY - pad);
      const cropW = Math.min(full.width, maxX + 1 + pad) - cropX;
      const cropH = Math.min(full.height, maxY + 1 + pad) - cropY;
      const scale = Math.min(1, targetW / cropW);
      const outW = Math.round(cropW * scale);
      const outH = Math.round(cropH * scale);

      const small = document.createElement('canvas');
      small.width = outW;
      small.height = outH;
      const sg = small.getContext('2d');
      sg.imageSmoothingEnabled = true;
      sg.imageSmoothingQuality = 'high';
      sg.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, outW, outH);

      // --- bake the crown scrim ---
      // The table facet blows out to near-white right where the tile's icon + label land. Darken
      // a soft ellipse over the upper-middle of the stone, clipped to the stone's own alpha
      // (source-atop) so it never shows as a rectangle and never darkens the transparent
      // surround. Tuned by eye against the 114px tile — see t-*.png from the dev screenshots.
      sg.save();
      sg.globalCompositeOperation = 'source-atop';
      const cx = outW * 0.5, cy = outH * 0.4;
      const grad = sg.createRadialGradient(cx, cy, 0, cx, cy, outW * 0.5);
      grad.addColorStop(0, 'rgba(0,0,0,0.5)');
      grad.addColorStop(0.55, 'rgba(0,0,0,0.26)');
      grad.addColorStop(0.82, 'rgba(0,0,0,0)');
      sg.fillStyle = grad;
      sg.save();
      sg.scale(1, 0.62); // squash the circle into a wide ellipse over the crown
      sg.beginPath();
      sg.arc(cx, cy / 0.62, outW * 0.5, 0, Math.PI * 2);
      sg.fill();
      sg.restore();
      sg.restore();

      return {
        dataUrl: small.toDataURL('image/webp', 0.9),
        srcW: img.width, srcH: img.height,
        cropW, cropH, outW, outH, glow,
      };
    }, { dataUrl: 'data:image/png;base64,' + b64, targetW: TARGET_W, pad: PAD });

    if (!out.dataUrl.startsWith('data:image/webp')) {
      throw new Error('Chromium did not encode WebP — got ' + out.dataUrl.slice(0, 30));
    }
    const buf = Buffer.from(out.dataUrl.split(',')[1], 'base64');
    fs.writeFileSync(path.join(DIR, `gem-${colour}.webp`), buf);

    const before = fs.statSync(src).size, after = buf.length;
    const [r, g, b] = out.glow;
    console.log(
      `gem-${colour}.webp  ${out.srcW}x${out.srcH} -> crop ${out.cropW}x${out.cropH} -> ${out.outW}x${out.outH}  ` +
      `${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(1)} KB  (${(before / after).toFixed(1)}x)   ` +
      `--gem-glow: rgba(${r}, ${g}, ${b}, 0.75)`
    );
  }

  await browser.close();
})();
