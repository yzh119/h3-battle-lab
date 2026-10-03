import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { type VisualUnit as Unit } from './presentation.ts';
import { fromHexId } from './presentation.ts';
import { worldPosition, type EnvironmentAsset } from './world.ts';

export interface Asset { label: string; url: string; height?: number; faction?: string; draft?: boolean; forward?: '+z' | '-z' | '+x' | '-x' }
export interface Manifest { environments?: Record<string, EnvironmentAsset>; backgrounds?: { label: string; url: string }[]; units: Record<string, Asset> }
const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();
function load(url: string) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url).catch(error => { cache.delete(url); throw error; }));
  return cache.get(url)!;
}

function standIn(team: number, kind = '') {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: team ? '#884f42' : '#536f7d', metalness: .3, roughness: .45 });
  const trim = new THREE.MeshStandardMaterial({ color: '#c8b98b', metalness: .5, roughness: .35 });
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const obj = new THREE.Mesh(geometry, material); obj.position.set(x, y, z); obj.castShadow = true; root.add(obj); return obj;
  };
  if (['core:ballista', 'core:ammoCart', 'core:firstAidTent', 'core:catapult'].includes(kind)) {
    const wood = new THREE.MeshStandardMaterial({ color: '#79593a', roughness: .9 });
    const wheels = () => { for (const x of [-.66, .66]) for (const z of [-.45, .45]) { const wheel = mesh(new THREE.CylinderGeometry(.28, .28, .13, 10), wood, x, .28, z); wheel.rotation.z = Math.PI / 2; } };
    if (kind === 'core:firstAidTent') {
      const roof = mesh(new THREE.CylinderGeometry(.85, .85, 1.5, 3), body, 0, .95, 0); roof.rotation.z = Math.PI / 2; roof.rotation.y = Math.PI / 2;
      mesh(new THREE.BoxGeometry(.16, .62, .04), trim, 0, .8, .8); mesh(new THREE.BoxGeometry(.5, .16, .04), trim, 0, .8, .82);
    } else {
      wheels(); mesh(new THREE.BoxGeometry(1.15, .45, 1.2), wood, 0, .65, 0);
      if (kind === 'core:ammoCart') {
        mesh(new THREE.BoxGeometry(1.08, .58, 1.12), body, 0, 1.1, 0);
        for (const x of [-.35, 0, .35]) { const bolt = mesh(new THREE.CylinderGeometry(.025, .025, 1.15, 6), trim, x, 1.42, 0); bolt.rotation.x = Math.PI / 2; }
      } else {
        mesh(new THREE.BoxGeometry(.18, .2, 1.9), body, 0, 1.04, 0); mesh(new THREE.BoxGeometry(1.65, .14, .18), wood, 0, 1.12, .48);
        const bolt = mesh(new THREE.CylinderGeometry(.035, .035, 1.7, 6), trim, 0, 1.19, .12); bolt.rotation.x = Math.PI / 2;
      }
    }
    return { root, legs: [] as THREE.Mesh[], arms: [] as THREE.Mesh[] };
  }
  mesh(new THREE.CapsuleGeometry(.29, .48, 4, 10), body, 0, 1.32, 0);
  mesh(new THREE.SphereGeometry(.24, 12, 8), trim, 0, 2, 0);
  const legs = [-1, 1].map(sign => mesh(new THREE.CapsuleGeometry(.105, .68, 4, 8), body, sign * .18, .48, 0));
  const arms = [-1, 1].map(sign => mesh(new THREE.CapsuleGeometry(.09, .52, 4, 8), trim, sign * .42, 1.26, 0));
  return { root, legs, arms };
}

