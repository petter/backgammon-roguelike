import * as THREE from "three";

import { FIELD_HALF_D, pointSide, pointX, TRIANGLE_LEN, type Vec3 } from "./layout.ts";

/** Geometry for the board's woodwork, cloth and inlays. Positions in world units. */

const BEVEL = 0.06;

/**
 * A box whose UVs are its own X and Z in world units, so a tiled texture keeps one scale
 * on every box. `grainAlongZ` turns the texture's U axis to run along Z.
 */
export function box(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  grainAlongZ = false,
): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const pos = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    if (grainAlongZ) uv.setXY(i, z, x);
    else uv.setXY(i, x, z);
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * One rail of a mitred frame, as seen from inside it: `length` along its outer edge,
 * `width` deep, cut at 45 degrees at both ends. Built at the near edge (z = +outer edge)
 * with its grain running along it; the caller turns it into place.
 */
function rail(length: number, width: number, bottom: number, top: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-length / 2, 0);
  shape.lineTo(length / 2, 0);
  shape.lineTo(length / 2 - width, width);
  shape.lineTo(-length / 2 + width, width);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: top - bottom - BEVEL * 2,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelOffset: -BEVEL,
    bevelSegments: 4,
    curveSegments: 1,
  });
  // Shape Y becomes world -Z (inwards from the near edge); the extrusion becomes height.
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bottom + BEVEL, 0);
  return geometry;
}

export interface FrameSpec {
  /** Centre of the frame along X; it is always centred on Z = 0. */
  cx: number;
  /** Outer width and depth. */
  w: number;
  d: number;
  /** How deep each rail is, from its outer edge in. */
  width: number;
  bottom: number;
  top: number;
}

/** Four mitred rails around a rectangle. Grain runs the length of every rail. */
export function mitredFrame(
  { cx, w, d, width, bottom, top }: FrameSpec,
  material: THREE.Material,
): THREE.Group {
  const group = new THREE.Group();
  const sides: Array<[length: number, x: number, z: number, turn: number]> = [
    [w, cx, d / 2, 0],
    [w, cx, -d / 2, Math.PI],
    [d, cx + w / 2, 0, Math.PI / 2],
    [d, cx - w / 2, 0, -Math.PI / 2],
  ];
  for (const [length, x, z, turn] of sides) {
    const mesh = new THREE.Mesh(rail(length, width, bottom, top), material);
    mesh.rotation.y = turn;
    mesh.position.set(x, 0, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** A flat `w` by `d` plane lying face up at `at`, for inlays and painted shade. */
export function flat(w: number, d: number, material: THREE.Material, at: Vec3): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(at.x, at.y, at.z);
  return mesh;
}

/** A transparent overlay drawn from a black texture whose alpha holds the shade. */
export function shade(texture: THREE.Texture, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    // Not `alphaMap`: that reads the green channel, which is zero in a black texture.
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false,
  });
}

/**
 * Flat triangle for a point, base on the board edge, tip towards the middle.
 * `grow` widens it on every side, for the piping laid underneath.
 */
export function triangle(point: number, y: number, material: THREE.Material, grow = 0): THREE.Mesh {
  const x = pointX(point);
  const s = pointSide(point);
  // Wound counter-clockwise seen from above, so the face points up on both edges.
  const base = s * FIELD_HALF_D;
  const tip = s * (FIELD_HALF_D - TRIANGLE_LEN - grow * 1.4);
  const half = s * (0.46 + grow);
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
