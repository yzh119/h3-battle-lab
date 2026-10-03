"""Bake procedural base colours in copied creature scenes, preserving originals.

blender -b --python-exit-code 1 --python scripts/bake-blender-materials.py -- \
  --config /path/to/local-export.json --out /path/to/new-local-stage
The output export-config.json is consumed by export-blender.py. No art is public.
"""
import argparse
import json
import re
import sys
from pathlib import Path


def surface_shader(mat):
    if not mat or not mat.use_nodes:
        return None
    output = next((n for n in mat.node_tree.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output), None)
    if not output or not output.inputs['Surface'].is_linked:
        return None
    shader = output.inputs['Surface'].links[0].from_node
    return shader if shader.type == 'BSDF_PRINCIPLED' else None


def procedural(mat):
    shader = surface_shader(mat)
    color = shader.inputs['Base Color'] if shader else None
    return bool(color and color.is_linked and color.links[0].from_node.type != 'TEX_IMAGE')


def apply_texture(obj, image, indices):
    import bpy
    for index in indices:
        mat = obj.material_slots[index].material.copy()
        obj.material_slots[index].material = mat
        shader = surface_shader(mat)
        if not shader:
            raise ValueError('Baking requires a Principled surface: ' + mat.name)
        color = shader.inputs['Base Color']
        for link in list(color.links):
            mat.node_tree.links.remove(link)
        texture = mat.node_tree.nodes.new('ShaderNodeTexImage')
        texture.image = image
        mat.node_tree.links.new(texture.outputs['Color'], color)


def bake_object(obj, path, resolution):
    import bpy
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    if not obj.data.uv_layers:
        obj.data.uv_layers.new(name='BakedBaseColorUV')
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=1.1519, island_margin=.015)
        bpy.ops.object.mode_set(mode='OBJECT')
    indices = [i for i, slot in enumerate(obj.material_slots) if procedural(slot.material)]
    image = bpy.data.images.new(obj.name + ' baked base colour', width=resolution, height=resolution)
    image.colorspace_settings.name = 'sRGB'
    restore = []
    # Bake the exact colour graph as emission; lighting/metalness are excluded.
    for slot in obj.material_slots:
        if not slot.material or not slot.material.use_nodes:
            raise ValueError('Baked mesh requires node materials: ' + obj.name)
        mat = slot.material.copy()
        slot.material = mat
        tree = mat.node_tree
        shader = surface_shader(mat)
        if not shader:
            raise ValueError('Baking requires a Principled surface: ' + mat.name)
        output = next(n for n in tree.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
        original = output.inputs['Surface'].links[0].from_socket
        emission = tree.nodes.new('ShaderNodeEmission')
        color = shader.inputs['Base Color']
        if color.is_linked:
            tree.links.new(color.links[0].from_socket, emission.inputs['Color'])
        else:
            emission.inputs['Color'].default_value = color.default_value
        tree.links.new(emission.outputs[0], output.inputs['Surface'])
        target = tree.nodes.new('ShaderNodeTexImage')
        target.image = image
        tree.nodes.active = target
        restore.append((tree, original, output, emission, target))
    bpy.ops.object.bake(type='EMIT', use_clear=True, margin=8)
    for tree, original, output, emission, target in restore:
        tree.links.new(original, output.inputs['Surface'])
        tree.nodes.remove(emission)
        tree.nodes.remove(target)
    image.filepath_raw = str(path)
    image.file_format = 'PNG'
    image.save()
    image.pack()
    apply_texture(obj, image, indices)
    return {'image': str(path), 'indices': indices, 'vertices': len(obj.data.vertices)}


def main():
    import bpy
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--resolution', type=int, default=1024)
    args = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
    if args.out.exists():
        raise ValueError('Use a fresh output directory')
    args.out.mkdir(parents=True)
    config = json.loads(args.config.read_text())
    report = {}
    for kind, entry in config['units'].items():
        directory = args.out / kind
        directory.mkdir()
        baked = {}
        scenes = {}
        # Action scenes can have different topology and procedural coordinates.
        # Bake each source independently to preserve its original UVs and colours.
        for clip, source in entry['scenes'].items():
            bpy.ops.wm.open_mainfile(filepath=source)
            scene = bpy.context.scene
            scene.frame_set(scene.frame_start)
            scene.render.engine = 'CYCLES'
            scene.cycles.samples = 1
            baked[clip] = {}
            for obj in list(scene.objects):
                if obj.type != 'MESH' or obj.hide_render:
                    continue
                if not any(procedural(slot.material) for slot in obj.material_slots):
                    continue
                obj.data = obj.data.copy()
                filename = clip + '-' + re.sub(r'[^a-zA-Z0-9_-]+', '-', obj.name) + '.png'
                result = bake_object(obj, directory / filename, args.resolution)
                baked[clip][obj.name] = {key: result[key] for key in ('image', 'vertices', 'indices')}
                print('BAKED', kind, clip, obj.name, flush=True)
            destination = directory / (clip + '.blend')
            bpy.ops.wm.save_as_mainfile(filepath=str(destination))
            scenes[clip] = str(destination)
        entry['scenes'] = scenes
        report[kind] = baked
        print('CREATURE_READY', kind, sum(len(objects) for objects in baked.values()), flush=True)
    (args.out / 'export-config.json').write_text(json.dumps(config, ensure_ascii=False, indent=2))
    (args.out / 'material-bake-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
