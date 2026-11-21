import { gsap } from "gsap";
import type * as THREE from "three";

import type { Vec3 } from "./layout.ts";

const MOVE_TIME = 0.4;

function restOf(checker: THREE.Object3D): Vec3 {
  return checker.userData.rest as Vec3;
}

/** Sets where a checker belongs. Every animation ends there, so interrupted tweens self-heal. */
export function setRest(checker: THREE.Object3D, rest: Vec3): void {
  checker.userData.rest = rest;
}

/** Arcs a checker to its rest position. Returns the time at which it lands. */
export function hopToRest(checker: THREE.Object3D, delay = 0, height = 1.3): number {
  const rest = restOf(checker);
  const pos = checker.position;
  gsap.killTweensOf(pos);
  gsap.to(pos, { x: rest.x, z: rest.z, duration: MOVE_TIME, delay, ease: "power1.inOut" });
  gsap
    .timeline({ delay })
    .to(pos, {
      y: Math.max(pos.y, rest.y) + height,
      duration: MOVE_TIME / 2,
      ease: "power2.out",
    })
    .to(pos, { y: rest.y, duration: MOVE_TIME / 2, ease: "power2.in" });
  return delay + MOVE_TIME;
}

/** Raises or lowers a checker to show it is selected. */
export function setLifted(checker: THREE.Object3D, lifted: boolean): void {
  const rest = restOf(checker);
  gsap.to(checker.position, {
    y: rest.y + (lifted ? 0.35 : 0),
    duration: 0.15,
    ease: "power2.out",
    overwrite: "auto",
  });
}

/** Slams the whole board down and lets it ring. */
export function shake(world: THREE.Object3D, strength = 1, delay = 0): void {
  gsap.killTweensOf([world.position, world.rotation]);
  world.position.set(0, 0, 0);
  world.rotation.set(0, 0, 0);
  const tilt = (Math.random() < 0.5 ? -1 : 1) * 0.025 * strength;
  gsap
    .timeline({ delay })
    .to(world.position, { y: -0.3 * strength, duration: 0.06, ease: "power2.in" })
    .to(world.position, { y: 0, duration: 0.7, ease: "elastic.out(1.2, 0.25)" });
  gsap
    .timeline({ delay })
    .to(world.rotation, { z: tilt, x: 0.02 * strength, duration: 0.06, ease: "power2.in" })
    .to(world.rotation, { z: 0, x: 0, duration: 0.8, ease: "elastic.out(1, 0.2)" });
}

/** Tosses every checker into the air and lets it bounce back onto its spot. */
export function tossAll(checkers: THREE.Object3D[], strength = 1, delay = 0): void {
  for (const checker of checkers) {
    const rest = restOf(checker);
    const pos = checker.position;
    const start = delay + Math.random() * 0.07;
    const height = (0.5 + Math.random() * 0.6) * strength;
    gsap.killTweensOf([pos, checker.rotation]);
    gsap
      .timeline({ delay: start })
      .to(pos, { y: rest.y + height, x: rest.x, z: rest.z, duration: 0.16, ease: "power2.out" })
      .to(pos, { y: rest.y, duration: 0.45, ease: "bounce.out" });
    gsap
      .timeline({ delay: start })
      .to(checker.rotation, {
        x: (Math.random() - 0.5) * 0.5,
        z: (Math.random() - 0.5) * 0.5,
        duration: 0.16,
      })
      .to(checker.rotation, { x: 0, z: 0, duration: 0.3, ease: "power2.in" });
  }
}
