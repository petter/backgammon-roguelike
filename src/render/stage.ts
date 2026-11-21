import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import type { Player } from "../core/board.ts";
import { type PickTarget, pickAt, TRAY_W, TRAY_X } from "./layout.ts";
import { clothTexture, vignetteTexture } from "./textures.ts";

/** Height of the table top the board rests on: the underside of the board. */
const TABLE_Y = -0.5;

const VIEW_TARGET = new THREE.Vector3((TRAY_X + TRAY_W / 2 - 7) / 2, 0, 0);
const VIEW_HALF_W = 8.4;
const VIEW_HALF_H = 7.2;

/** What it takes to hold something up in front of the camera, at a spot on the screen. */
export interface Lens {
  /** The canvas, in client pixels. */
  bounds: () => DOMRect;
  /** The world point `depth` units in front of the camera, under a position in client pixels. */
  point: (clientX: number, clientY: number, depth: number, out: THREE.Vector3) => THREE.Vector3;
  /** How many world units one client pixel spans, `depth` units in front of the camera. */
  pixel: (depth: number) => number;
  /** The camera's orientation: something turned by it faces the viewer square on. */
  facing: THREE.Quaternion;
}

export interface Stage {
  /** Everything that shakes together: board and checkers. */
  world: THREE.Group;
  /** Puts the camera on that player's side of the board, so their home is nearest. */
  setSeat: (player: Player) => void;
  /** What sits on the playfield under a pointer position, if anything. */
  pick: (clientX: number, clientY: number) => PickTarget | null;
  lens: Lens;
}

export function createStage(container: HTMLElement): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = vignetteTexture("#2a1f17", "#0b0908");
  // A soft studio room, reflected in the lacquer of the checkers and the frame.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 200);

  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x2a1d14, 0.55));
  const sun = new THREE.DirectionalLight(0xffeedd, 2.4);
  sun.position.set(-6, 14, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 4;
  const shadowCam = sun.shadow.camera;
  shadowCam.left = -11;
  shadowCam.right = 11;
  shadowCam.top = 9;
  shadowCam.bottom = -9;
  shadowCam.far = 40;
  scene.add(sun);

  // The table, outside `world` so it stays put while the board shakes on it.
  const weave = clothTexture("#a8a8a8", 31);
  weave.repeat.set(20, 20);
  const table = new THREE.Mesh(
    new THREE.CircleGeometry(30, 64),
    new THREE.MeshStandardMaterial({ color: 0x3b2a20, map: weave, roughness: 0.95 }),
  );
  table.rotation.x = -Math.PI / 2;
  table.position.y = TABLE_Y;
  table.receiveShadow = true;
  // A dark falloff over the cloth, as if one lamp hangs over the board.
  const dusk = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshBasicMaterial({
      map: vignetteTexture("rgba(0,0,0,0)", "rgba(0,0,0,0.9)", 0.3),
      transparent: true,
      depthWrite: false,
    }),
  );
  dusk.rotation.x = -Math.PI / 2;
  dusk.position.set(VIEW_TARGET.x, TABLE_Y + 0.005, 0);
  scene.add(table, dusk);

  const world = new THREE.Group();
  scene.add(world);

  const viewDir = new THREE.Vector3();
  let side = 1;

  const resize = () => {
    viewDir.set(0, 1, 0.4 * side).normalize();
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance = Math.max(VIEW_HALF_H / tan, VIEW_HALF_W / (tan * camera.aspect));
    camera.position.copy(VIEW_TARGET).addScaledVector(viewDir, distance);
    camera.lookAt(VIEW_TARGET);
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);
  renderer.setAnimationLoop(() => renderer.render(scene, camera));

  const raycaster = new THREE.Raycaster();
  const playfield = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const aim = (clientX: number, clientY: number) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray;
  };

  return {
    world,
    setSeat(player) {
      side = player === "white" ? 1 : -1;
      // The light moves with the camera, so both players see the checkers lit the same way.
      sun.position.set(-6 * side, 14, 6 * side);
      resize();
    },
    pick(clientX, clientY) {
      if (!aim(clientX, clientY).intersectPlane(playfield, hitPoint)) return null;
      return pickAt(hitPoint.x, hitPoint.z);
    },
    lens: {
      bounds: () => renderer.domElement.getBoundingClientRect(),
      point(clientX, clientY, depth, out) {
        const { origin, direction } = aim(clientX, clientY);
        const along = depth / direction.dot(camera.getWorldDirection(forward));
        return out.copy(origin).addScaledVector(direction, along);
      },
      pixel(depth) {
        const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        return (2 * depth * tan) / renderer.domElement.getBoundingClientRect().height;
      },
      facing: camera.quaternion,
    },
  };
}
