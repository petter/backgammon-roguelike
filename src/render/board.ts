import { gsap } from "gsap";
import * as THREE from "three";

import { POINT_COUNT } from "../core/board.ts";
import {
  BAR_W,
  CHECKER_H,
  CHECKER_R,
  FIELD_HALF_D,
  FIELD_HALF_W,
  pointSide,
  pointX,
  TRAY_W,
  TRAY_X,
  TRIANGLE_LEN,
  type Vec3,
} from "./layout.ts";

const RIM = 0.5;
const RIM_H = 0.3;
const BASE_H = 0.5;

const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.7 });
const darkWood = new THREE.MeshStandardMaterial({ color: 0x3d2616, roughness: 0.8 });
const felt = new THREE.MeshStandardMaterial({ color: 0x1f4d3a, roughness: 1 });
const pointColors = [0xc9a56b, 0x7a2e2e].map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
);
/** Where a selected checker can go: bright mint, far from every colour on the board. */
const TARGET_COLOR = 0x35ffb0;
/** Which checkers can move: orange, which reads on both the cream and the black checkers. */
const SOURCE_COLOR = 0xff6a00;

const overlay = (color: number, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
const targetFill = overlay(TARGET_COLOR, 0.5);
const targetSpot = overlay(TARGET_COLOR, 0.9);
const targetEdge = overlay(0xffffff, 0.95);
const sourceRing = overlay(SOURCE_COLOR, 0.95);
// One slow pulse shared by every hint, so they draw the eye without flickering.
for (const [material, low] of [
  [targetFill, 0.22],
  [targetSpot, 0.45],
  [sourceRing, 0.4],
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

/** A ring drawn on top of a checker that is able to move. */
function sourceMarker(): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(CHECKER_R * 0.5, CHECKER_R * 0.78, 40),
    sourceRing,
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  return ring;
}

function box(w: number, h: number, d: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Flat triangle for a point, base on the board edge, tip towards the middle. */
function triangle(point: number, y: number, material: THREE.Material): THREE.Mesh {
  const x = pointX(point);
  const s = pointSide(point);
  // Wound counter-clockwise seen from above, so the face points up on both edges.
  const base = s * FIELD_HALF_D;
  const tip = s * (FIELD_HALF_D - TRIANGLE_LEN);
  const half = s * 0.46;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([x - half, y, base, x + half, y, base, x, y, tip], 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
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

  const base = box(outerW, BASE_H, outerD, wood);
  base.position.y = -BASE_H / 2;
  const surface = box(FIELD_HALF_W * 2, 0.02, FIELD_HALF_D * 2, felt);
  surface.castShadow = false;
  const bar = box(BAR_W, 0.03, FIELD_HALF_D * 2, wood);
  bar.castShadow = false;
  group.add(base, surface, bar);

  for (const s of [-1, 1]) {
    const long = box(outerW, RIM_H, RIM, darkWood);
    long.position.set(0, RIM_H / 2, s * (FIELD_HALF_D + RIM / 2));
    const short = box(RIM, RIM_H, outerD, darkWood);
    short.position.set(s * (FIELD_HALF_W + RIM / 2), RIM_H / 2, 0);
    group.add(long, short);
  }

  const tray = box(TRAY_W, BASE_H, outerD, darkWood);
  tray.position.set(TRAY_X, -BASE_H / 2, 0);
  const trayGlow = new THREE.Mesh(new THREE.PlaneGeometry(TRAY_W, outerD), targetFill);
  trayGlow.rotation.x = -Math.PI / 2;
  trayGlow.position.set(TRAY_X, 0.01, 0);
  trayGlow.visible = false;
  group.add(tray, trayGlow);

  const pointGlows: THREE.Mesh[] = [];
  for (let p = 0; p < POINT_COUNT; p++) {
    group.add(triangle(p, 0.012, pointColors[p % 2]));
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
        if (at) marker.position.set(at.x, at.y + CHECKER_H / 2 + 0.012, at.z);
      });
    },
  };
}
