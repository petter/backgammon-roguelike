import * as THREE from "three";

import type { Player } from "../core/board.ts";
import { type PickTarget, pickAt, TRAY_W, TRAY_X } from "./layout.ts";

const VIEW_TARGET = new THREE.Vector3((TRAY_X + TRAY_W / 2 - 7) / 2, 0, 0);
const VIEW_HALF_W = 8.4;
const VIEW_HALF_H = 7.2;

export interface Stage {
  /** Everything that shakes together: board and checkers. */
  world: THREE.Group;
  /** Puts the camera on that player's side of the board, so their home is nearest. */
  setSeat: (player: Player) => void;
  /** What sits on the playfield under a pointer position, if anything. */
  pick: (clientX: number, clientY: number) => PickTarget | null;
}

export function createStage(container: HTMLElement): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14110f);
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 200);

  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x2a2018, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-6, 14, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const shadowCam = sun.shadow.camera;
  shadowCam.left = -11;
  shadowCam.right = 11;
  shadowCam.top = 9;
  shadowCam.bottom = -9;
  shadowCam.far = 40;
  scene.add(sun);

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

  return {
    world,
    setSeat(player) {
      side = player === "white" ? 1 : -1;
      // The light moves with the camera, so both players see the checkers lit the same way.
      sun.position.set(-6 * side, 14, 6 * side);
      resize();
    },
    pick(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(playfield, hitPoint)) return null;
      return pickAt(hitPoint.x, hitPoint.z);
    },
  };
}
