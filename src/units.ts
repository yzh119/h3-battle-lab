import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { type Unit } from './battle.ts';
import { worldPosition } from './world.ts';

export interface Asset { label: string; url: string; height?: number }
export interface Manifest { backgrounds?: { label: string; url: string }[]; units: Record<string, Asset> }
const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();
function load(url: string) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url).catch(error => { cache.delete(url); throw error; }));
  return cache.get(url)!;
}

function standIn(team: number) {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: team ? '#884f42' : '#536f7d', metalness: .3, roughness: .45 });
  const trim = new THREE.MeshStandardMaterial({ color: '#c8b98b', metalness: .5, roughness: .35 });
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const obj = new THREE.Mesh(geometry, material); obj.position.set(x, y, z); obj.castShadow = true; root.add(obj); return obj;
  };
  mesh(new THREE.CapsuleGeometry(.29, .48, 4, 10), body, 0, 1.32, 0);
  mesh(new THREE.SphereGeometry(.24, 12, 8), trim, 0, 2, 0);
  const legs = [-1, 1].map(sign => mesh(new THREE.CapsuleGeometry(.105, .68, 4, 8), body, sign * .18, .48, 0));
  const arms = [-1, 1].map(sign => mesh(new THREE.CapsuleGeometry(.09, .52, 4, 8), trim, sign * .42, 1.26, 0));
  return { root, legs, arms };
}

export class UnitView {
  readonly root = new THREE.Group();
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
  poseSignature(): string {
    const transforms: number[] = [];
    this.model.traverse(object => {
      if (object instanceof THREE.Bone) transforms.push(...object.position.toArray(), ...object.quaternion.toArray());
    });
    return transforms.map(n => n.toFixed(4)).join(',');
  }
  constructor(readonly unit: Unit) {
    this.dummy = standIn(unit.team); this.model = this.dummy.root; this.root.add(this.model);
    this.root.position.copy(worldPosition(unit.cell)); this.root.rotation.y = unit.team ? -Math.PI / 2 : Math.PI / 2;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(.65, .72, 64), new THREE.MeshBasicMaterial({ color: unit.team ? '#ef9a76' : '#acdada', side: THREE.DoubleSide, transparent: true, opacity: .85, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = .025; this.root.add(this.ring);
    this.proxy = new THREE.Mesh(new THREE.CylinderGeometry(.6, .6, 2.6, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.proxy.position.y = 1.3; this.proxy.userData.unitId = unit.id; this.root.add(this.proxy);
  }
  async setAsset(asset: Asset): Promise<void> {
    const gltf = await load(asset.url); const model = clone(gltf.scene);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model); const height = box.max.y - box.min.y;
    if (!Number.isFinite(height) || height <= 0) throw new Error('模型没有有效的立体尺寸');
    const wrapper = new THREE.Group(); model.position.y -= box.min.y;
    wrapper.add(model); wrapper.scale.setScalar((asset.height ?? 2.35) / height);
    model.traverse(object => {
      if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; }
    });
    this.root.remove(this.model); this.model = wrapper; this.root.add(wrapper); this.dummy = undefined;
    this.clips = gltf.animations; this.mixer = new THREE.AnimationMixer(model); this.action = undefined;
    this.imported = true; this.current = ''; this.play('idle');
  }
  play(name: string, once = false): number {
    this.current = name; this.animationTime = 0;
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
    this.remaining = once && name !== 'death' ? 1.1 : 0;
    return 1.1;
  }
  update(dt: number, selected: boolean): void {
    this.animationTime += dt; this.mixer?.update(dt);
    if (this.remaining > 0) { this.remaining -= dt; if (this.remaining <= 0) this.play('idle'); }
    if (this.dummy) {
      const stride = this.current === 'walk' ? Math.sin(this.animationTime * 8) * .5 : 0;
      this.dummy.legs.forEach((leg, i) => { leg.rotation.x = stride * (i ? -1 : 1); });
      this.dummy.arms.forEach((arm, i) => { arm.rotation.x = this.current === 'attack' ? -Math.sin(Math.min(this.animationTime / 1.1, 1) * Math.PI) * 1.9 : -stride * (i ? -1 : 1); });
      this.model.rotation.z = this.current === 'death' ? -Math.PI / 2 : 0;
    }
    this.ring.material.opacity = selected ? .8 + .18 * Math.sin(performance.now() / 350) : .35;
    this.proxy.visible = this.unit.hp > 0; this.ring.visible = this.unit.hp > 0;
  }
}
