import { gsap } from "gsap";
import * as THREE from "three";

import type { BoardEvent, BoardState, Player } from "../core/board.ts";
import { hopToRest, setLifted, setRest } from "./effects.ts";
import { CHECKER_H, CHECKER_R, type Place, slotPosition, type Vec3 } from "./layout.ts";
import { contactShadowTexture, stoneTexture } from "./textures.ts";

const H = CHECKER_H / 2;
const R = CHECKER_R;
/** Depth of the bowl turned into the top face, inside the raised rim. */
const DISH = 0.055;
/** Inner edge of the flat rim, where the bowl begins. */
const RIM_IN = R * 0.84;
/** Radius of the rounded lip where the rim turns down into the bowl. */
const FILLET = 0.012;
/** Radius of the brass ring set into the bowl. */
const INLAY_R = R * 0.66;

/** Points along a circular arc, for rounded edges on the turned profile. */
function arc(cx: number, cy: number, r: number, from: number, to: number): THREE.Vector2[] {
  const steps = 6;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps;
    return new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  });
}

/** Height of the bowl's surface at radius `r`: a smooth parabola, lowest in the middle. */
function bowlY(r: number): number {
  const edge = RIM_IN - FILLET;
  return H - DISH + (DISH - FILLET) * (r / edge) ** 2;
}

/**
 * A turned checker: rounded base and shoulder, a flat rim, and a smooth bowl inside it,
 * whose curve sweeps a highlight across the face as the light moves.
 */
function checkerGeometry(): THREE.LatheGeometry {
  const edge = RIM_IN - FILLET;
  const bowl = Array.from({ length: 11 }, (_, i) => {
    const r = edge * (1 - i / 10);
    return new THREE.Vector2(r, bowlY(r));
  });
  const profile = [
    new THREE.Vector2(0, -H),
    ...arc(R - 0.03, -H + 0.03, 0.03, -Math.PI / 2, 0),
    ...arc(R - 0.05, H - 0.05, 0.05, 0, Math.PI / 2),
    ...arc(RIM_IN, H - FILLET, FILLET, Math.PI / 2, Math.PI),
    ...bowl.slice(1),
  ];
  const geometry = new THREE.LatheGeometry(profile, 96);
  // Map the stone texture straight down onto the face, rather than around the lathe.
  const pos = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / (2 * R) + 0.5, pos.getZ(i) / (2 * R) + 0.5);
  }
  return geometry;
}

const geometry = checkerGeometry();
/** A fine brass wire laid into the bowl of every checker. */
const inlayGeometry = new THREE.TorusGeometry(INLAY_R, 0.012, 10, 96).rotateX(Math.PI / 2);
const inlayMaterial = new THREE.MeshStandardMaterial({
  color: 0xc29a4e,
  emissive: 0x2a1c08,
  metalness: 0.9,
  roughness: 0.3,
});
const materials: Record<Player, THREE.Material> = {
  white: new THREE.MeshPhysicalMaterial({
    map: stoneTexture("#d3c29c", "#8a6e3e", 41, { from: 0.8, to: 0.86, alpha: 0.22 }),
    roughness: 0.3,
    clearcoat: 0.8,
    clearcoatRoughness: 0.15,
    envMapIntensity: 1.6,
  }),
  black: new THREE.MeshPhysicalMaterial({
    map: stoneTexture("#121116", "#524e62", 42),
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    envMapIntensity: 0.9,
  }),
};
/** A soft dark disc under each checker, grounding it on the felt or the checker below. */
const contactGeometry = new THREE.CircleGeometry(R * 1.24, 40).rotateX(-Math.PI / 2);
const contactShadow = new THREE.MeshBasicMaterial({
  color: 0x000000,
  map: contactShadowTexture(),
  transparent: true,
  depthWrite: false,
});
const CONTACT_OPACITY = 0.55;
/** Height above its rest at which a lifted checker's contact shadow has faded out. */
const CONTACT_FADE = 0.25;

const PLAYERS = ["white", "black"] as const;

function keyOf(place: Place): string {
  return place.kind === "point" ? `point:${place.index}` : `${place.kind}:${place.player}`;
}

function placeOf(player: Player, where: number | "bar" | "off"): Place {
  return typeof where === "number" ? { kind: "point", index: where } : { kind: where, player };
}

/**
 * Checker meshes, kept in step with the core board by replaying its events.
 * The core only counts checkers per place; identity lives here, as stacks of meshes.
 */
