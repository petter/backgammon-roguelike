import { gsap } from "gsap";
import * as THREE from "three";

import type { BoardEvent, BoardState, Player } from "../core/board.ts";
import { hopToRest, setLifted, setRest } from "./effects.ts";
import { CHECKER_H, CHECKER_R, type Place, slotPosition } from "./layout.ts";

const H = CHECKER_H / 2;
const R = CHECKER_R;
/** Depth of the dish turned into the top face, inside the raised rim. */
const DISH = 0.018;

/** Points along a quarter circle, for rounded edges on the turned profile. */
function arc(cx: number, cy: number, r: number, from: number, to: number): THREE.Vector2[] {
  const steps = 6;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps;
    return new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  });
}

const v = (x: number, y: number) => new THREE.Vector2(x, y);

/**
 * A turned checker: rounded base and shoulder, a raised rim around a shallow dish,
 * and a low dome in the centre, so the top face catches light in rings.
 */
function checkerGeometry(): THREE.LatheGeometry {
  const profile = [
    v(0, -H),
    ...arc(R - 0.03, -H + 0.03, 0.03, -Math.PI / 2, 0),
    ...arc(R - 0.04, H - 0.04, 0.04, 0, Math.PI / 2),
    ...arc(R * 0.84, H - 0.012, 0.012, Math.PI / 2, Math.PI),
    v(R * 0.81, H - DISH),
    v(R * 0.5, H - DISH),
    v(R * 0.3, H - DISH + 0.005),
    v(0, H - DISH + 0.008),
  ];
  return new THREE.LatheGeometry(profile, 64);
}

const geometry = checkerGeometry();
/** A thin brass ring set into the dish of every checker. */
const inlayGeometry = new THREE.RingGeometry(R * 0.6, R * 0.68, 64).rotateX(-Math.PI / 2);
const inlayMaterial = new THREE.MeshStandardMaterial({
  color: 0xd4a957,
  metalness: 1,
  roughness: 0.3,
});
const materials: Record<Player, THREE.Material> = {
  white: new THREE.MeshPhysicalMaterial({
    color: 0xf1e6cc,
    roughness: 0.4,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
  }),
  black: new THREE.MeshPhysicalMaterial({
    color: 0x1d1c22,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 2.2,
  }),
};

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
    const inlay = new THREE.Mesh(inlayGeometry, inlayMaterial);
    inlay.position.y = H - DISH + 0.004;
    inlay.receiveShadow = true;
    mesh.add(inlay);
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
