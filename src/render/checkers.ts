import gsap from "gsap";
import * as THREE from "three";
import type { BoardEvent, BoardState, Player } from "../core/board.ts";
import { hopToRest, setLifted, setRest } from "./effects.ts";
import { CHECKER_H, CHECKER_R, type Place, slotPosition } from "./layout.ts";

const geometry = new THREE.CylinderGeometry(CHECKER_R, CHECKER_R, CHECKER_H, 48);
const materials: Record<Player, THREE.Material> = {
  white: new THREE.MeshStandardMaterial({ color: 0xefe6d2, roughness: 0.45 }),
  black: new THREE.MeshStandardMaterial({ color: 0x16161a, roughness: 0.6 }),
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
