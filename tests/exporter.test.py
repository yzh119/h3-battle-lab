"""GLB clip packing is testable without Blender or proprietary art."""
import importlib.util
import json
import struct
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('exporter', Path(__file__).resolve().parents[1] / 'scripts/export-blender.py')
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


def write_glb(path, nodes, targets):
    data = struct.pack('<f', 1.0)
    doc = {'asset': {'version': '2.0'}, 'nodes': nodes, 'buffers': [{'byteLength': len(data)}],
           'bufferViews': [{'buffer': 0, 'byteLength': len(data)}],
           'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': 1, 'type': 'SCALAR'}],
           'animations': [{'samplers': [{'input': 0, 'output': 0}], 'channels': [
               {'sampler': 0, 'target': {'node': node, 'path': 'translation'}} for node in targets]}]}
    encoded = json.dumps(doc).encode()
    encoded += b' ' * (-len(encoded) % 4)
    path.write_bytes(struct.pack('<III', 0x46546C67, 2, 28 + len(encoded) + len(data))
                     + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded
                     + struct.pack('<II', len(data), 0x004E4942) + data)


class ClipPackingTests(unittest.TestCase):
    def test_same_named_bones_in_different_rigs_map_correctly_after_node_reordering(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            # Two independent finger rigs both contain "Hand". Shoot reorders nodes.
            write_glb(root / 'idle.glb', [{'name': 'LeftRig', 'children': [1]}, {'name': 'Hand'}, {'name': 'RightRig', 'children': [3]}, {'name': 'Hand'}], [1, 3])
            write_glb(root / 'shoot.glb', [{'name': 'RightRig', 'children': [1]}, {'name': 'Hand'}, {'name': 'LeftRig', 'children': [3]}, {'name': 'Hand'}], [1, 3])
            exporter.pack_clips([('idle', root / 'idle.glb'), ('shoot', root / 'shoot.glb')], root / 'combined.glb')
            doc, data = exporter.read_glb(root / 'combined.glb')
            self.assertEqual([a['name'] for a in doc['animations']], ['idle', 'shoot'])
            self.assertEqual([c['target']['node'] for c in doc['animations'][1]['channels']], [3, 1])
            self.assertEqual(doc['buffers'][0]['byteLength'], len(data))
            for view in doc['bufferViews']:
                self.assertEqual(struct.unpack_from('<f', data, view.get('byteOffset', 0))[0], 1.0)

    def test_clip_specific_weapon_visibility_is_restored_for_each_animation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_glb(root / 'idle.glb', [{'name': 'Rig'}], [0])
            write_glb(root / 'attack.glb', [{'name': 'Rig'}, {'name': 'Dagger', 'mesh': 0}], [0, 1])
            exporter.pack_clips([('idle', root / 'idle.glb'), ('attack', root / 'attack.glb')], root / 'combined.glb', 'attack')
            doc, data = exporter.read_glb(root / 'combined.glb')
            for clip, expected in zip(doc['animations'], [(0, 0, 0), (1, 1, 1)]):
                visibility = next(c for c in clip['channels'] if c['target'] == {'node': 1, 'path': 'scale'})
                sampler = clip['samplers'][visibility['sampler']]
                accessor = doc['accessors'][sampler['output']]
                view = doc['bufferViews'][accessor['bufferView']]
                self.assertEqual(struct.unpack_from('<fff', data, view['byteOffset']), expected)

    def test_ambiguous_siblings_and_cycles_are_rejected(self):
        with self.assertRaisesRegex(AssertionError, 'unique hierarchical'):
            exporter.node_paths({'nodes': [{'name': 'Rig', 'children': [1, 2]}, {'name': 'Hand'}, {'name': 'Hand'}]})
        with self.assertRaisesRegex(AssertionError, 'Cyclic'):
            exporter.node_paths({'nodes': [{'name': 'Rig', 'children': [0]}]})

    def test_missing_animation_target_never_writes_a_corrupt_combined_model(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_glb(root / 'idle.glb', [{'name': 'Rig'}], [0])
            write_glb(root / 'shoot.glb', [{'name': 'DifferentRig'}], [0])
            with self.assertRaisesRegex(AssertionError, 'Missing animation target'):
                exporter.pack_clips([('idle', root / 'idle.glb'), ('shoot', root / 'shoot.glb')], root / 'combined.glb')
            self.assertFalse((root / 'combined.glb').exists())


if __name__ == '__main__':
    unittest.main()
