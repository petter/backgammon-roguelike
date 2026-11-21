import { gsap } from "gsap";
import * as THREE from "three";

import type { Player } from "../core/board.ts";
import { flat } from "./boardParts.ts";
import {
  type Area,
  backArea,
  FIELD_HALF_W,
  homeArea,
  RIM,
  ROUTE_LANE as LANE,
  TRAY_X,
  trayWell,
} from "./layout.ts";
import { along, ROUTE_END, routeOf, type Waypoint } from "./route.ts";
import { chevronTexture, type FrameGap, frameGlowTexture } from "./textures.ts";

/**
 * Light laid on the felt to show a player where to go: chevrons flowing along their route
 * into their home board, which glows; or, once they are home, flowing from home into the
 * tray they bear off into.
 */
export interface Guide {
  kind: "home" | "bearOff";
  player: Player;
  /**
   * For bearing off, the stack a checker can leave from now, to start the route at it: its
   * `x`, how far from the middle of the board the route sets out (`out`, just past the
   * stack) and how far it crosses to the tray (`cross`, clear of the stacks on the way).
   */
  from?: { x: number; out: number; cross: number };
}

export interface GuideView {
  group: THREE.Group;
  /**
   * Lights the guide, or fades it all out when given nothing. `still`: no motion.
   * `scale` enlarges the route's marks, for a board drawn small on a narrow screen.
   */
  show: (guide: Guide | null, still?: boolean, scale?: number) => void;
  /** A faint frame left on a player's home after the guide has gone, or none. `now`: no fade. */
  mark: (player: Player | null, now?: boolean) => void;
}

/** Warm lamplight gold: apart from the mint and amber of the move hints. */
const GOLD = 0xffc95c;
/** How far the frame's glow spreads past the area it outlines, in world units. */
const SPREAD = 0.35;
/** Distance between chevrons along the route, and their size. */
const SPACING = 0.75;
const CHEVRON = 0.7;
/** The last chevron is the arrowhead: bigger, so the route clearly ends there. */
const HEAD = 1.5;
/** A chevron where the route bends more sharply than this, in radians per step, is left out. */
const BEND = 0.3;
/** Inside the narrow tray, chevrons are drawn smaller so they stay clear of its walls. */
const IN_TRAY = 0.7;
/** The strength of the frame left on home once the guide has gone. */
const MARK = 0.3;
/** Width of the line drawn under the chevrons, joining them into one path. */
const RIBBON = 0.1;
/** Height of the rails' top: a chevron crossing a rail rides over it. */
const RAIL_TOP = 0.3;
const MAX_CHEVRONS = 48;
/** No chevron this near the route's start, crowding the frame or ring it sets out from. */
const START_CLEAR = 0.6;
/** Seconds for the flow to move one chevron along. */
const FLOW = 0.32;

const glow = (map: THREE.Texture) =>
  new THREE.MeshBasicMaterial({
    color: GOLD,
    map,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });

/** Whether a spot is over the raised rail between the playfield and the tray. */
const onRail = (x: number) => x > FIELD_HALF_W && x < FIELD_HALF_W + RIM + 0.3;
/** Whether a spot is in the tray, past its inner wall. */
const inTray = (x: number) => x > TRAY_X - 0.55;
/**
 * Whether a chevron would sit on the stretch between home and the tray, over the frames'
 * glowing edges and the rail. The line alone crosses it.
 */
const crossing = (x: number) => x > FIELD_HALF_W - 0.25 && x < TRAY_X - 0.25;
/** How high a mark on the route sits: on the felt, or riding over the rail. */
const heightAt = (x: number) => (onRail(x) ? RAIL_TOP + 0.01 : 0.024);
/** Smoothstep: eases from 0 to 1 and back to rest at both ends. */
const ease = (t: number) => t * t * (3 - 2 * t);
/**
 * The line's height: like a mark's, but eased up onto the rail and down off it, so the
 * line runs on unbroken where it crosses.
 */
const lineHeightAt = (x: number) => {
  const up = FIELD_HALF_W - 0.25;
  const top = FIELD_HALF_W + 0.05;
  const down = FIELD_HALF_W + RIM + 0.25;
  const off = FIELD_HALF_W + RIM + 0.55;
  const low = 0.02;
  const high = RAIL_TOP + 0.01;
  if (x <= up || x >= off) return low;
  if (x < top) return low + (high - low) * ease((x - up) / (top - up));
  if (x > down) return high + (low - high) * ease((x - down) / (off - down));
  return high;
};

