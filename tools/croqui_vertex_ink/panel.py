# Croqui Vertex Ink - panel.py
#
# 3Dビューポート右側のサイドバー(Nパネル)の「Croqui」タブにUIを表示するモジュール。
# ここでは見た目(ボタン・スライダーの配置)だけを担当し、
# 実際の処理はoperators.pyのOperator、設定値はproperties.pyが持つ。

import bpy
from bpy.types import Context, Panel

from . import utils


class CROQUI_PT_vertex_ink(Panel):
    """3Dビューポートのサイドバーに表示するCroqui Vertex Inkパネル。"""

    bl_label = "Croqui Vertex Ink"
    bl_idname = "CROQUI_PT_vertex_ink"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Croqui"  # サイドバーのタブ名(Croqui Line Toolと同じタブに表示される)

    def draw(self, context: Context) -> None:
        layout = self.layout
        scene = context.scene

        # --- 1. 頂点ペイント ---
        paint_box = layout.box()
        paint_box.label(text="頂点ペイント", icon="VPAINT_HLT")
        paint_box.operator(
            "croqui_ink.prepare_paint",
            text="ペイント準備",
            icon="BRUSH_DATA",
        )
        paint_box.label(text=f"属性名: {utils.LINE_PAINT_ATTR_NAME}")

        layout.separator()

        # --- 2. 焼き込み ---
        bake_box = layout.box()
        bake_box.label(text="焼き込み", icon="RENDER_STILL")
        bake_box.prop(scene, "croqui_ink_intensity")
        bake_box.operator(
            "croqui_ink.bake_paint",
            text="焼き込み",
            icon="RENDER_STILL",
        )
        bake_box.label(text=f"書き込み先: {utils.BAKE_ATTR_NAME}")

        layout.separator()

        # --- 3. エクスポート ---
        export_box = layout.box()
        export_box.label(text="書き出し", icon="EXPORT")
        export_box.operator(
            "croqui_ink.export_glb",
            text="エクスポート (GLB)",
            icon="EXPORT",
        )


classes = (CROQUI_PT_vertex_ink,)


def register() -> None:
    for cls in classes:
        utils.register_class_safe(cls)


def unregister() -> None:
    for cls in reversed(classes):
        utils.unregister_class_safe(cls)
