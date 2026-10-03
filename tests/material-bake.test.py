"""Regression: inactive legacy shaders must not replace the exported surface."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace as NS
import unittest

spec = importlib.util.spec_from_file_location('bake_materials', Path(__file__).resolve().parents[1] / 'scripts/bake-blender-materials.py')
bake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bake)


def material(active_type, legacy_type):
    def shader(source):
        links = [NS(from_node=NS(type=source))] if source else []
        return NS(type='BSDF_PRINCIPLED', inputs={'Base Color': NS(is_linked=bool(links), links=links)})
    active, legacy = shader(active_type), shader(legacy_type)
    output = NS(type='OUTPUT_MATERIAL', is_active_output=True,
                inputs={'Surface': NS(is_linked=True, links=[NS(from_node=active)])})
    return NS(use_nodes=True, node_tree=NS(nodes=[legacy, active, output])), active


class SurfaceTests(unittest.TestCase):
    def test_unused_procedural_shader_does_not_trigger_baking(self):
        mat, active = material(None, 'VALTORGB')
        self.assertIs(bake.surface_shader(mat), active)
        self.assertFalse(bake.procedural(mat))

    def test_active_colour_ramp_is_baked_even_with_unused_image_shader(self):
        mat, active = material('VALTORGB', 'TEX_IMAGE')
        self.assertIs(bake.surface_shader(mat), active)
        self.assertTrue(bake.procedural(mat))

    def test_existing_active_image_texture_is_preserved(self):
        mat, _ = material('TEX_IMAGE', 'VALTORGB')
        self.assertFalse(bake.procedural(mat))

    def emission_material(self, color, strength):
        mat, shader = material(None, None)
        for name, source in [('Emission Color', color), ('Emission Strength', strength)]:
            links = [NS(from_node=NS(type=source))] if source else []
            shader.inputs[name] = NS(is_linked=bool(links), links=links)
        return mat

    def test_image_emission_with_face_strength_mask_requires_baking(self):
        # Exporting only the image loses the mask and makes clothing glow.
        self.assertTrue(bake.emission_procedural(self.emission_material('TEX_IMAGE', 'MATH')))

    def test_direct_image_emission_with_uniform_strength_is_preserved(self):
        self.assertFalse(bake.emission_procedural(self.emission_material('TEX_IMAGE', None)))

    def test_procedural_emission_colour_requires_baking(self):
        self.assertTrue(bake.emission_procedural(self.emission_material('VALTORGB', None)))


if __name__ == '__main__':
    unittest.main()
