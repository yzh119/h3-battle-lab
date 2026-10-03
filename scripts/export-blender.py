"""Export local creature scenes to one GLB per creature; never writes art to Git.

blender -b --python scripts/export-blender.py -- \
  --out public/local-assets --source skeleton=/path/to/scenes
Scenes: holding.blend, moving.blend, attack_front.blend, hitted.blend, death.blend.
"""
import argparse
import copy
import json
import hashlib
import struct
import sys
import tempfile
from pathlib import Path



def read_glb(path):
    raw = Path(path).read_bytes()
    magic, version, length = struct.unpack_from('<III', raw)
    assert magic == 0x46546C67 and version == 2 and length == len(raw)
    offset, document, binary = 12, None, b''
    while offset < len(raw):
        size, kind = struct.unpack_from('<II', raw, offset)
        data = raw[offset + 8:offset + 8 + size]
        if kind == 0x4E4F534A:
            document = json.loads(data)
        elif kind == 0x004E4942:
            binary = data
        offset += 8 + size
    return document, binary


def node_paths(document):
    """Rig-local bone names may repeat; resolve nodes by their complete ancestry."""
    nodes = document['nodes']
    parents = {}
    for i, node in enumerate(nodes):
        for child in node.get('children', []):
            assert child not in parents, ('Multiple node parents', child)
            parents[child] = i
    paths = {}
    def resolve(i, seen):
        if i in paths:
            return paths[i]
        assert i not in seen, ('Cyclic node hierarchy', i)
        name = nodes[i].get('name', f'unnamed-{i}')
        path = (resolve(parents[i], seen | {i}) if i in parents else ()) + (name,)
        paths[i] = path
        return path
    result = [resolve(i, set()) for i in range(len(nodes))]
    assert len(set(result)) == len(result), 'Animation targets need unique hierarchical paths'
    return result


