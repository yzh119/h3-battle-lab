"""Export local creature scenes to one GLB per creature; never writes art to Git.

blender -b --python scripts/export-blender.py -- \
  --out public/local-assets --source skeleton=/path/to/scenes
Scenes: holding.blend, moving.blend, attack_front.blend, hitted.blend, death.blend.
"""
import argparse
import copy
import json
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
            clips = pack_clips(exports, opts.out / (identifier + '.glb'), entry.get('geometryClip'))
        manifest['units'][identifier] = {'label': entry.get('label', labels.get(identifier, identifier)),
                                        'url': f'/local-assets/{identifier}.glb', 'height': entry.get('height', 2.35), 'clips': clips,
                                        'faction': entry.get('faction', '墓园'), 'draft': entry.get('draft', False)}
        print('EXPORTED', identifier, clips, flush=True)
    (opts.out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
