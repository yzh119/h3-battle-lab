"""Bake procedural base colour and effective emission in copied creature scenes.

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


def emission_procedural(mat):
    shader = surface_shader(mat)
    if not shader:
        return False
    color, strength = shader.inputs.get("Emission Color"), shader.inputs.get("Emission Strength")
    return bool(color and strength and (strength.is_linked or (color.is_linked and color.links[0].from_node.type != "TEX_IMAGE")))


def apply_texture(obj, image, indices, channel="Base Color", scale=1):
    import bpy
    for index in indices:
        mat = obj.material_slots[index].material.copy()
        obj.material_slots[index].material = mat
        shader = surface_shader(mat)
        if not shader:
            raise ValueError('Baking requires a Principled surface: ' + mat.name)
        color = shader.inputs[channel]
        if channel == 'Emission Color':
            strength = shader.inputs['Emission Strength']
            for link in list(strength.links):
                mat.node_tree.links.remove(link)
            strength.default_value = scale
        for link in list(color.links):
            mat.node_tree.links.remove(link)
        texture = mat.node_tree.nodes.new('ShaderNodeTexImage')
        texture.image = image
        mat.node_tree.links.new(texture.outputs['Color'], color)


def bake_object(obj, path, resolution, channel="Base Color"):
    import bpy
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    # Bake can clear active image targets even in unused material slots. If an
    # old slot points at a source texture, this destroys the colour being sampled
    # and produces a circular dependency. These copied scenes need only used slots.
    bpy.ops.object.material_slot_remove_unused()
    if not obj.data.uv_layers:
        obj.data.uv_layers.new(name='BakedBaseColorUV')
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=1.1519, island_margin=.015)
        bpy.ops.object.mode_set(mode='OBJECT')
    predicate = procedural if channel == 'Base Color' else emission_procedural
    indices = [i for i, slot in enumerate(obj.material_slots) if predicate(slot.material)]
    image = bpy.data.images.new(obj.name + ' baked ' + channel, width=resolution, height=resolution, float_buffer=channel == 'Emission Color')
    image.colorspace_settings.name = 'sRGB'
    restore = []
    # Bake the exact colour graph as emission; lighting/metalness are excluded.
    used_slots = {polygon.material_index for polygon in obj.data.polygons}
    for index, slot in enumerate(obj.material_slots):
        if index not in used_slots:
            continue
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
        color = shader.inputs[channel]
        if channel == 'Emission Color':
            strength = shader.inputs['Emission Strength']
            if strength.is_linked:
                tree.links.new(strength.links[0].from_socket, emission.inputs['Strength'])
            else:
                emission.inputs['Strength'].default_value = strength.default_value
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
    scale = 1
    divisors = []
    if channel == 'Emission Color':
        import math
        pixels = list(image.pixels)
        peak = max(max(pixels[i::4]) for i in range(3))
        if not math.isfinite(peak):
            raise ValueError('Non-finite emission in ' + obj.name)
        scale = max(1, math.ceil(peak))
        if scale > 1:
            # Store HDR emission in PNG without clipping; glTF's strength restores it.
            for tree, _, _, emission, _ in restore:
                strength = emission.inputs['Strength']
                divide = tree.nodes.new('ShaderNodeMath'); divide.operation = 'DIVIDE'
                divide.inputs[1].default_value = scale
                if strength.is_linked:
                    tree.links.new(strength.links[0].from_socket, divide.inputs[0])
                else:
                    divide.inputs[0].default_value = strength.default_value
                tree.links.new(divide.outputs[0], strength); divisors.append((tree, divide))
            bpy.ops.object.bake(type='EMIT', use_clear=True, margin=8)
    for tree, divide in divisors:
        tree.nodes.remove(divide)
    for tree, original, output, emission, target in restore:
        tree.links.new(original, output.inputs['Surface'])
        tree.nodes.remove(emission)
        tree.nodes.remove(target)
    image.filepath_raw = str(path)
    image.file_format = 'PNG'
    image.save()
    image.pack()
    apply_texture(obj, image, indices, channel, scale)
    return {'image': str(path), 'indices': indices, 'vertices': len(obj.data.vertices), 'scale': scale}


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
            override = entry.get('actions', {}).get(clip)
            if override:
                rig = bpy.data.objects[override['rig']]
                rig.animation_data_create(); rig.animation_data.action = bpy.data.actions[override['action']]
                scene.frame_start, scene.frame_end = 1, override['frames']
            scene.frame_set(scene.frame_start)
            scene.render.engine = 'CYCLES'
            scene.cycles.samples = 1
            baked[clip] = {}
            for obj in list(scene.objects):
                if obj.type != 'MESH' or obj.hide_render:
                    continue
                channels = [channel for channel, predicate in [('Base Color', procedural), ('Emission Color', emission_procedural)] if any(predicate(slot.material) for slot in obj.material_slots)]
                if not channels:
                    continue
                obj.data = obj.data.copy()
                baked[clip][obj.name] = {}
                for channel in channels:
                    filename = clip + '-' + re.sub(r'[^a-zA-Z0-9_-]+', '-', obj.name) + '-' + channel.replace(' ', '-') + '.png'
                    result = bake_object(obj, directory / filename, args.resolution, channel)
                    baked[clip][obj.name][channel] = {key: result[key] for key in ('image', 'vertices', 'indices', 'scale')}
                    print('BAKED', kind, clip, obj.name, channel, flush=True)
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
