import { gsap } from "gsap";
import * as THREE from "three";

import { POINT_COUNT } from "../core/board.ts";
import { box, flat, mitredFrame, shade, triangle } from "./boardParts.ts";
import {
  BAR_W,
  CHECKER_H,
  CHECKER_R,
  FIELD_HALF_D,
  FIELD_HALF_W,
  TRAY_W,
  TRAY_X,
  type Vec3,
} from "./layout.ts";
import {
  clothTexture,
  dropShadowTexture,
  glowRingTexture,
  vignetteTexture,
  wellShadeTexture,
  woodTexture,
} from "./textures.ts";

const RIM = 0.5;
const RIM_H = 0.3;
const BASE_H = 0.5;
const TRAY_WALL = 0.16;

/** World units covered by one repeat of a texture, so grain and weave keep one scale. */
function tiled(texture: THREE.Texture, u: number, v = u): THREE.Texture {
  texture.repeat.set(1 / u, 1 / v);
  return texture;
}

// The grain canvas is twice as long as it is wide, so it covers 8 by 4 units.
const walnut = tiled(woodTexture("#86552f", "#3a2010", 11), 8, 4);
const wood = new THREE.MeshPhysicalMaterial({
  map: walnut,
  bumpMap: walnut,
  bumpScale: 1.2,
  roughness: 0.42,
  clearcoat: 0.35,
  clearcoatRoughness: 0.22,
  // The studio room is neutral grey; too much of it turns the walnut cold.
  envMapIntensity: 0.4,
});
const brass = new THREE.MeshStandardMaterial({ color: 0xc09a4c, metalness: 1, roughness: 0.22 });
const weave = tiled(clothTexture("#d8d8d8", 21, 0), 3);
const felt = new THREE.MeshStandardMaterial({
  color: 0x1f5c40,
  map: weave,
  bumpMap: weave,
  bumpScale: 0.8,
  roughness: 1,
});
const trayFeltMaterial = felt.clone();
trayFeltMaterial.color.set(0x15412f);
const plainWeave = tiled(clothTexture("#d8d8d8", 22, 0), 3);
const pointMaterial = (color: number) =>
  new THREE.MeshStandardMaterial({
    color,
    map: plainWeave,
    bumpMap: plainWeave,
    bumpScale: 0.6,
    roughness: 0.8,
  });
const pointColors = [pointMaterial(0xcaa76d), pointMaterial(0x6a1c1a)] as const;
/** A fine gilt cord laid under every point, so its edges read clean against the felt. */
const piping = new THREE.MeshStandardMaterial({ color: 0x8c6a38, roughness: 0.6, metalness: 0.3 });

/** Fraction of the halo's radius where its light peaks: just outside the checker's rim. */
const HALO_PEAK = 0.76;
/** Where a selected checker can go: bright mint, far from every colour on the board. */
const TARGET_COLOR = 0x35ffb0;
/** Which checkers can move: a warm amber halo, readable on both checker colours. */
const SOURCE_COLOR = 0xff9a30;

const overlay = (color: number, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
const targetFill = overlay(TARGET_COLOR, 0.5);
const targetSpot = overlay(TARGET_COLOR, 0.9);
const targetEdge = overlay(0xffffff, 0.95);
const sourceRing = overlay(SOURCE_COLOR, 1);
sourceRing.map = glowRingTexture(HALO_PEAK);
sourceRing.blending = THREE.AdditiveBlending;
// One slow pulse shared by every hint, so they draw the eye without flickering.
for (const [material, low] of [
  [targetFill, 0.22],
  [targetSpot, 0.45],
  [sourceRing, 0.5],
] as const) {
  gsap.to(material, { opacity: low, duration: 0.7, ease: "sine.inOut", yoyo: true, repeat: -1 });
}

const MAX_TARGETS = 8;
const MAX_SOURCES = 16;

/** A flat disc with a white rim, marking the exact spot a checker would land on. */
function targetMarker(): THREE.Group {
  const marker = new THREE.Group();
  const spot = new THREE.Mesh(new THREE.CircleGeometry(CHECKER_R * 0.92, 40), targetSpot);
  const edge = new THREE.Mesh(
    new THREE.RingGeometry(CHECKER_R * 0.92, CHECKER_R * 1.12, 40),
    targetEdge,
  );
  marker.add(spot, edge);
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  return marker;
}

/** Outer radius of the halo under a movable checker. */
const HALO_R = CHECKER_R * 1.4;
/** A soft pool of light under a checker that is able to move, glowing out round its rim. */
function sourceMarker(): THREE.Mesh {
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(HALO_R * 2, HALO_R * 2), sourceRing);
  halo.rotation.x = -Math.PI / 2;
  halo.visible = false;
  return halo;
}

