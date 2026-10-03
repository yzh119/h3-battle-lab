import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { cells, isPlayable, key, fromHexId, type Hex } from './presentation.ts';

export const RADIUS = 1.18;
export interface EnvironmentAsset {
  label: string; ground: string; normal?: string; roughness?: string; groundRepeat?: number;
  pieces: { url: string; height: number; instances: { position: [number, number, number]; yaw?: number; scale?: number }[] }[];
}
export function worldPosition(h: Hex): THREE.Vector3 {
  return new THREE.Vector3(Math.sqrt(3) * RADIUS * (h.q + h.r / 2 - 7.75), 0, 1.5 * RADIUS * (h.r - 5));
}
function random(seed: number) { let n = seed; return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; }; }

export function createWorld(canvas: HTMLCanvasElement) {
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '战场视角');
  // A closed select/input can retain focus after a pointer click on an
  // unfocusable canvas, causing movement shortcuts to remain suppressed.
  canvas.addEventListener('pointerdown', () => canvas.focus({ preventScroll: true }));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#9aa79f'); scene.fog = new THREE.Fog('#9aa79f', 38, 115);
  const camera = new THREE.PerspectiveCamera(42, 1, .1, 180);
  const controls = new OrbitControls(camera, canvas); controls.enableDamping = true;
  controls.minDistance = 3.5; controls.maxDistance = 65; controls.maxPolarAngle = Math.PI / 2 - .045;
  controls.target.set(0, .8, 0); camera.position.set(12, 26, 40);
  controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE; controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  const movementKeys = new Set<string>();
  const editing = () => document.activeElement instanceof HTMLElement && !!document.activeElement.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');
  window.addEventListener('keydown', event => {
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code) || editing() || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault(); movementKeys.add(event.code);
  });
  window.addEventListener('keyup', event => movementKeys.delete(event.code));
  window.addEventListener('blur', () => movementKeys.clear());
  document.addEventListener('visibilitychange', () => movementKeys.clear());
  document.addEventListener('focusin', () => { if (editing()) movementKeys.clear(); });
  const forward = new THREE.Vector3(), right = new THREE.Vector3(), movement = new THREE.Vector3();
  function updateCamera(dt: number) {
    if (controls.enabled && movementKeys.size && !editing()) {
      camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
      right.crossVectors(forward, camera.up).normalize();
      const longitudinal = Number(movementKeys.has('KeyW')) - Number(movementKeys.has('KeyS'));
      const lateral = Number(movementKeys.has('KeyD')) - Number(movementKeys.has('KeyA'));
      movement.copy(forward).multiplyScalar(longitudinal).addScaledVector(right, lateral);
      if (movement.lengthSq()) {
        movement.normalize().multiplyScalar(10 * dt);
        camera.position.add(movement); controls.target.add(movement);
      }
    }
    if (controls.enabled) controls.update();
    camera.updateMatrixWorld();
  }
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
    mesh.position.copy(p); mesh.position.y = .02; mesh.userData.cell = cell; scene.add(mesh); if (isPlayable(cell)) pickable.push(mesh);
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#fff1c6', transparent: true, opacity: .72 })); line.position.copy(p); grid.add(line);
  }
  // A subtle dark border retains contrast on pale sand/snow; WebGL line widths
  // alone cannot make the outline thicker across browsers.
  const borderGeometry = new THREE.RingGeometry(RADIUS - .023, RADIUS + .023, 6, 1, Math.PI / 6); borderGeometry.rotateX(-Math.PI / 2);
  const borders = new THREE.InstancedMesh(borderGeometry, new THREE.MeshBasicMaterial({ color: '#3d3829', transparent: true, opacity: .3, depthWrite: false, side: THREE.DoubleSide }), cells.length);
  cells.forEach((cell, i) => { const p = worldPosition(cell); borders.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, .019, p.z)); }); grid.add(borders);
  scene.add(grid); grid.visible = true;
  const rangeMaterial = new THREE.MeshBasicMaterial({ color: '#4a9bd5', transparent: true, opacity: .3, depthWrite: false, side: THREE.DoubleSide });
  const range = new THREE.InstancedMesh(tile, rangeMaterial, cells.length); range.count = 0; scene.add(range);
  let rangeHexes: number[] = [];
  function showMovementRange(hexes: number[], team: number) {
    rangeHexes = [...new Set(hexes)]; range.count = rangeHexes.length;
    rangeMaterial.color.set(team ? '#cf624f' : '#4a9bd5');
    rangeHexes.forEach((hex, i) => { const p = worldPosition(fromHexId(hex)); range.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, .028, p.z)); });
    range.instanceMatrix.needsUpdate = true; range.computeBoundingSphere();
  }
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
  const obstacleGroup = new THREE.Group(); scene.add(obstacleGroup);
  function setObstacles(hexes: number[]) {
    obstacleGroup.clear();
    for (const id of new Set(hexes)) {
      const p = worldPosition(fromHexId(id)), m = new THREE.Mesh(rockGeo, rockMat);
      m.position.set(p.x, .3, p.z); m.scale.set(1, .62, .85); m.castShadow = true; m.receiveShadow = true; obstacleGroup.add(m);
    }
  }
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
  let terrainId: number | undefined;
  function setTerrain(id: number) {
    if (id === terrainId) return; terrainId = id;
    // Color and scenery choices are presentation only; combat bonuses stay native.
    const palette = [['#68513d', '#876c44'], ['#b99c62', '#d8c58e'], ['#77734e', '#555e39'], ['#bec9cc', '#eef1ec'], ['#555943', '#687346'], ['#877755', '#a08c63'], ['#625950', '#78705d'], ['#352a26', '#6c3b2b']][id] ?? ['#77734e', '#555e39'];
    const low = new THREE.Color(palette[0]), high = new THREE.Color(palette[1]), values = groundGeometry.attributes.color;
    for (let i = 0; i < positions.count; i++) {
      const t = THREE.MathUtils.clamp(.5 + .3 * Math.sin(positions.getX(i) * .35) * Math.cos(positions.getZ(i) * .29), 0, 1);
      const color = low.clone().lerp(high, t); values.setXYZ(i, color.r, color.g, color.b);
    }
    values.needsUpdate = true;
    if (environmentId) return;
    trunks.visible = crowns.visible = [0, 2, 3, 4].includes(id);
    tufts.visible = [0, 2, 4, 5].includes(id);
    leaf.color.set(id === 3 ? '#9baea5' : '#384c3b');

  }
  const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.ShadowMaterial({ opacity: .32 }));
  shadowFloor.rotation.x = -Math.PI / 2; shadowFloor.position.y = -.025; shadowFloor.receiveShadow = true; shadowFloor.visible = false; scene.add(shadowFloor);
  const backdropBoard = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  backdropBoard.rotation.x = -Math.PI / 2; backdropBoard.position.y = -.04; backdropBoard.visible = false; scene.add(backdropBoard);
  const importedEnvironment = new THREE.Group(); scene.add(importedEnvironment);
  const sky = new Sky(); sky.scale.setScalar(150); sky.visible = false; scene.add(sky);
  sky.material.uniforms.turbidity.value = 3; sky.material.uniforms.rayleigh.value = 1.7;
  sky.material.uniforms.mieCoefficient.value = .005; sky.material.uniforms.mieDirectionalG.value = .8;
  sky.material.uniforms.sunPosition.value.copy(sun.position).normalize();
  const originalGround = new Float32Array(positions.array);
  let environmentId: string | undefined, environmentRequest = 0;
  async function setEnvironment(id: string, asset: EnvironmentAsset) {
    const request = ++environmentRequest;
    const [texture, normal, roughness, models] = await Promise.all([
      new THREE.TextureLoader().loadAsync(asset.ground),
      asset.normal ? new THREE.TextureLoader().loadAsync(asset.normal) : undefined,
      asset.roughness ? new THREE.TextureLoader().loadAsync(asset.roughness) : undefined,
      Promise.all(asset.pieces.map(piece => new GLTFLoader().loadAsync(piece.url))),
    ]);
    if (request !== environmentRequest) return;
    const candidate = new THREE.Group();
    asset.pieces.forEach((piece, i) => {
      const source = models[i].scene, bounds = new THREE.Box3().setFromObject(source), height = bounds.max.y - bounds.min.y;
      if (!Number.isFinite(height) || height <= 0) throw new Error('场景模型尺寸无效');
      const center = bounds.getCenter(new THREE.Vector3());
      for (const placement of piece.instances) {
        const model = clone(source), pivot = new THREE.Group();
        model.position.add(new THREE.Vector3(-center.x, -bounds.min.y, -center.z)); pivot.add(model);
        pivot.scale.setScalar(piece.height / height * (placement.scale ?? 1)); pivot.rotation.y = placement.yaw ?? 0;
        pivot.position.fromArray(placement.position); model.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
        candidate.add(pivot);
      }
    });
    freeCamera(); importedEnvironment.clear(); importedEnvironment.add(candidate); environmentId = id;
    for (const object of scenery.children) object.visible = object === ground;
    texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    for (const map of [texture, normal, roughness]) if (map) { map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.setScalar(asset.groundRepeat ?? 40); map.anisotropy = renderer.capabilities.getMaxAnisotropy(); }
    ground.material.normalMap = normal ?? null; ground.material.roughnessMap = roughness ?? null; ground.material.normalScale.set(1, 1);
    ground.material.map = texture; ground.material.vertexColors = false; ground.material.color.set('#ffffff'); ground.material.needsUpdate = true;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i);
      const edge = THREE.MathUtils.smoothstep(Math.max(Math.abs(x) - 21, Math.abs(z) - 13), 0, 9);
      const hill = 4 + 2.3 * Math.sin(x * .065 + z * .024) + 1.5 * Math.cos(z * .097 - x * .027);
      const detail = .35 * Math.sin(x * .41) * Math.cos(z * .32) + .12 * Math.sin(x * 1.15 + z * .89);
      positions.setY(i, -.04 + edge * (hill + detail));
    }
    positions.needsUpdate = true; groundGeometry.computeVertexNormals(); sky.visible = true;
    scene.fog = new THREE.Fog('#b4c9cb', 60, 150); resetCamera();
  }
  function clearEnvironment() {
    environmentRequest++; environmentId = undefined; importedEnvironment.clear(); sky.visible = false;
    positions.array.set(originalGround); positions.needsUpdate = true; groundGeometry.computeVertexNormals();
    ground.material.map = ground.material.normalMap = ground.material.roughnessMap = null; ground.material.vertexColors = true; ground.material.needsUpdate = true;
    for (const object of scenery.children) object.visible = true;
    const id = terrainId; terrainId = undefined; if (id !== undefined) setTerrain(id);
  }
  let backdrop: THREE.Texture | undefined, plateMode = false, selectedBackdrop = false, plateRequest = 0;
  const backgrounds = new Map<string, THREE.Texture>();
  function resize() {
    if (selectedBackdrop && backdrop) {
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
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() / factor, controls.minDistance, controls.maxDistance));
    camera.position.copy(controls.target).add(offset); controls.update();
  }
  function applyMode(enabled: boolean) {
    camera.zoom = 1; camera.updateProjectionMatrix();
    plateMode = enabled; importedEnvironment.visible = !enabled; sky.visible = !enabled && !!environmentId; scenery.visible = !enabled; shadowFloor.visible = enabled; controls.enabled = true;
    scene.fog = enabled ? null : environmentId ? new THREE.Fog('#b4c9cb', 60, 150) : new THREE.Fog('#9aa79f', 38, 115);
    backdropBoard.visible = enabled; scene.background = new THREE.Color('#9aa79f'); resize();
  }
  async function setBackdrop(url: string) {
    const request = ++plateRequest;
    let texture = backgrounds.get(url);
    if (!texture) { texture = await new THREE.TextureLoader().loadAsync(url); texture.colorSpace = THREE.SRGBColorSpace; backgrounds.set(url, texture); }
    if (request !== plateRequest) return;
    backdrop = texture; backdropBoard.material.map = texture; backdropBoard.material.needsUpdate = true;
    const image = texture.image as HTMLImageElement; backdropBoard.scale.set(40, 40 * image.height / image.width, 1);
    selectedBackdrop = true; applyMode(true); resetCamera();
  }
  function freeCamera() { plateRequest++; selectedBackdrop = false; applyMode(false); }
  function frameUnit(position: THREE.Vector3) { plateRequest++; applyMode(false); controls.target.copy(position).add(new THREE.Vector3(0, 1.1, 0)); camera.position.copy(position).add(new THREE.Vector3(4.4, 3.5, 5.8)); controls.update(); }
  function resetCamera() {
    applyMode(selectedBackdrop);
    camera.zoom = 1; if (backdrop) { backdrop.repeat.setScalar(1); backdrop.offset.setScalar(0); } camera.updateProjectionMatrix();
    if (plateMode) { camera.position.set(12, 26, 40); controls.target.set(0, .8, 0); controls.update(); }
    else { camera.position.set(12, 26, 40); controls.target.set(0, .8, 0); controls.update(); }
  }

  function setMood(dusk: boolean) {
    const bg = dusk ? '#66788a' : '#9aa79f'; if (!plateMode) scene.background = new THREE.Color(bg); scene.fog?.color.set(bg);
    sun.color.set(dusk ? '#bacfea' : '#ffe0a4'); sun.intensity = dusk ? 1.8 : 3.2; ambient.intensity = dusk ? .8 : 1.25;
  }
  return { renderer, scene, camera, controls, updateCamera, grid, pickable, hover, showPath, showMovementRange, movementRange: () => [...rangeHexes], setObstacles, setTerrain, terrain: () => terrainId, obstacleCount: () => obstacleGroup.children.length, frameUnit, resetCamera, setMood, sun, zoomBy, setBackdrop, freeCamera, isBackdrop: () => plateMode, environment: () => environmentId, setEnvironment, clearEnvironment };
}