// Presentation dimensions in battlefield world units; no rule or occupancy data.
const displayHeight: Record<string, number> = {
  skeleton: 2.05, 'skeleton-warrior': 2.1, zombie: 2.3, 'zombie-upgraded': 2.3,
  griffin: 2.9, 'royal-griffin': 3.0, cavalier: 3.2, champion: 3.3,
  'black-knight': 3.2, 'dread-knight': 3.3, angel: 3.4, archangel: 3.65,
  'bone-dragon': 3.9, 'ghost-dragon': 4.05,
};
export class UnitView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly bases = new THREE.Group();
  private readonly centerOffset = new THREE.Vector3();
  footprint: number[] = [];
  readonly height: number;
  readonly proxy: THREE.Mesh;
  readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  model: THREE.Object3D;
  mixer?: THREE.AnimationMixer;
  clips: THREE.AnimationClip[] = [];
  current = 'idle';
  private action?: THREE.AnimationAction;
  private dummy?: ReturnType<typeof standIn>;
  private animationTime = 0;
  private remaining = 0;
  imported = false;
  playbackHp?: number;
  allowDeadTarget = false;
  get displayedHp(): number { return this.playbackHp ?? this.unit.hp; }
  private assetRevision = 0;
  private disposed = false;
  poseSignature(): string {
    const transforms: number[] = [];
    this.model.traverse(object => {
      if (object instanceof THREE.Bone) transforms.push(...object.position.toArray(), ...object.quaternion.toArray());
    });
    return transforms.map(n => n.toFixed(4)).join(',');
  }
  constructor(readonly unit: Unit) {
    this.height = displayHeight[unit.kind] ?? 2.35;
    this.root.add(this.body, this.bases);
    this.dummy = standIn(unit.team, unit.kind); this.model = this.dummy.root; this.body.add(this.model);
    this.root.position.copy(worldPosition(unit.cell)); this.root.rotation.y = unit.team ? -Math.PI / 2 : Math.PI / 2;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(.98, 1.04, 6, 1, Math.PI / 6), new THREE.MeshBasicMaterial({ color: unit.team ? '#ef9a76' : '#acdada', side: THREE.DoubleSide, transparent: true, opacity: .85, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = .025; this.bases.add(this.ring);
    this.proxy = new THREE.Mesh(new THREE.CylinderGeometry(.6, .6, 2.6, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.model.scale.setScalar(this.height / 2.35);
    this.proxy.scale.y = this.height / 2.6; this.proxy.position.y = this.height / 2; this.proxy.userData.unitId = unit.id; this.body.add(this.proxy);
  }
  async setAsset(asset: Asset): Promise<void> {
    const revision = ++this.assetRevision;
    const gltf = await load(asset.url);
    if (this.disposed || revision !== this.assetRevision) return;
    const model = clone(gltf.scene);
    model.updateMatrixWorld(true);
    // Scene variants start inactive at zero scale. Including their skinned
    // meshes in bounds can divide by a singular bind matrix and produce NaN.
    const box = new THREE.Box3();
    for (const child of model.children) {
      if (child.scale.x === 0 || child.scale.y === 0 || child.scale.z === 0) continue;
      box.expandByObject(child);
    }
    const height = box.max.y - box.min.y;
    if (!Number.isFinite(height) || height <= 0) throw new Error('模型没有有效的立体尺寸');
    // Measure the active skeleton's crown, not spear tips, bows or wings.
    let crown = -Infinity, toes = Infinity;
    let bodyCenter: THREE.Vector3 | undefined;
    model.traverse(object => {
      if (!/(?:head_end|lefttoebase|righttoebase|hips)$/i.test(object.name)) return;
      for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
        if (!parent.visible || parent.scale.x === 0 || parent.scale.y === 0 || parent.scale.z === 0) return;
      }
      const position = object.getWorldPosition(new THREE.Vector3());
      if (/head_end$/i.test(object.name)) crown = Math.max(crown, position.y);
      if (/(?:left|right)toebase$/i.test(object.name)) toes = Math.min(toes, position.y);
      if (/hips$/i.test(object.name) && !bodyCenter) bodyCenter = position;

    });
    const mounted = ['cavalier', 'champion', 'black-knight', 'dread-knight'].includes(this.unit.kind);
    const floor = !mounted && Number.isFinite(toes) ? toes - .025 : box.min.y;
    const bodyHeight = Number.isFinite(crown) && crown > floor ? crown - floor : height;
    const wrapper = new THREE.Group(); model.position.y -= floor;
    wrapper.add(model); wrapper.scale.setScalar(((asset.height ?? 2.35) * this.height / 2.35) / bodyHeight);
    const center = bodyCenter ?? box.getCenter(new THREE.Vector3()); model.position.x -= center.x; model.position.z -= center.z;
    // The horse exports face -X; navigation and procedural models face +Z.
    const forward = asset.forward ?? (['cavalier', 'champion'].includes(this.unit.kind) ? '-x' : '+z');
    wrapper.rotation.y = { '+z': 0, '-z': Math.PI, '+x': -Math.PI / 2, '-x': Math.PI / 2 }[forward];
    model.traverse(object => {
      if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; }
    });
    this.mixer?.stopAllAction();
    if (this.mixer) this.mixer.uncacheRoot(this.mixer.getRoot());
    this.disposeDummy();
    this.body.remove(this.model); this.model = wrapper; this.body.add(wrapper); this.dummy = undefined;
    this.clips = gltf.animations; this.mixer = new THREE.AnimationMixer(model); this.action = undefined;
    const current = this.current, once = this.remaining > 0 || current === 'death';
    this.imported = true; this.current = ''; this.play(this.clips.some(clip => clip.name === current) ? current : 'idle', once);
  }
  setFootprint(hexes: number[]): void {
    this.footprint = [...hexes]; this.bases.clear();
    const anchor = worldPosition(this.unit.cell); this.centerOffset.set(0, 0, 0);
    const cells = hexes.length ? hexes.map(hex => worldPosition(fromHexId(hex)).sub(anchor)) : [new THREE.Vector3()];
    for (const offset of cells) {
      const marker = new THREE.Mesh(this.ring.geometry, this.ring.material);
      marker.rotation.x = -Math.PI / 2; marker.position.copy(offset); marker.position.y = .025; this.bases.add(marker);
      this.centerOffset.add(offset);
    }
    this.centerOffset.divideScalar(cells.length); this.updatePlacement();
  }
  private updatePlacement(): void {
    this.bases.rotation.y = -this.root.rotation.y;
    this.body.position.copy(this.centerOffset).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.root.rotation.y);
  }
  visualPosition(): THREE.Vector3 { return this.root.position.clone().add(this.centerOffset); }
  private disposeDummy(): void {
    if (this.dummy) this.dummy.root.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
      }
    });
    this.dummy = undefined;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.assetRevision++;
    this.mixer?.stopAllAction();
    if (this.mixer) this.mixer.uncacheRoot(this.mixer.getRoot());
    this.disposeDummy();
    this.ring.geometry.dispose(); this.ring.material.dispose();
    this.proxy.geometry.dispose(); (this.proxy.material as THREE.Material).dispose();
    this.root.removeFromParent();
  }
  play(name: string, once = false): number {
    this.current = name; this.animationTime = 0;
    const requested = name;
    if (name === 'shoot' && !this.clips.some(c => c.name.toLowerCase().includes('shoot'))) name = 'attack';
    const clip = this.clips.find(c => c.name.toLowerCase() === name)
      ?? this.clips.find(c => c.name.toLowerCase().includes(name));
    if (clip && this.mixer) {
      const next = this.mixer.clipAction(clip); const previous = this.action;
      next.reset(); next.enabled = true; next.setEffectiveTimeScale(1); next.setEffectiveWeight(1);
      next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity); next.clampWhenFinished = once;
      if (previous && previous !== next) { previous.fadeOut(.16); next.fadeIn(.16); }
      next.play(); this.action = next;
      this.remaining = once && name !== 'death' ? clip.duration : 0;
      return clip.duration;
    }
    this.current = requested;
    this.remaining = once && name !== 'death' ? 1.1 : 0;
    return 1.1;
  }
  update(dt: number, selected: boolean): void {
    this.updatePlacement(); this.animationTime += dt; this.mixer?.update(dt);
    if (this.remaining > 0) { this.remaining -= dt; if (this.remaining <= 0) this.play('idle'); }
    if (this.dummy) {
      const stride = this.current === 'walk' ? Math.sin(this.animationTime * 8) * .5 : 0;
      this.dummy.legs.forEach((leg, i) => { leg.rotation.x = stride * (i ? -1 : 1); });
      this.dummy.arms.forEach((arm, i) => { arm.rotation.x = ['attack', 'shoot'].includes(this.current) ? -Math.sin(Math.min(this.animationTime / 1.1, 1) * Math.PI) * 1.9 : -stride * (i ? -1 : 1); });
      this.model.rotation.z = this.current === 'death' ? -Math.PI / 2 : 0;
    }
    this.ring.material.opacity = selected ? .8 + .18 * Math.sin(performance.now() / 350) : .35;
    this.proxy.visible = this.displayedHp > 0 || this.allowDeadTarget; this.bases.visible = this.displayedHp > 0;
  }
}
