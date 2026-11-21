import type { Outcome } from "./crestArt.ts";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds lived, and seconds it may live. */
  age: number;
  life: number;
  size: number;
  hue: number;
  /** Sparks are drawn as streaks along their motion; embers and ash as soft dots. */
  streak: boolean;
  /** Ash sways from side to side as it falls. */
  sway: number;
  /** How quickly the air slows it, per second. */
  drag: number;
}

export interface Sparks {
  /** Starts the ambient drift for this outcome; nothing shows until then. */
  start(outcome: Outcome): void;
  /** One explosion from a point in viewport pixels. */
  burst(x: number, y: number): void;
  stop(): void;
}

const MAX = 600;

/**
 * Particles over the result screen: a burst when the crest lands, then embers rising for the
 * winner or ash falling for the loser. Drawn on one canvas that fills the window.
 */
export function createSparks(canvas: HTMLCanvasElement): Sparks {
  const context = canvas.getContext("2d");
  let particles: Particle[] = [];
  let outcome: Outcome = "victory";
  let frame = 0;
  let last = 0;
  let spawnDebt = 0;

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const add = (particle: Particle) => {
    if (particles.length < MAX) particles.push(particle);
  };

  const ambient = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (outcome === "victory") {
      add({
        x: Math.random() * w,
        y: h + 10,
        vx: (Math.random() - 0.5) * 20,
        vy: -(40 + Math.random() * 90),
        age: 0,
        life: 4 + Math.random() * 4,
        size: 1 + Math.random() * 2.4,
        hue: 32 + Math.random() * 18,
        streak: false,
        sway: Math.random() * Math.PI * 2,
        drag: 0,
      });
    } else {
      add({
        x: Math.random() * w,
        y: -10,
        vx: (Math.random() - 0.5) * 10,
        vy: 18 + Math.random() * 30,
        age: 0,
        life: 8 + Math.random() * 6,
        size: 1 + Math.random() * 2.2,
        // Mostly grey ash, now and then a dying red ember.
        hue: Math.random() < 0.15 ? 8 : -1,
        streak: false,
        sway: Math.random() * Math.PI * 2,
        drag: 0,
      });
    }
  };

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    if (!context) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    spawnDebt += dt * (outcome === "victory" ? 28 : 22);
    while (spawnDebt >= 1) {
      ambient();
      spawnDebt -= 1;
    }
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    context.globalCompositeOperation = outcome === "victory" ? "lighter" : "source-over";
    const alive: Particle[] = [];
    for (const p of particles) {
      p.age += dt;
      if (p.age >= p.life) continue;
      alive.push(p);
      const px = p.x;
      const py = p.y;
      p.vx *= 1 - p.drag * dt;
      p.vy *= 1 - p.drag * dt;
      if (p.streak) {
        // Sparks fly out, slow in the air and fall.
        p.vy += 260 * dt;
      } else {
        p.sway += dt * 1.5;
        p.vx += Math.sin(p.sway) * 14 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const fade = 1 - p.age / p.life;
      // Ambient particles fade in too, so none pops into view.
      const alpha = p.streak ? fade : Math.min(1, p.age * 2) * fade;
      if (p.streak) {
        context.strokeStyle = `hsla(${p.hue}, 100%, ${60 + 30 * fade}%, ${alpha})`;
        context.lineWidth = p.size;
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(px - (p.x - px) * 2, py - (p.y - py) * 2);
        context.lineTo(p.x, p.y);
        context.stroke();
      } else {
        context.fillStyle =
          p.hue < 0
            ? `hsla(220, 8%, 70%, ${alpha * 0.55})`
            : `hsla(${p.hue}, 100%, 62%, ${alpha * 0.85})`;
        context.beginPath();
        context.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        context.fill();
      }
    }
    particles = alive;
  };

  window.addEventListener("resize", resize);

  return {
    start(next) {
      outcome = next;
      particles = [];
      spawnDebt = 0;
      resize();
      cancelAnimationFrame(frame);
      last = performance.now();
      frame = requestAnimationFrame(tick);
    },
    burst(x, y) {
      const victory = outcome === "victory";
      const count = victory ? 160 : 70;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = victory ? 250 + Math.random() * 650 : 80 + Math.random() * 260;
        add({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - (victory ? 120 : 0),
          age: 0,
          life: victory ? 0.8 + Math.random() * 1.1 : 1.2 + Math.random() * 1.2,
          size: victory ? 1.4 + Math.random() * 2.2 : 1.5 + Math.random() * 2.5,
          hue: victory ? 30 + Math.random() * 25 : -1,
          streak: victory,
          sway: 0,
          drag: victory ? 1.6 : 3,
        });
      }
    },
    stop() {
      cancelAnimationFrame(frame);
      particles = [];
      context?.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