def pack_clips(exports, output, geometry_clip=None):
    geometry = next((source for label, source in exports if label == geometry_clip), exports[0][1])
    base, binary = read_glb(geometry)
    binary = bytearray(binary)
    lookup = {path: i for i, path in enumerate(node_paths(base))}
    base['animations'] = []
    # Weapons/effects may exist only in some scenes. Use a chosen complete geometry
    # scene and add explicit scale visibility to meshes absent from other clips.
    source_paths = [set(node_paths(read_glb(source)[0])) for _, source in exports]
    optional_meshes = {path: i for path, i in lookup.items() if 'mesh' in base['nodes'][i] and any(path not in paths for paths in source_paths)}
    for label, source in exports:
        doc, data = read_glb(source)
        assert len(doc.get('animations', [])) == 1, (source, 'Expected one baked scene clip')
        clip = copy.deepcopy(doc['animations'][0])
        clip['name'] = label
        accessor_map = {}
        for sampler in clip['samplers']:
            for field in ['input', 'output']:
                old = sampler[field]
                if old not in accessor_map:
                    accessor = copy.deepcopy(doc['accessors'][old])
                    assert 'sparse' not in accessor, 'Sparse animation data is not supported'
                    view = copy.deepcopy(doc['bufferViews'][accessor['bufferView']])
                    start = view.get('byteOffset', 0)
                    while len(binary) % 4:
                        binary.append(0)
                    view['buffer'] = 0
                    view['byteOffset'] = len(binary)
                    binary.extend(data[start:start + view['byteLength']])
                    accessor['bufferView'] = len(base['bufferViews'])
                    base['bufferViews'].append(view)
                    accessor_map[old] = len(base['accessors'])
                    base['accessors'].append(accessor)
                sampler[field] = accessor_map[old]
        paths = node_paths(doc)
        for channel in clip['channels']:
            path = paths[channel['target']['node']]
            assert path in lookup, ('Missing animation target', path)
            channel['target']['node'] = lookup[path]
        for path, target in optional_meshes.items():
            if any(c['target']['node'] == target and c['target']['path'] == 'scale' for c in clip['channels']):
                continue
            source_node = next((doc['nodes'][i] for i, p in enumerate(paths) if p == path), None)
            scale = source_node.get('scale', [1, 1, 1]) if source_node else [0, 0, 0]
            assert not source_node or 'matrix' not in source_node, 'Optional animated mesh must use TRS transforms'
            accessors = []
            for values, kind in [([0], 'SCALAR'), (scale, 'VEC3')]:
                while len(binary) % 4:
                    binary.append(0)
                payload = struct.pack('<' + 'f' * len(values), *values)
                view = len(base['bufferViews'])
                base['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(payload)})
                binary.extend(payload)
                accessors.append(len(base['accessors']))
                accessor = {'bufferView': view, 'componentType': 5126, 'count': 1, 'type': kind}
                if kind == 'SCALAR':
                    accessor.update({'min': [0], 'max': [0]})
                base['accessors'].append(accessor)
            sampler = len(clip['samplers'])
            clip['samplers'].append({'input': accessors[0], 'output': accessors[1], 'interpolation': 'STEP'})
            clip['channels'].append({'sampler': sampler, 'target': {'node': target, 'path': 'scale'}})
        base['animations'].append(clip)
    while len(binary) % 4:
        binary.append(0)
    base['buffers'] = [{'byteLength': len(binary)}]
    encoded = json.dumps(base, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    total = 12 + 8 + len(encoded) + 8 + len(binary)
    Path(output).write_bytes(struct.pack('<III', 0x46546C67, 2, total)
                            + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded
                            + struct.pack('<II', len(binary), 0x004E4942) + binary)
    return [{'name': a['name'], 'channels': len(a['channels'])} for a in base['animations']]


def share_identical_payloads(document, data):
    """Share exact buffer bytes and texture sources without changing scene data."""
    packed = bytearray()
    offsets = {}
    for view in document.get('bufferViews', []):
        assert view.get('buffer', 0) == 0, 'Expected an embedded GLB buffer'
        start, size = view.get('byteOffset', 0), view['byteLength']
        payload = data[start:start + size]
        assert len(payload) == size, 'Buffer view exceeds binary payload'
        key = (size, hashlib.sha256(payload).digest())
        offset = offsets.get(key)
        if offset is None or packed[offset:offset + size] != payload:
            while len(packed) % 4: packed.append(0)
            offset = len(packed); packed.extend(payload); offsets[key] = offset
        view['byteOffset'] = offset
    # GLTFLoader caches textures by image source and sampler. Redirect identical
    # embedded images/samplers to one source so scenes share decoded GPU textures.
    images, samplers = {}, {}
    image_ids, sampler_ids = {}, {}
    for index, image in enumerate(document.get('images', [])):
        identity = {k: v for k, v in image.items() if k not in ('name', 'bufferView')}
        if 'bufferView' in image:
            view = document['bufferViews'][image['bufferView']]
            identity['payload'] = [view['byteOffset'], view['byteLength']]
        key = json.dumps(identity, sort_keys=True)
        image_ids[index] = images.setdefault(key, index)
    for index, sampler in enumerate(document.get('samplers', [])):
        key = json.dumps({k: v for k, v in sampler.items() if k != 'name'}, sort_keys=True)
        sampler_ids[index] = samplers.setdefault(key, index)
    for texture in document.get('textures', []):
        if 'source' in texture: texture['source'] = image_ids[texture['source']]
        if 'sampler' in texture: texture['sampler'] = sampler_ids[texture['sampler']]
    while len(packed) % 4: packed.append(0)
    document['buffers'] = [{'byteLength': len(packed)}]
    return packed


def pack_scene_variants(exports, output):
    """Keep clip-specific rigs/geometry intact when an action changes hierarchy."""
    base = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': []}]}
    keys = ['nodes', 'meshes', 'skins', 'materials', 'textures', 'images', 'samplers', 'accessors', 'bufferViews', 'animations']
    for key in keys: base[key] = []
    binary = bytearray()
    groups = []
    for label, source in exports:
        doc, data = read_glb(source)
        assert len(doc.get('animations', [])) == 1, 'Expected one scene animation'
        offsets = {key: len(base[key]) for key in keys}
        while len(binary) % 4: binary.append(0)
        byte_offset = len(binary); binary.extend(data)
        for key in keys:
            for item in copy.deepcopy(doc.get(key, [])):
                if key == 'bufferViews':
                    item['buffer'] = 0; item['byteOffset'] = item.get('byteOffset', 0) + byte_offset
                elif key == 'accessors':
                    if 'sparse' in item:
                        for part in ['indices', 'values']: item['sparse'][part]['bufferView'] += offsets['bufferViews']
                    if 'bufferView' in item: item['bufferView'] += offsets['bufferViews']
                elif key == 'images':
                    if 'bufferView' in item: item['bufferView'] += offsets['bufferViews']
                elif key == 'textures':
                    for field, target in [('source', 'images'), ('sampler', 'samplers')]:
                        if field in item: item[field] += offsets[target]
                elif key == 'materials':
                    def textures(value):
                        if isinstance(value, dict):
                            for field, child in value.items():
                                if field.endswith('Texture') and isinstance(child, dict) and 'index' in child: child['index'] += offsets['textures']
                                else: textures(child)
                        elif isinstance(value, list):
                            for child in value: textures(child)
                    textures(item)
                elif key == 'meshes':
                    for primitive in item['primitives']:
                        for field, target in [('indices', 'accessors'), ('material', 'materials')]:
                            if field in primitive: primitive[field] += offsets[target]
                        primitive['attributes'] = {k: v + offsets['accessors'] for k, v in primitive['attributes'].items()}
                        for target in primitive.get('targets', []):
                            for k in target: target[k] += offsets['accessors']
                elif key == 'nodes':
                    for field, target in [('mesh', 'meshes'), ('skin', 'skins')]:
                        if field in item: item[field] += offsets[target]
                    if 'children' in item: item['children'] = [v + offsets['nodes'] for v in item['children']]
                    item['name'] = label + ':' + item.get('name', 'node')
                elif key == 'skins':
                    item['joints'] = [v + offsets['nodes'] for v in item['joints']]
                    if 'skeleton' in item: item['skeleton'] += offsets['nodes']
                    if 'inverseBindMatrices' in item: item['inverseBindMatrices'] += offsets['accessors']
                elif key == 'animations':
                    item['name'] = label
                    for sampler in item['samplers']:
                        for field in ['input', 'output']: sampler[field] += offsets['accessors']
                    for channel in item['channels']: channel['target']['node'] += offsets['nodes']
                base[key].append(item)
        for key in ['extensionsUsed', 'extensionsRequired']:
            base[key] = sorted(set(base.get(key, [])) | set(doc.get(key, [])))
        group = len(base['nodes']); groups.append(group)
        base['nodes'].append({'name': label + ':scene', 'children': [v + offsets['nodes'] for v in doc['scenes'][doc.get('scene', 0)]['nodes']], 'scale': [1, 1, 1] if len(groups) == 1 else [0, 0, 0]})
        base['scenes'][0]['nodes'].append(group)
    for index, clip in enumerate(base['animations']):
        for selected, group in enumerate(groups):
            refs = []
            for values, kind in [([0.0], 'SCALAR'), ([1.0 if selected == index else 0.0] * 3, 'VEC3')]:
                while len(binary) % 4: binary.append(0)
                payload = struct.pack('<' + 'f' * len(values), *values)
                view = len(base['bufferViews']); base['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(payload)}); binary.extend(payload)
                refs.append(len(base['accessors'])); accessor = {'bufferView': view, 'componentType': 5126, 'count': 1, 'type': kind}
                if kind == 'SCALAR': accessor.update({'min': [0], 'max': [0]})
                base['accessors'].append(accessor)
            sampler = len(clip['samplers']); clip['samplers'].append({'input': refs[0], 'output': refs[1], 'interpolation': 'STEP'})
            clip['channels'].append({'sampler': sampler, 'target': {'node': group, 'path': 'scale'}})
    binary = share_identical_payloads(base, binary)
    encoded = json.dumps(base, separators=(',', ':')).encode(); encoded += b' ' * (-len(encoded) % 4)
    Path(output).write_bytes(struct.pack('<III', 0x46546C67, 2, 28 + len(encoded) + len(binary)) + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded + struct.pack('<II', len(binary), 0x004E4942) + binary)
    return [{'name': a['name'], 'channels': len(a['channels'])} for a in base['animations']]


def main():
    import bpy

    args = argparse.ArgumentParser()
    args.add_argument('--out', type=Path, required=True)
    args.add_argument('--source', action='append', default=[], help='id=/directory/of/blend/scenes')
    args.add_argument('--config', type=Path, help='Private JSON with units and per-clip scene paths')
    opts = args.parse_args(sys.argv[sys.argv.index('--') + 1:])
    opts.out.mkdir(parents=True, exist_ok=True)
    manifest_path = opts.out / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {'units': {}}
    entries = json.loads(opts.config.read_text())['units'] if opts.config else {}
    labels = {'skeleton': '骷髅兵', 'zombie': '僵尸'}
    for item in opts.source:
        identifier, directory = item.split('=', 1)
        entries[identifier] = {'directory': directory}
    assert entries, 'Provide --source or --config'
    for identifier, entry in entries.items():
        assert identifier.replace('-', '').isalnum(), 'Use a simple creature identifier'
        default_scenes = {'idle': 'holding', 'walk': 'moving', 'attack': 'attack_front', 'hit': 'hitted', 'death': 'death'}
        if 'scenes' in entry:
            scenes = entry['scenes']
            assert set(default_scenes).issubset(scenes), 'Provide idle, walk, attack, hit and death scenes'
        else:
            scenes = {action: str(Path(entry['directory']) / (filename + '.blend')) for action, filename in default_scenes.items()}
            shoot = Path(entry['directory']) / 'shoot_front.blend'
            if shoot.exists():
                scenes['shoot'] = str(shoot)
        for action, source in scenes.items():
            assert action.replace('-', '').isalnum(), 'Use a simple clip name'
            assert Path(source).is_file(), ('Missing scene', action, source)
        if 'geometryClip' in entry:
            assert entry['geometryClip'] in scenes, 'geometryClip must name a configured clip'
        exports = []
        with tempfile.TemporaryDirectory(prefix='battle-export-') as temporary:
            for action, filename in scenes.items():
                source = Path(filename)
                bpy.ops.wm.open_mainfile(filepath=str(source))
                scene = bpy.context.scene
                override = entry.get('actions', {}).get(action)
                if override:
                    rig = bpy.data.objects[override['rig']]
                    assert rig.type == 'ARMATURE', 'Configured action needs an armature'
                    assert isinstance(override['frames'], int) and override['frames'] > 0
                    rig.animation_data_create()
                    rig.animation_data.action = bpy.data.actions[override['action']]
                    scene.frame_start, scene.frame_end = 1, override['frames']
                scene.frame_set(scene.frame_start)
                bpy.ops.object.select_all(action='DESELECT')
                for obj in scene.objects:
                    if obj.type in {'MESH', 'ARMATURE', 'EMPTY'} and not obj.hide_render:
                        obj.hide_set(False)
                        obj.select_set(True)
                path = Path(temporary) / (action + '.glb')
                bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
                                          export_animations=True, export_animation_mode='SCENE',
                                          export_anim_scene_split_object=False, export_force_sampling=True,
                                          export_frame_range=True, export_anim_slide_to_zero=True,
                                          export_cameras=False, export_lights=False)
                exports.append((action, path))
            clips = pack_scene_variants(exports, opts.out / (identifier + '.glb')) if entry.get('sceneVariants') else pack_clips(exports, opts.out / (identifier + '.glb'), entry.get('geometryClip'))
        manifest['units'][identifier] = {'label': entry.get('label', labels.get(identifier, identifier)),
                                        'url': f'/local-assets/{identifier}.glb?v={hashlib.sha256((opts.out / (identifier + ".glb")).read_bytes()).hexdigest()[:16]}', 'height': entry.get('height', 2.35), 'clips': clips,
                                        'faction': entry.get('faction', '墓园'), 'draft': entry.get('draft', False)}
        print('EXPORTED', identifier, clips, flush=True)
    (opts.out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
