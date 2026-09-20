import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { cells, key, obstacles, type Hex } from './battle.ts';

export const RADIUS = 1.18;
export function worldPosition(h: Hex): THREE.Vector3 {
  return new THREE.Vector3(Math.sqrt(3) * RADIUS * (h.q + h.r / 2 - 8.25), 0, 1.5 * RADIUS * (h.r - 5));
}
function random(seed: number) { let n = seed; return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; }; }

export function createWorld(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#9aa79f'); scene.fog = new THREE.Fog('#9aa79f', 38, 115);
  const camera = new THREE.PerspectiveCamera(42, 1, .1, 180);
  const controls = new OrbitControls(camera, canvas); controls.enableDamping = true;
  controls.minDistance = 3.5; controls.maxDistance = 65; controls.maxPolarAngle = Math.PI / 2 - .045;
  controls.target.set(0, .8, 0); camera.position.set(12, 19, 27);
  controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE; controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  const ambient = new THREE.HemisphereLight('#d6e5ee', '#66513a', 1.25); scene.add(ambient);
  const sun = new THREE.DirectionalLight('#ffe0a4', 3.2); sun.position.set(-16, 28, 13); sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 90 });
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.normalBias = .022; sun.shadow.bias = -.0001; scene.add(sun);
  const pmrem = new THREE.PMREMGenerator(renderer); const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04); scene.environment = environment.texture; scene.environmentIntensity = .25; room.dispose(); pmrem.dispose();

  const scenery = new THREE.Group(); scene.add(scenery);
  const groundGeometry = new THREE.PlaneGeometry(160, 160, 180, 180); groundGeometry.rotateX(-Math.PI / 2);
  const positions = groundGeometry.attributes.position; const colors = [];
  const soil = new THREE.Color('#77734e'), grass = new THREE.Color('#555e39'); const rng = random(119);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i);
    const outside = Math.max(0, Math.max(Math.abs(x) - 21, Math.abs(z) - 14));
    positions.setY(i, -.035 + Math.min(3, outside * .13) * Math.sin(x * .13) * Math.cos(z * .17));
    const t = THREE.MathUtils.clamp(.4 + .27 * Math.sin(x * .35) * Math.cos(z * .29) + rng() * .18, 0, 1);
    const color = soil.clone().lerp(grass, t); colors.push(color.r, color.g, color.b);
  }
  groundGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); groundGeometry.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })); ground.receiveShadow = true; scenery.add(ground);
  const grid = new THREE.Group(); const pickable: THREE.Mesh[] = [];
  const tile = new THREE.CircleGeometry(RADIUS * .985, 6); tile.rotateZ(Math.PI / 6); tile.rotateX(-Math.PI / 2);
  const outline: THREE.Vector3[] = [];
  for (let i = 0; i <= 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; outline.push(new THREE.Vector3(Math.cos(a) * RADIUS, .025, -Math.sin(a) * RADIUS)); }
  const lineGeo = new THREE.BufferGeometry().setFromPoints(outline);
  for (const cell of cells) {
    const p = worldPosition(cell);
    const mesh = new THREE.Mesh(tile, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
    mesh.position.copy(p); mesh.position.y = .02; mesh.userData.cell = cell; scene.add(mesh); pickable.push(mesh);
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#d8d8b1', transparent: true, opacity: .16 })); line.position.copy(p); grid.add(line);
  }
  scene.add(grid); grid.visible = false;
  const hover = new THREE.Mesh(tile, new THREE.MeshBasicMaterial({ color: '#cce6b9', transparent: true, opacity: .18, depthWrite: false })); hover.position.y = .03; hover.visible = false; scene.add(hover);
  const path = new THREE.Group(); scene.add(path);
  const pathMaterial = new THREE.MeshBasicMaterial({ color: '#b3d8bf', transparent: true, opacity: .18, depthWrite: false });
  function showPath(route: Hex[] | null) {
    path.clear();
    for (const h of route ?? []) { const m = new THREE.Mesh(tile, pathMaterial); m.position.copy(worldPosition(h)); m.position.y = .035; path.add(m); }
  }
  const rockGeo = new THREE.DodecahedronGeometry(1, 0), rockMat = new THREE.MeshStandardMaterial({ color: '#757568', roughness: .98, flatShading: true });
  function rock(x: number, z: number, size: number) {
    const m = new THREE.Mesh(rockGeo, rockMat); m.position.set(x, size * .3, z); m.scale.set(size, size * .62, size * .85); m.rotation.set(rng(), rng() * 6, rng()); m.castShadow = true; m.receiveShadow = true; scenery.add(m); return m;
  }
  for (const cell of cells.filter(c => obstacles.has(key(c)))) { const p = worldPosition(cell); scene.add(rock(p.x, p.z, .95)); }
  const trunk = new THREE.CylinderGeometry(.1, .16, 2.1, 6), foliage = new THREE.ConeGeometry(1.2, 3.2, 7);
  const bark = new THREE.MeshStandardMaterial({ color: '#514638', roughness: 1 });
  const leaf = new THREE.MeshStandardMaterial({ color: '#384c3b', roughness: .95 });
  const trunks = new THREE.InstancedMesh(trunk, bark, 95), crowns = new THREE.InstancedMesh(foliage, leaf, 285);
  trunks.castShadow = true; crowns.castShadow = true;
  const treePart = new THREE.Object3D();
  for (let i = 0; i < 95; i++) {
    const a = rng() * Math.PI * 2, rad = 26 + rng() * 24, x = Math.cos(a) * rad, z = Math.sin(a) * rad * .85;
    const scale = .8 + rng() * 1.3;
    treePart.position.set(x, scale, z); treePart.scale.setScalar(scale); treePart.updateMatrix(); trunks.setMatrixAt(i, treePart.matrix);
    for (let j = 0; j < 3; j++) { treePart.position.set(x, (2.2 + j * .8) * scale, z); treePart.scale.setScalar((1 - j * .18) * scale); treePart.updateMatrix(); crowns.setMatrixAt(i * 3 + j, treePart.matrix); }
    if (i % 3 === 0) rock(x * .84, z * .84, .5 + rng());
  }
  scenery.add(trunks, crowns);
  const tuftGeo = new THREE.BufferGeometry();
  tuftGeo.setAttribute('position', new THREE.Float32BufferAttribute([-.014, 0, 0, .014, 0, 0, -.01, .15, .018, .008, .15, .018, 0, .3, .07], 3));
  tuftGeo.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]); tuftGeo.computeVertexNormals();
  const tuftMat = new THREE.MeshStandardMaterial({ color: '#909361', roughness: 1, side: THREE.DoubleSide });
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, 8000); const transform = new THREE.Object3D();
  for (let i = 0; i < 8000; i++) { const x = (rng() - .5) * 58, z = (rng() - .5) * 44; transform.position.set(x, -.025, z); transform.rotation.set(0, rng() * 6, (rng() - .5) * .45); transform.scale.setScalar(.4 + rng() * 1.2); transform.updateMatrix(); tufts.setMatrixAt(i, transform.matrix); }
  scenery.add(tufts);
  const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.ShadowMaterial({ opacity: .32 }));
  shadowFloor.rotation.x = -Math.PI / 2; shadowFloor.position.y = -.025; shadowFloor.receiveShadow = true; shadowFloor.visible = false; scene.add(shadowFloor);
  let backdrop: THREE.Texture | undefined, plateMode = false, plateRequest = 0;
  const backgrounds = new Map<string, THREE.Texture>();
  function resize() {
    if (plateMode && backdrop) {
      const image = backdrop.image as HTMLImageElement;
      const aspect = image.width / image.height;
      const left = window.innerWidth > 760 ? 300 : 0;
      const width = Math.min(window.innerWidth - left, (window.innerHeight - 170) * aspect);
      canvas.style.cssText = `position:absolute;left:${left + (window.innerWidth - left - width) / 2}px;top:85px;width:${width}px;height:${width / aspect}px`;
    } else canvas.style.cssText = '';
    const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize); observer.observe(canvas); window.addEventListener('resize', resize); resize();
  function zoomBy(factor: number) {
    if (plateMode && backdrop) {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, 1, 3);
      backdrop.repeat.setScalar(1 / camera.zoom);
      backdrop.offset.setScalar((1 - 1 / camera.zoom) / 2);
      camera.updateProjectionMatrix();
    } else {
      const offset = camera.position.clone().sub(controls.target);
      offset.setLength(THREE.MathUtils.clamp(offset.length() / factor, controls.minDistance, controls.maxDistance));
      camera.position.copy(controls.target).add(offset); controls.update();
    }
  }
  canvas.addEventListener('wheel', event => {
    if (!plateMode) return;
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
    zoomBy(Math.exp(-THREE.MathUtils.clamp(pixels, -300, 300) * .002));
  }, { passive: false });
  function applyMode(enabled: boolean) {
    camera.zoom = 1; camera.updateProjectionMatrix();
    plateMode = enabled; scenery.visible = !enabled; shadowFloor.visible = enabled; controls.enabled = !enabled;
    scene.fog = enabled ? null : new THREE.Fog('#9aa79f', 38, 115);
    scene.background = enabled && backdrop ? backdrop : new THREE.Color('#9aa79f'); resize();
  }
  async function setBackdrop(url: string) {
    const request = ++plateRequest;
    let texture = backgrounds.get(url);
    if (!texture) { texture = await new THREE.TextureLoader().loadAsync(url); texture.colorSpace = THREE.SRGBColorSpace; backgrounds.set(url, texture); }
    if (request !== plateRequest) return;
    backdrop = texture; applyMode(true); resetCamera();
  }
  function freeCamera() { plateRequest++; applyMode(false); }
  function frameUnit(position: THREE.Vector3) { freeCamera(); controls.target.copy(position).add(new THREE.Vector3(0, 1.1, 0)); camera.position.copy(position).add(new THREE.Vector3(4.4, 3.5, 5.8)); controls.update(); }
  function resetCamera() {
    camera.zoom = 1; if (backdrop) { backdrop.repeat.setScalar(1); backdrop.offset.setScalar(0); } camera.updateProjectionMatrix();
    if (plateMode) { camera.position.set(0, 26, 32); controls.target.set(0, 0, 0); camera.lookAt(controls.target); }
    else { camera.position.set(12, 19, 27); controls.target.set(0, .8, 0); controls.update(); }
  }
  function setMood(dusk: boolean) {
    const bg = dusk ? '#66788a' : '#9aa79f'; if (!plateMode) scene.background = new THREE.Color(bg); scene.fog?.color.set(bg);
    sun.color.set(dusk ? '#bacfea' : '#ffe0a4'); sun.intensity = dusk ? 1.8 : 3.2; ambient.intensity = dusk ? .8 : 1.25;
  }
  return { renderer, scene, camera, controls, grid, pickable, hover, showPath, frameUnit, resetCamera, setMood, sun, zoomBy, setBackdrop, freeCamera, isBackdrop: () => plateMode };
}
