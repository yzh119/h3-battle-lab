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

import bpy


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


def pack_clips(exports, output):
    base, binary = read_glb(exports[0][1])
    binary = bytearray(binary)
    names = [n.get('name') for n in base['nodes']]
    assert len(set(names)) == len(names), 'Animation retargeting needs unique node names'
    lookup = {name: i for i, name in enumerate(names)}
    base['animations'] = []
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
        for channel in clip['channels']:
            name = doc['nodes'][channel['target']['node']]['name']
            assert name in lookup, ('Missing animation target', name)
            channel['target']['node'] = lookup[name]
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


args = argparse.ArgumentParser()
args.add_argument('--out', type=Path, required=True)
args.add_argument('--source', action='append', required=True, help='id=/directory/of/blend/scenes')
opts = args.parse_args(sys.argv[sys.argv.index('--') + 1:])
opts.out.mkdir(parents=True, exist_ok=True)
manifest = {'units': {}}
labels = {'skeleton': '骷髅兵', 'zombie': '僵尸'}
for item in opts.source:
    identifier, directory = item.split('=', 1)
    assert identifier.replace('-', '').isalnum(), 'Use a simple creature identifier'
    exports = []
    with tempfile.TemporaryDirectory(prefix='battle-export-') as temporary:
        for action, filename in [('idle', 'holding'), ('walk', 'moving'), ('attack', 'attack_front'), ('hit', 'hitted'), ('death', 'death')]:
            source = Path(directory) / (filename + '.blend')
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
        clips = pack_clips(exports, opts.out / (identifier + '.glb'))
    manifest['units'][identifier] = {'label': labels.get(identifier, identifier),
                                    'url': f'/local-assets/{identifier}.glb', 'height': 2.35, 'clips': clips}
    print('EXPORTED', identifier, clips, flush=True)
(opts.out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
