import * as THREE from "three";

import { createRng } from "../core/rng.ts";

/** Procedural textures, drawn once on canvases so the board needs no image assets. */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const context = c.getContext("2d");
  if (!context) throw new Error("2D canvas unavailable");
  return [c, context];
}

function toTexture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(c);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Sprinkles single-pixel noise over a canvas, for fibre and pore detail. */
function speckle(
  context: CanvasRenderingContext2D,
  w: number,
  h: number,
  amount: number,
  seed: number,
): void {
  const { next: random } = createRng(seed);
  const image = context.getImageData(0, 0, w, h);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (random() - 0.5) * amount;
    data[i] = (data[i] ?? 0) + n;
    data[i + 1] = (data[i + 1] ?? 0) + n;
    data[i + 2] = (data[i + 2] ?? 0) + n;
  }
  context.putImageData(image, 0, 0);
}

/**
 * Long-grain wood running along U: a base colour, slow bands of lighter and darker
 * growth, then hundreds of thin wavy fibres.
 */
export function woodTexture(light: string, dark: string, seed: number): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;
  const [c, context] = canvas(w, h);
  const { next: random } = createRng(seed);
  const gradient = context.createLinearGradient(0, 0, 0, h);
  const bands = Array.from({ length: 8 }, () => (random() < 0.5 ? light : dark));
  // The last stop repeats the first, so the texture tiles across the grain too.
  [...bands, bands[0] ?? light].forEach((color, i) => gradient.addColorStop(i / 8, color));
  context.fillStyle = gradient;
  context.fillRect(0, 0, w, h);
  context.globalAlpha = 0.3;
  context.fillStyle = light;
  context.fillRect(0, 0, w, h);
  for (let i = 0; i < 420; i++) {
    const y0 = random() * h;
    const amp = 2 + random() * 6;
    // Whole waves per width, so the fibres meet themselves across the seam.
    const cycles = 1 + Math.floor(random() * 3);
    const phase = random() * Math.PI * 2;
    context.globalAlpha = 0.05 + random() * 0.22;
    context.strokeStyle = random() < 0.75 ? dark : light;
    context.lineWidth = 0.6 + random() * 2.2;
    for (const wrap of [-h, 0, h]) {
      context.beginPath();
      for (let x = 0; x <= w; x += 16) {
        const y = wrap + y0 + Math.sin((x / w) * cycles * Math.PI * 2 + phase) * amp;
        if (x === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }
  }
  // A few knots' worth of darker, wider streaks.
  for (let i = 0; i < 6; i++) {
    context.globalAlpha = 0.12;
    context.fillStyle = dark;
    context.beginPath();
    context.ellipse(random() * w, random() * h, 60 + random() * 120, 3 + random() * 5, 0, 0, 7);
    context.fill();
  }
  context.globalAlpha = 1;
  speckle(context, w, h, 14, seed + 1);
  return toTexture(c);
}

/**
 * Close-woven cloth: fine crossing fibres over a base, optionally mottled by `blots`
 * soft patches of light and shade.
 */
export function clothTexture(base: string, seed: number, blots = 90): THREE.CanvasTexture {
  const size = 512;
  const [c, context] = canvas(size, size);
  const { next: random } = createRng(seed);
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);
  for (let i = 0; i < blots; i++) {
    const r = 20 + random() * 70;
    const tone = random() < 0.5 ? "0,0,0" : "255,255,255";
    const x0 = random() * size;
    const y0 = random() * size;
    // Drawn on every neighbouring tile too, so a blot crossing an edge wraps round.
    for (const [x, y] of [-size, 0, size].flatMap((dx) =>
      [-size, 0, size].map((dy) => [x0 + dx, y0 + dy] as const),
    )) {
      const blot = context.createRadialGradient(x, y, 0, x, y, r);
      blot.addColorStop(0, `rgba(${tone},0.035)`);
      blot.addColorStop(1, `rgba(${tone},0)`);
      context.fillStyle = blot;
      context.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  for (let i = 0; i < 2600; i++) {
    const x = random() * size;
    const y = random() * size;
    const a = random() * Math.PI;
    const l = 2 + random() * 6;
    context.strokeStyle = random() < 0.5 ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.07)";
    context.lineWidth = 0.7;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    context.stroke();
  }
  speckle(context, size, size, 18, seed + 1);
  return toTexture(c);
}

/**
 * A radial falloff from `inner` at the centre to `outer` at `reach` (a fraction of the
 * width), flat beyond it.
 */
export function vignetteTexture(inner: string, outer: string, reach = 0.72): THREE.CanvasTexture {
  const size = 512;
  const [c, context] = canvas(size, size);
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.04,
    size / 2,
    size / 2,
    size * reach,
  );
  gradient.addColorStop(0, inner);
  gradient.addColorStop(1, outer);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = toTexture(c);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/** Pixels per world unit for the soft shadow textures below. */
const SHADE_PX = 48;

/**
 * Soft darkening along the inside edges of a `w` by `d` well, fading out over `fade`
 * world units, as if the walls around it held back the light.
 */
export function wellShadeTexture(w: number, d: number, fade: number): THREE.CanvasTexture {
  const [c, context] = canvas(Math.round(w * SHADE_PX), Math.round(d * SHADE_PX));
  const far = c.width * 4;
  // A ring around the canvas casts its blurred shadow inwards; the ring itself is offscreen.
  context.shadowColor = "#000";
  context.shadowBlur = fade * SHADE_PX;
  context.shadowOffsetX = far;
  context.beginPath();
  context.rect(-far - c.width, -c.height, c.width * 3, c.height * 3);
  context.rect(-far, 0, c.width, c.height);
  context.fill("evenodd");
  return toTexture(c, false);
}

/** A blurred dark rectangle: `w` by `d`, plus `spread` world units of falloff on every side. */
export function dropShadowTexture(w: number, d: number, spread: number): THREE.CanvasTexture {
  const [c, context] = canvas(
    Math.round((w + spread * 2) * SHADE_PX),
    Math.round((d + spread * 2) * SHADE_PX),
  );
  const far = c.width * 4;
  context.shadowColor = "#000";
  context.shadowBlur = spread * SHADE_PX;
  context.shadowOffsetX = far;
  context.fillRect(
    spread * SHADE_PX * 0.5 - far,
    spread * SHADE_PX * 0.5,
    (w + spread) * SHADE_PX,
    (d + spread) * SHADE_PX,
  );
  return toTexture(c, false);
}

/** A round soft shadow: dark in the middle, clear at the edge. */
export function contactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const [c, context] = canvas(size, size);
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(0,0,0,1)");
  gradient.addColorStop(0.6, "rgba(0,0,0,0.85)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return toTexture(c, false);
}

/**
 * Polished stone for a checker face: a base colour with soft drifting veins of `vein`,
 * drawn as several faint passes so they blur into the base.
 */
export function stoneTexture(base: string, vein: string, seed: number): THREE.CanvasTexture {
  const size = 512;
  const [c, context] = canvas(size, size);
  const { next: random } = createRng(seed);
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);
  context.strokeStyle = vein;
  context.lineCap = "round";
  for (let i = 0; i < 14; i++) {
    let x = random() * size;
    let y = random() * size;
    let angle = random() * Math.PI * 2;
    const points: Array<[number, number]> = [[x, y]];
    for (let step = 0; step < 40; step++) {
      angle += (random() - 0.5) * 0.6;
      x += Math.cos(angle) * 12;
      y += Math.sin(angle) * 12;
      points.push([x, y]);
    }
    for (const [width, alpha] of [
      [18, 0.04],
      [8, 0.06],
      [2, 0.12],
    ] as const) {
      context.globalAlpha = alpha * (0.5 + random());
      context.lineWidth = width * (0.5 + random());
      context.beginPath();
      points.forEach(([px, py], k) => (k === 0 ? context.moveTo(px, py) : context.lineTo(px, py)));
      context.stroke();
    }
  }
  context.globalAlpha = 1;
  speckle(context, size, size, 6, seed + 1);
  return toTexture(c);
}
