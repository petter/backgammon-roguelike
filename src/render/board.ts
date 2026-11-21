import { gsap } from "gsap";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

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
import { clothTexture, woodTexture } from "./textures.ts";

const RIM = 0.5;
const RIM_H = 0.3;
const BASE_H = 0.5;
const BEVEL = 0.05;

/** World units covered by one repeat of a texture, so grain and weave keep one scale. */
function tiled(texture: THREE.Texture, size: number): THREE.Texture {
  texture.repeat.set(1 / size, 1 / size);
  return texture;
}

const walnut = tiled(woodTexture("#7a4f2e", "#3b2414", 11), 6);
const darkWalnut = tiled(woodTexture("#4e311c", "#22140b", 12), 6);
const wood = new THREE.MeshPhysicalMaterial({
  map: walnut,
  roughness: 0.45,
  clearcoat: 0.5,
  clearcoatRoughness: 0.35,
});
const darkWood = new THREE.MeshPhysicalMaterial({
  map: darkWalnut,
  roughness: 0.5,
  clearcoat: 0.4,
  clearcoatRoughness: 0.4,
});
const brass = new THREE.MeshStandardMaterial({ color: 0xb48a45, metalness: 1, roughness: 0.28 });
const weave = tiled(clothTexture("#d8d8d8", 21), 3);
const felt = new THREE.MeshStandardMaterial({ color: 0x1a4f39, map: weave, roughness: 1 });
const pointMaterial = (color: number) =>
  new THREE.MeshStandardMaterial({ color, map: weave, roughness: 0.85 });
const pointColors = [pointMaterial(0xe3cd9f), pointMaterial(0x6a1d1b)] as const;
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

function rect(cx: number, cz: number, w: number, d: number): THREE.Path {
  const path = new THREE.Path();
  // Shape Y becomes world -Z once the frame is laid flat.
  path.moveTo(cx - w / 2, -cz - d / 2);
  path.lineTo(cx + w / 2, -cz - d / 2);
  path.lineTo(cx + w / 2, -cz + d / 2);
  path.lineTo(cx - w / 2, -cz + d / 2);
  path.closePath();
  return path;
}

/**
 * A raised frame with rounded edges: an outer rectangle with rectangular wells cut out,
 * standing from y = 0 to `height`.
 */
function frame(
  outer: { x: number; w: number; d: number },
  wells: Array<{ x: number; z: number; w: number; d: number }>,
  height: number,
  material: THREE.Material,
): THREE.Mesh {
  const shape = new THREE.Shape(rect(outer.x, 0, outer.w, outer.d).getPoints());
  for (const well of wells) shape.holes.push(rect(well.x, well.z, well.w, well.d));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height - BEVEL * 2,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelOffset: -BEVEL,
    bevelSegments: 4,
    curveSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, BEVEL, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A flat inlaid strip, lying on a surface at height `y`. */
function strip(x: number, z: number, w: number, d: number, y: number): THREE.Mesh {
  const mesh = box(w, 0.006, d, brass);
  mesh.castShadow = false;
  mesh.position.set(x, y, z);
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
  // Planar UVs in world units, so the cloth weave lines up with the felt around it.
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute([x - half, base, x + half, base, x, tip], 2),
  );
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

  // Stops just short of the felt, so it never shadows the playfield it holds up.
  const base = box(outerW, BASE_H - 0.03, outerD, darkWood);
  base.position.y = -BASE_H / 2 - 0.015;
  const surface = box(FIELD_HALF_W * 2, 0.02, FIELD_HALF_D * 2, felt);
  surface.position.y = -0.01;
  surface.castShadow = false;
  const bar = box(BAR_W, 0.03, FIELD_HALF_D * 2, wood);
  bar.position.y = -0.005;
  bar.castShadow = false;
  const rails = frame(
    { x: 0, w: outerW, d: outerD },
    [{ x: 0, z: 0, w: FIELD_HALF_W * 2, d: FIELD_HALF_D * 2 }],
    RIM_H,
    wood,
  );
  group.add(base, surface, bar, rails);

  // Brass lines down both edges of the bar, and hinges across the rails at its ends.
  for (const s of [-1, 1]) {
    group.add(strip((s * (BAR_W - 0.08)) / 2, 0, 0.03, FIELD_HALF_D * 2, 0.013));
    const hinge = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.05, 0.2, 2, 0.02), brass);
    hinge.position.set(0, RIM_H, s * (FIELD_HALF_D + RIM / 2));
    const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.66, 16), brass);
    knuckle.rotation.z = Math.PI / 2;
    knuckle.position.set(0, RIM_H + 0.03, s * (FIELD_HALF_D + RIM / 2));
    group.add(hinge, knuckle);
  }

  // The tray: a dark wooden box with two felt-lined wells, one per player.
  const trayWall = 0.16;
  const wellD = outerD / 2 - trayWall * 1.5;
  const trayBase = box(TRAY_W, BASE_H - 0.03, outerD, darkWood);
  trayBase.position.set(TRAY_X, -BASE_H / 2 - 0.015, 0);
  const trayFelt = box(TRAY_W - trayWall, 0.02, outerD - trayWall, felt);
  trayFelt.position.set(TRAY_X, -0.01, 0);
  const trayRails = frame(
    { x: TRAY_X, w: TRAY_W, d: outerD },
    [-1, 1].map((s) => ({
      x: TRAY_X,
      z: (s * (wellD + trayWall)) / 2,
      w: TRAY_W - trayWall * 2,
      d: wellD,
    })),
    RIM_H * 0.8,
    darkWood,
  );
  const trayGlow = new THREE.Mesh(new THREE.PlaneGeometry(TRAY_W, outerD), targetFill);
  trayGlow.rotation.x = -Math.PI / 2;
  trayGlow.position.set(TRAY_X, 0.012, 0);
  trayGlow.visible = false;
  group.add(trayBase, trayFelt, trayRails, trayGlow);

  const pointGlows: THREE.Mesh[] = [];
  for (let p = 0; p < POINT_COUNT; p++) {
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
        if (at) marker.position.set(at.x, at.y + CHECKER_H / 2 + 0.012, at.z);
      });
    },
  };
}
