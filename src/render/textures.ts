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
  for (let i = 0; i <= 8; i++) gradient.addColorStop(i / 8, random() < 0.5 ? light : dark);
  context.fillStyle = gradient;
  context.fillRect(0, 0, w, h);
  context.globalAlpha = 0.5;
  context.fillStyle = light;
  context.fillRect(0, 0, w, h);
  for (let i = 0; i < 420; i++) {
    const y0 = random() * h;
    const amp = 2 + random() * 6;
    const freq = (1 + random() * 3) / w;
    const phase = random() * Math.PI * 2;
    context.globalAlpha = 0.05 + random() * 0.22;
    context.strokeStyle = random() < 0.75 ? dark : light;
    context.lineWidth = 0.6 + random() * 2.2;
    context.beginPath();
    for (let x = 0; x <= w; x += 16) {
      const y = y0 + Math.sin(x * freq * Math.PI * 2 + phase) * amp;
      if (x === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
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

/** Close-woven cloth: a soft mottled base with fine crossing fibres. */
export function clothTexture(base: string, seed: number): THREE.CanvasTexture {
  const size = 512;
  const [c, context] = canvas(size, size);
  const { next: random } = createRng(seed);
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    const r = 20 + random() * 70;
    const x = random() * size;
    const y = random() * size;
    const blot = context.createRadialGradient(x, y, 0, x, y, r);
    const tone = random() < 0.5 ? "0,0,0" : "255,255,255";
    blot.addColorStop(0, `rgba(${tone},0.05)`);
    blot.addColorStop(1, `rgba(${tone},0)`);
    context.fillStyle = blot;
    context.fillRect(x - r, y - r, r * 2, r * 2);
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