export interface BoardHints {
  /** Rest positions of the top checker on every stack that can move. */
  sources: Vec3[];
  /** Points the selected checker can reach, each with the spot it would land on. */
  /** `occupied`: an opposing checker sits on the spot and would be hit. */
  targets: Array<{ point: number; at: Vec3; occupied: boolean }>;
  /** Whether the selected checker can be borne off. */
  off: boolean;
}

export interface BoardView {
  group: THREE.Group;
  /** Shows what the player can do right now. Pass nothing to clear every hint. */
  setHints: (hints?: BoardHints) => void;
}

export function createBoard(): BoardView {
  const group = new THREE.Group();
  const outerW = (FIELD_HALF_W + RIM) * 2;
  const outerD = (FIELD_HALF_D + RIM) * 2;
  const fieldW = FIELD_HALF_W * 2;
  const fieldD = FIELD_HALF_D * 2;

  // Stops just short of the felt, so it never shadows the playfield it holds up.
  const base = box(fieldW + 0.2, BASE_H - 0.03, fieldD + 0.2, wood);
  base.position.y = -BASE_H / 2 - 0.015;
  const surface = box(fieldW, 0.02, fieldD, felt);
  surface.position.y = -0.01;
  surface.castShadow = false;
  const bar = box(BAR_W, 0.03, fieldD, wood, true);
  bar.position.y = -0.001;
  bar.castShadow = false;
  const rails = mitredFrame(
    { cx: 0, w: outerW, d: outerD, width: RIM, bottom: -BASE_H, top: RIM_H },
    wood,
  );
  group.add(base, surface, bar, rails);

  // Brass stringing: down both edges of the bar, and round the top of the rails.
  for (const s of [-1, 1]) {
    group.add(flat(0.025, fieldD, brass, { x: (s * (BAR_W - 0.1)) / 2, y: 0.016, z: 0 }));
    group.add(
      flat(fieldW + 0.26, 0.04, brass, { x: 0, y: RIM_H + 0.001, z: s * (FIELD_HALF_D + 0.13) }),
    );
    group.add(
      flat(0.04, fieldD + 0.26, brass, { x: s * (FIELD_HALF_W + 0.13), y: RIM_H + 0.001, z: 0 }),
    );
  }

  // Each half of the playfield sits in a well: shade it in along the walls.
  const halfW = FIELD_HALF_W - BAR_W / 2;
  const wellShade = shade(wellShadeTexture(halfW, fieldD, 0.45), 0.52);
  // And the lamp over the table lights the middle of the field more than its corners.
  const pool = shade(vignetteTexture("rgba(0,0,0,0)", "rgba(0,0,0,1)", 0.55), 0.28);
  group.add(flat(fieldW, fieldD, pool, { x: 0, y: 0.0155, z: 0 }));
  for (const s of [-1, 1]) {
    group.add(flat(halfW, fieldD, wellShade, { x: s * (BAR_W / 2 + halfW / 2), y: 0.014, z: 0 }));
  }

  // The tray: a walnut box with two felt-lined wells, one per player.
  const trayBase = box(TRAY_W, BASE_H - 0.03, outerD, wood);
  trayBase.position.set(TRAY_X, -BASE_H / 2 - 0.015, 0);
  const trayFelt = box(TRAY_W - TRAY_WALL, 0.02, outerD - TRAY_WALL, trayFeltMaterial);
  trayFelt.position.set(TRAY_X, -0.01, 0);
  trayFelt.castShadow = false;
  const trayRails = mitredFrame(
    { cx: TRAY_X, w: TRAY_W, d: outerD, width: TRAY_WALL, bottom: -BASE_H, top: RIM_H },
    wood,
  );
  const divider = box(TRAY_W - TRAY_WALL * 2, RIM_H * 0.8, 0.2, wood);
  divider.position.set(TRAY_X, (RIM_H * 0.8) / 2, 0);
  const wellD = (outerD - TRAY_WALL * 2 - 0.2) / 2;
  const trayShade = shade(wellShadeTexture(TRAY_W - TRAY_WALL * 2, wellD, 0.3), 0.55);
  const trayGlow = new THREE.Mesh(new THREE.PlaneGeometry(TRAY_W, outerD), targetFill);
  trayGlow.rotation.x = -Math.PI / 2;
  trayGlow.position.set(TRAY_X, 0.016, 0);
  trayGlow.visible = false;
  group.add(trayBase, trayFelt, trayRails, divider, trayGlow);
  for (const s of [-1, 1]) {
    group.add(
      flat(TRAY_W - TRAY_WALL * 2, wellD, trayShade, {
        x: TRAY_X,
        y: 0.012,
        z: (s * (wellD + 0.2)) / 2,
      }),
    );
  }

  // A soft shadow under the whole board, so it sits on the table rather than over it.
  const footW = TRAY_X + TRAY_W / 2 + outerW / 2;
  const footX = (TRAY_X + TRAY_W / 2 - outerW / 2) / 2;
  const spread = 0.9;
  group.add(
    flat(
      footW + spread * 2,
      outerD + spread * 2,
      shade(dropShadowTexture(footW, outerD, spread), 0.75),
      { x: footX, y: -BASE_H + 0.004, z: 0 },
    ),
  );

  const pointGlows: THREE.Mesh[] = [];
  for (let p = 0; p < POINT_COUNT; p++) {
    group.add(triangle(p, 0.008, piping, 0.02));
    group.add(triangle(p, 0.012, pointColors[p % 2 === 0 ? 0 : 1]));
    const pointGlow = triangle(p, 0.016, targetFill);
    pointGlow.receiveShadow = false;
    pointGlow.visible = false;
    pointGlows.push(pointGlow);
    group.add(pointGlow);
  }

  const targetMarkers = Array.from({ length: MAX_TARGETS }, targetMarker);
  const sourceMarkers = Array.from({ length: MAX_SOURCES }, sourceMarker);
  group.add(...targetMarkers, ...sourceMarkers);

  return {
    group,
    setHints(hints = { sources: [], targets: [], off: false }) {
      pointGlows.forEach((mesh, p) => {
        mesh.visible = hints.targets.some((target) => target.point === p);
      });
      trayGlow.visible = hints.off;
      targetMarkers.forEach((marker, i) => {
        const target = hints.targets[i];
        marker.visible = target !== undefined;
        if (!target) return;
        // Just above the felt or the checker below; or on top of the checker to be hit,
        // which would otherwise cover the marker.
        const y = target.occupied
          ? target.at.y + CHECKER_H / 2 + 0.014
          : target.at.y - CHECKER_H / 2 + 0.03;
        marker.position.set(target.at.x, y, target.at.z);
      });
      sourceMarkers.forEach((marker, i) => {
        const at = hints.sources[i];
        marker.visible = at !== undefined;
        // Down on the surface the checker stands on, so its neighbours cover the overlap.
        if (at) marker.position.set(at.x, at.y - CHECKER_H / 2 + 0.024, at.z);
      });
    },
  };
}
