/**
 * C.R.E.A.M — chaos emerald web derivatives.
 *
 * Turns the Blender exports (`<colour>-twopiece-diamond.png`, 1080x1080 RGBA) into the small
 * WebP files the theme actually loads:  node aesthetics/cream/gems.gen.js
 *
 * Sits next to its output the way fx.ts sits next to fx.js and runic/runes.gen.js sits next to
 * its runes, and is never loaded by the app. The .webp files ARE committed — GitHub Pages does
 * no build.
 *
 * Why this exists: the raw exports are ~770 KB each, 5.4 MB for the set, and about 75% of every
 * canvas is empty alpha because the stone only occupies a band across the middle. The Home tiles
 * render around 110 CSS px. So each file is
 *   1. cropped to the stone's real alpha bounds (drops the dead 75%),
 *   2. scaled to TARGET_W, comfortably 2x the largest size it's ever drawn at,
 *   3. re-encoded as WebP.
 * That lands each one well under 100 KB without any visible loss at tile size.
 *
 * It also prints a suggested `--gem-glow` per stone, averaged from that render's own bright
 * pixels, so the drop-shadow halo in theme.css matches the actual rendered colour rather than a
 * hand-guessed one. Those values are pasted into theme.css by hand — the CSS is not generated.
 *
 * Chromium (already a devDependency via Playwright) does the decode, resize and WebP encode, so
 * this needs no image library. The `*-clear-diamond.png` set is deliberately left alone: it's
 * kept in the repo unused, for a future variant.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/** Longest edge of the emitted file. Tiles draw at ~110 CSS px, so this is ~2x a 2x-DPR draw. */
const TARGET_W = 440;
/** WebP quality. 0.9 is indistinguishable from the source at tile size; 0.8 shows facet banding. */
const QUALITY = 0.9;
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

    const out = await page.evaluate(async ({ dataUrl, targetW, quality, pad }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();

      const full = document.createElement('canvas');
      full.width = img.width;
      full.height = img.height;
      const fg = full.getContext('2d');
      fg.drawImage(img, 0, 0);
      const data = fg.getImageData(0, 0, full.width, full.height).data;

      // 1. alpha bounds — anything with a non-zero alpha is part of the stone
      let minX = full.width, minY = full.height, maxX = -1, maxY = -1;
      // 2. and, in the same pass, find the most saturated pixel present
      const sat = (r, g, b) => {
        const mx = Math.max(r, g, b);
        return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
      };
      const usable = (r, g, b) => {
        // Skip the near-black facets and the blown-out white specular — the halo wants the
        // stone's hue, and either extreme only drags the average toward grey.
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return lum >= 40 && lum <= 232;
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
      // 3. average only the pixels near that peak saturation. Averaging over ALL of the stone
      // returns grey — these renders carry a lot of white internal reflection, and a green gem
      // came out rgba(98,124,99). The halo has to be the hue you actually read the stone as.
      // White has no hue to find, so it falls through to the neutral below.
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
      const cropX = Math.max(0, minX - pad);
      const cropY = Math.max(0, minY - pad);
      const cropW = Math.min(full.width, maxX + 1 + pad) - cropX;
      const cropH = Math.min(full.height, maxY + 1 + pad) - cropY;

      // 3. crop + downscale in one draw
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

      // Lift the average toward its own brightest channel — the mean of a stone's mid-tones is
      // the right HUE but reads muddy as a halo, and a glow should look lit.
      let glow = [255, 255, 255];
      if (n && maxSat > 0.12) {
        const avg = [rSum / n, gSum / n, bSum / n];
        const k = 235 / Math.max(...avg, 1);
        glow = avg.map((c) => Math.round(Math.min(255, c * k)));
      }
      return {
        dataUrl: small.toDataURL('image/webp', quality),
        srcW: img.width, srcH: img.height,
        cropW, cropH, outW, outH, glow,
      };
    }, { dataUrl: 'data:image/png;base64,' + b64, targetW: TARGET_W, quality: QUALITY, pad: PAD });

    if (!out.dataUrl.startsWith('data:image/webp')) {
      throw new Error('Chromium did not encode WebP — got ' + out.dataUrl.slice(0, 30));
    }
    const buf = Buffer.from(out.dataUrl.split(',')[1], 'base64');
    const dest = path.join(DIR, `gem-${colour}.webp`);
    fs.writeFileSync(dest, buf);

    const before = fs.statSync(src).size, after = buf.length;
    const [r, g, b] = out.glow;
    console.log(
      `gem-${colour}.webp  ${out.srcW}x${out.srcH} -> crop ${out.cropW}x${out.cropH} -> ${out.outW}x${out.outH}  ` +
      `${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(1)} KB  ` +
      `(${(before / after).toFixed(1)}x)   --gem-glow: rgba(${r}, ${g}, ${b}, 0.75)`
    );
  }

  await browser.close();
})();
