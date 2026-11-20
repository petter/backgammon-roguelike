import * as THREE from "three";
import { POINT_COUNT } from "../core/board";
import {
  BAR_W,
  FIELD_HALF_D,
  FIELD_HALF_W,
  pointSide,
  pointX,
  TRAY_W,
  TRAY_X,
  TRIANGLE_LEN,
} from "./layout";

const RIM = 0.5;
const RIM_H = 0.3;
const BASE_H = 0.5;

const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.7 });
const darkWood = new THREE.MeshStandardMaterial({ color: 0x3d2616, roughness: 0.8 });
const felt = new THREE.MeshStandardMaterial({ color: 0x1f4d3a, roughness: 1 });
const pointColors = [0xc9a56b, 0x7a2e2e].map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
);
const glow = new THREE.MeshBasicMaterial({
  color: 0xffd75e,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
});

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

export interface BoardView {
  group: THREE.Group;
  /** Lights up the points (and optionally the tray) a selected checker can move to. */
  setTargets(points: number[], off: boolean): void;
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
  const trayGlow = new THREE.Mesh(new THREE.PlaneGeometry(TRAY_W, outerD), glow);
  trayGlow.rotation.x = -Math.PI / 2;
  trayGlow.position.set(TRAY_X, 0.01, 0);
  trayGlow.visible = false;
  group.add(tray, trayGlow);

  const pointGlows: THREE.Mesh[] = [];
  for (let p = 0; p < POINT_COUNT; p++) {
    group.add(triangle(p, 0.012, pointColors[p % 2]));
    const pointGlow = triangle(p, 0.016, glow);
    pointGlow.receiveShadow = false;
    pointGlow.visible = false;
    pointGlows.push(pointGlow);
    group.add(pointGlow);
  }

  return {
    group,
    setTargets(points, off) {
      pointGlows.forEach((mesh, p) => {
        mesh.visible = points.includes(p);
      });
      trayGlow.visible = off;
    },
  };
}