export class CheckersView {
  readonly group = new THREE.Group();
  private readonly stacks = new Map<string, THREE.Mesh[]>();
  private lifted: THREE.Mesh | null = null;

  constructor(board: BoardState) {
    this.reset(board);
  }

  /** Rebuilds every checker from a board, with no animation. */
  reset(board: BoardState): void {
    for (const mesh of this.all()) {
      gsap.killTweensOf([mesh.position, mesh.rotation]);
      this.group.remove(mesh);
    }
    this.stacks.clear();
    this.lifted = null;
    board.points.forEach((point, index) => {
      if (!point.owner) return;
      for (let i = 0; i < point.count; i++) this.spawn(point.owner, { kind: "point", index });
    });
    for (const player of PLAYERS) {
      for (let i = 0; i < board.bar[player]; i++) this.spawn(player, { kind: "bar", player });
      for (let i = 0; i < board.off[player]; i++) this.spawn(player, { kind: "off", player });
    }
  }

  /** Whether the checkers on screen agree with a board, place by place and colour by colour. */
  matches(board: BoardState): boolean {
    const agrees = (place: Place, owner: Player | null, count: number) => {
      const stack = this.stack(place);
      return stack.length === count && stack.every((mesh) => mesh.userData.player === owner);
    };
    return (
      board.points.every((p, index) => agrees({ kind: "point", index }, p.owner, p.count)) &&
      PLAYERS.every(
        (player) =>
          agrees({ kind: "bar", player }, player, board.bar[player]) &&
          agrees({ kind: "off", player }, player, board.off[player]),
      )
    );
  }

  all(): THREE.Mesh[] {
    return [...this.stacks.values()].flat();
  }

  /** Animates one board event. Returns when its motion lands, in seconds from now. */
  apply(event: BoardEvent): number {
    this.lift(null);
    if (event.type === "hit") {
      // The hit checker waits for the attacker to arrive before flying to the bar.
      return this.move(
        { kind: "point", index: event.point },
        { kind: "bar", player: event.player },
        0.3,
      );
    }
    return this.move(placeOf(event.player, event.from), placeOf(event.player, event.to), 0);
  }

  /** Raises the top checker at a place to mark it selected; `null` clears the selection. */
  lift(place: Place | null): void {
    const next = place ? (this.stack(place).at(-1) ?? null) : null;
    if (next === this.lifted) return;
    if (this.lifted) setLifted(this.lifted, false);
    if (next) setLifted(next, true);
    this.lifted = next;
  }

  private stack(place: Place): THREE.Mesh[] {
    const key = keyOf(place);
    let stack = this.stacks.get(key);
    if (!stack) {
      stack = [];
      this.stacks.set(key, stack);
    }
    return stack;
  }

  private spawn(player: Player, place: Place): void {
    const mesh = new THREE.Mesh(geometry, materials[player]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.player = player;
    // Each checker is turned from its own piece of stone, so the veins never line up.
    mesh.rotation.y = Math.random() * Math.PI * 2;
    const inlay = new THREE.Mesh(inlayGeometry, inlayMaterial);
    inlay.position.y = bowlY(INLAY_R) + 0.003;
    inlay.receiveShadow = true;
    const contact = new THREE.Mesh(contactGeometry, contactShadow.clone());
    // Just above the points and their hint glow, which would otherwise cover it.
    contact.position.y = -H + 0.02;
    contact.renderOrder = -1;
    // The shadow belongs on the surface below: it fades as the checker lifts away.
    contact.onBeforeRender = () => {
      const lift = mesh.position.y - (mesh.userData.rest as Vec3).y;
      contact.material.opacity =
        CONTACT_OPACITY * THREE.MathUtils.clamp(1 - lift / CONTACT_FADE, 0, 1);
    };
    mesh.add(inlay, contact);
    const stack = this.stack(place);
    const rest = slotPosition(place, stack.length);
    setRest(mesh, rest);
    mesh.position.set(rest.x, rest.y, rest.z);
    stack.push(mesh);
    this.group.add(mesh);
  }

  private move(from: Place, to: Place, delay: number): number {
    const mesh = this.stack(from).pop();
    // Out of step with the core. The caller notices through `matches` and resets.
    if (!mesh) return 0;
    const target = this.stack(to);
    setRest(mesh, slotPosition(to, target.length));
    target.push(mesh);
    return hopToRest(mesh, delay);
  }
}