/** A flat strip of `width` following the route, as loose triangles, two per step. */
function ribbon(points: Waypoint[], width: number, lift = 0): THREE.BufferGeometry {
  const spots = along(points, 0.05);
  const positions: number[] = [];
  const edge = (i: number) => {
    const spot = spots[i];
    if (!spot) return null;
    // The direction is stored as a turn about Y; the strip's sides lie square to it.
    const nx = (Math.sin(spot.angle) * width) / 2;
    const nz = (Math.cos(spot.angle) * width) / 2;
    // Each edge at its own height: over the rail's slope the two can differ.
    const [x0, x1] = [spot.x - nx, spot.x + nx];
    return [x0, lineHeightAt(x0) + lift, spot.z - nz, x1, lineHeightAt(x1) + lift, spot.z + nz];
  };
  for (let i = 1; i < spots.length; i++) {
    const a = edge(i - 1);
    const b = edge(i);
    if (!a || !b) continue;
    const [ax0, ay0, az0, ax1, ay1, az1] = a as [number, number, number, number, number, number];
    const [bx0, by0, bz0, bx1, by1, bz1] = b as [number, number, number, number, number, number];
    positions.push(ax0, ay0, az0, bx0, by0, bz0, ax1, ay1, az1);
    positions.push(ax1, ay1, az1, bx0, by0, bz0, bx1, by1, bz1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

/** A glowing frame round an area, flat on the felt; `gap` opens part of its edge. */
function frame(area: Area, gap?: FrameGap): THREE.Mesh {
  const w = area.x1 - area.x0;
  const d = area.z1 - area.z0;
  const mesh = flat(w + SPREAD * 2, d + SPREAD * 2, glow(frameGlowTexture(w, d, SPREAD, gap)), {
    x: 0,
    y: 0.019,
    z: 0,
  });
  mesh.renderOrder = 2;
  return mesh;
}

const material = (mesh: THREE.Mesh) => mesh.material as THREE.MeshBasicMaterial;
const centre = (area: Area) => ({ x: (area.x0 + area.x1) / 2, z: (area.z0 + area.z1) / 2 });

export function createGuide(): GuideView {
  const group = new THREE.Group();
  // Both players' homes, and both tray wells, are the same size: one frame each, moved.
  const home = frame(homeArea("white"));
  // For the first lesson, home's frame stands open along the stretch where the route comes
  // in, so the route runs into home instead of alongside its edge. The texture's top edge
  // lies on the middle of the board; Black's copy is turned round, mirroring its gap.
  const area = homeArea("white");
  // Open along the top edge to where the route turns down, and down the side edge it
  // crosses, past the lane it comes in by.
  const to = ROUTE_END.x - area.x0 + 0.45;
  const width = area.x1 - area.x0;
  const down = LANE + 0.5;
  const open: Record<Player, THREE.Mesh> = {
    white: frame(area, { from: 0, to, side: "left", down }),
    black: frame(area, { from: width - to, to: width, side: "right", down }),
  };
  open.black.rotation.z = Math.PI;
  group.add(open.white, open.black);
  // Drawn a little inside the tray's walls, which would hide a line along their foot.
  const well = trayWell("white");
  const tray = frame({
    x0: well.x0 + 0.1,
    x1: well.x1 - 0.1,
    z0: well.z0 + 0.1,
    z1: well.z1 - 0.1,
  });
  const chevronMap = chevronTexture();
  const chevrons = Array.from({ length: MAX_CHEVRONS }, () => {
    const mesh = flat(CHEVRON, CHEVRON, glow(chevronMap), { x: 0, y: 0, z: 0 });
    mesh.renderOrder = 3;
    mesh.visible = false;
    return mesh;
  });
  const line = new THREE.Mesh(
    ribbon([], RIBBON),
    new THREE.MeshBasicMaterial({
      color: GOLD,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  line.renderOrder = 2;
  // A dark band under the line, so it holds its contrast over the pale points.
  const under = new THREE.Mesh(
    ribbon([], RIBBON),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  under.renderOrder = 1;
  group.add(under);
  const homeMark = frame(homeArea("white"));
  material(homeMark).opacity = 0;
  // A frame round the back checkers, where the route sets out from.
  const origin = frame(backArea("white"));
  group.add(home, tray, homeMark, origin, line, ...chevrons);
  const frameMeshes = [home, tray, open.white, open.black];
  const frames = frameMeshes.map(material);
  let loops: gsap.core.Animation[] = [];
  /** How far the flow has moved along the route, in chevrons. */
  const flow = { at: 0 };
  /** How many chevrons have been revealed from the start of the route; fractional fades. */
  const reveal = { at: 0, level: 1 };
  let placed = 0;
  /** How strongly the route's line is drawn. */
  let strength = 0.7;

  /** Each chevron is brightest just as the flow passes it, then fades behind it. */
  const paint = () => {
    // The line draws on with the chevrons, from the start of the route.
    const drawn = placed > 0 ? Math.min(1, reveal.at / placed) : 0;
    const count = line.geometry.getAttribute("position").count;
    line.geometry.setDrawRange(0, Math.floor((count * drawn) / 3) * 3);
    material(line).opacity = strength * reveal.level;
    material(under).opacity = 0.35 * reveal.level;
    under.geometry.setDrawRange(
      0,
      Math.floor((under.geometry.getAttribute("position").count * drawn) / 3) * 3,
    );
    material(origin).opacity = origin.visible ? 0.9 * reveal.level : 0;
    for (let i = 0; i < placed; i++) {
      const chevron = chevrons[i];
      if (!chevron) continue;
      const behind = (((flow.at - i) % 8) + 8) % 8;
      const shown = Math.min(1, Math.max(0, reveal.at - i)) * reveal.level;
      // The arrowhead stays at full strength: it marks where the route ends.
      const pulse = i === placed - 1 ? 1 : Math.max(0, 1 - behind / 3.5);
      material(chevron).opacity = shown * (0.65 + 0.35 * pulse);
    }
  };

  const stop = () => {
    for (const loop of loops) loop.kill();
    loops = [];
    gsap.killTweensOf([...frames, flow, reveal]);
  };

  const breathe = (target: THREE.MeshBasicMaterial, high: number, low: number, delay = 0) => {
    loops.push(
      gsap
        .timeline({ delay })
        .to(target, { opacity: high, duration: 0.5, ease: "sine.out" })
        .to(target, { opacity: low, duration: 0.9, ease: "sine.inOut", yoyo: true, repeat: -1 }),
    );
  };

  return {
    group,
    mark(player, now = false) {
      gsap.killTweensOf(material(homeMark));
      if (now && !player) {
        material(homeMark).opacity = 0;
        homeMark.visible = false;
        return;
      }
      if (player) homeMark.visible = true;
      if (player) {
        const at = centre(homeArea(player));
        homeMark.position.set(at.x, homeMark.position.y, at.z);
      }
      gsap.to(material(homeMark), {
        opacity: player ? MARK : 0,
        duration: 0.6,
        ease: "sine.inOut",
        onComplete: () => {
          if (!player) homeMark.visible = false;
        },
      });
    },
    show(guide, still = false, scale = 1) {
      stop();
      if (!guide && still) {
        for (const target of frames) target.opacity = 0;
        for (const mesh of frameMeshes) mesh.visible = false;
        for (const chevron of chevrons) chevron.visible = false;
        material(line).opacity = 0;
        material(under).opacity = 0;
        // Out of the render list altogether until the next route.
        line.visible = false;
        under.visible = false;
        origin.visible = false;
        return;
      }
      // Slower out than in: the light lingers a moment after the card has gone.
      if (!guide) {
        loops.push(
          gsap.to(reveal, {
            level: 0,
            duration: 1,
            ease: "sine.in",
            onUpdate: paint,
            onComplete: () => {
              for (const chevron of chevrons) chevron.visible = false;
              line.visible = false;
              under.visible = false;
            },
          }),
        );
        gsap.to(frames, {
          opacity: 0,
          duration: 1,
          ease: "sine.in",
          // Faded frames leave the render list until the next guide.
          onComplete: () => {
            for (const mesh of frameMeshes) mesh.visible = false;
          },
        });
        return;
      }
      const homeAt = centre(homeArea(guide.player));
      const trayAt = centre(trayWell(guide.player));
      home.position.set(homeAt.x, home.position.y, homeAt.z);
      tray.position.set(trayAt.x, tray.position.y, trayAt.z);

      const route = routeOf(guide);
      line.geometry.dispose();
      under.geometry.dispose();
      // The bear-off route is short and has few chevrons: its line carries more weight.
      line.visible = true;
      under.visible = true;
      // The short bear-off route is drawn brighter, with the same fine stroke as the long one.
      strength = guide.kind === "bearOff" ? 0.95 : 0.7;
      const stroke = RIBBON * scale;
      line.geometry = ribbon(route, stroke);
      under.geometry = ribbon(route, stroke * 2.2, -0.002);
      // Chevrons on a tight bend kink and crowd: the line alone carries the route round it.
      const sampled = along(route, SPACING * scale);
      const first = route[0];
      const fromStart = (spot: Waypoint) =>
        first ? Math.hypot(spot.x - first.x, spot.z - first.z) : Infinity;
      const bend = (i: number) => {
        const [a, b] = [sampled[i - 1], sampled[i + 1]];
        if (!a || !b) return 0;
        const turn = Math.abs(b.angle - a.angle) % (Math.PI * 2);
        return Math.min(turn, Math.PI * 2 - turn) / 2;
      };
      const spots = sampled
        .filter(
          (spot, i, all) =>
            i === all.length - 1 ||
            (fromStart(spot) >= START_CLEAR && !crossing(spot.x) && bend(i) < BEND),
        )
        .slice(0, MAX_CHEVRONS);
      origin.visible = guide.kind === "home";
      const backAt = centre(backArea(guide.player));
      origin.position.set(backAt.x, origin.position.y, backAt.z);
      placed = spots.length;
      chevrons.forEach((chevron, i) => {
        const spot = spots[i];
        chevron.visible = spot !== undefined;
        if (!spot) return;
        chevron.position.set(spot.x, heightAt(spot.x), spot.z);
        chevron.rotation.set(-Math.PI / 2, 0, spot.angle);
        const size = (i === spots.length - 1 ? HEAD : 1) * scale;
        const head = i === spots.length - 1;
        // In the narrow tray chevrons shrink to fit; the arrowhead keeps more of its size.
        const fit = head ? Math.min(size * 0.85, 1.3) : Math.min(size * IN_TRAY, 1);
        chevron.scale.setScalar(inTray(spot.x) ? fit : size);
      });

      for (const light of frames) light.opacity = 0;
      for (const mesh of frameMeshes) mesh.visible = true;
      const lit = guide.kind === "home" ? open[guide.player] : home;
      lit.position.set(homeAt.x, lit.position.y, homeAt.z);
      const homeLight = material(lit);
      const trayLight = material(tray);
      // Bearing off, home steps back: the ringed checker and the tray are what matter.
      // With no checker able to leave yet, the tray alone is lit.
      let homeLevel = 1;
      if (guide.kind === "bearOff") homeLevel = guide.from ? 0.3 : 0;
      // In the first lesson the tray is faintly outlined: where checkers go in the end.
      const trayLevel = guide.kind === "bearOff" ? 1 : 0.3;
      if (still) {
        homeLight.opacity = homeLevel;
        trayLight.opacity = trayLevel;
        flow.at = 0;
        reveal.at = placed;
        reveal.level = 1;
        paint();
        return;
      }
      homeLight.opacity = 0;
      trayLight.opacity = 0;
      flow.at = 0;
      reveal.at = 0;
      reveal.level = 1;
      paint();
      // The chevrons light up one after another from the start of the route, then keep
      // flowing; the destination lights as the first of them gets there.
      const arrive = placed * 0.05;
      loops.push(
        gsap.to(reveal, { at: placed + 1, duration: arrive, ease: "none", onUpdate: paint }),
        gsap.to(flow, {
          at: "+=8",
          duration: FLOW * 8,
          ease: "none",
          repeat: -1,
          onUpdate: paint,
        }),
      );
      // The destination lights at once, with the card that names it.
      if (guide.kind === "home") {
        breathe(homeLight, 1, 0.6);
        gsap.to(trayLight, { opacity: trayLevel, duration: 0.5 });
      } else {
        gsap.to(homeLight, { opacity: homeLevel, duration: 0.5 });
        breathe(trayLight, 0.75, 0.4);
      }
    },
  };
}
