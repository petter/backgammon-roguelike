import * as THREE from "three";
import type { BoardEvent, BoardState, Player } from "../core/board";
import { hopToRest, setLifted, setRest } from "./effects";
import { CHECKER_H, CHECKER_R, type Place, slotPosition } from "./layout";

const geometry = new THREE.CylinderGeometry(CHECKER_R, CHECKER_R, CHECKER_H, 48);
const materials: Record<Player, THREE.Material> = {
  white: new THREE.MeshStandardMaterial({ color: 0xefe6d2, roughness: 0.45 }),
  black: new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.45 }),
};

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
    board.points.forEach((point, index) => {
      if (!point.owner) return;
      for (let i = 0; i < point.count; i++) this.spawn(point.owner, { kind: "point", index });
    });
    for (const player of ["white", "black"] as const) {
      for (let i = 0; i < board.bar[player]; i++) this.spawn(player, { kind: "bar", player });
      for (let i = 0; i < board.off[player]; i++) this.spawn(player, { kind: "off", player });
    }
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
    const stack = this.stack(place);
    const rest = slotPosition(place, stack.length);
    setRest(mesh, rest);
    mesh.position.set(rest.x, rest.y, rest.z);
    stack.push(mesh);
    this.group.add(mesh);
  }

  private move(from: Place, to: Place, delay: number): number {
    const mesh = this.stack(from).pop();
    if (!mesh) throw new Error(`No checker to move at ${keyOf(from)}`);
    const target = this.stack(to);
    setRest(mesh, slotPosition(to, target.length));
    target.push(mesh);
    return hopToRest(mesh, delay);
  }
}
