# Croqui Line Tool - panel.py
#
# 3Dビューポート右側のサイドバー(Nパネル)にUIを表示するモジュール。
# ここでは見た目(ボタン・スライダーの配置)だけを担当し、
# 実際の処理はoperators.pyのOperator、設定値はproperties.pyが持つ。
#
# Version 2で「吸着設定」セクションを追加した。
# 「線設定」「線操作」セクションの項目・並び順はVersion 1から変更していない。

import bpy
from bpy.types import Context, Panel

from . import utils


class CROQUI_PT_line_tool(Panel):
    """3Dビューポートのサイドバーに表示するCroqui Line Toolパネル。"""

    bl_label = "Croqui Line Tool"
    bl_idname = "CROQUI_PT_line_tool"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Croqui"  # サイドバーのタブ名

    def draw(self, context: Context) -> None:
        layout = self.layout
        scene = context.scene
        line_settings = scene.croqui_line_tool

        # --- 線設定(Version 1: 太さ・色) ---
        line_settings_box = layout.box()
        line_settings_box.label(text="線設定", icon="CURVE_BEZCURVE")
        line_settings_box.prop(line_settings, "line_width")
        line_settings_box.prop(line_settings, "line_color")

        layout.separator()

        # --- 線操作(Version 1: 作成・削除) ---
        line_ops_box = layout.box()
        line_ops_box.label(text="線操作", icon="TOOL_SETTINGS")

        create_col = line_ops_box.column(align=True)
        create_col.scale_y = 1.2
        create_col.operator("croqui_line.create_line", text="線を作成", icon="ADD")

        delete_col = line_ops_box.column(align=True)
        delete_col.operator("croqui_line.delete_selected", text="選択した線を削除", icon="X")
        delete_col.operator("croqui_line.delete_all", text="すべてのCroqui線を削除", icon="TRASH")

        layout.separator()

        # --- 吸着設定(Version 2: 表面への吸着) ---
        attach_box = layout.box()
        attach_box.label(text="吸着設定", icon="MOD_SHRINKWRAP")
        attach_box.prop(scene, "croqui_line_target")
        attach_box.prop(scene, "croqui_line_offset")
        attach_box.prop(scene, "croqui_line_wrap_method")

        attach_box.separator()

        attach_col = attach_box.column(align=True)
        attach_col.operator("croqui_line.attach_selected", text="選択した線を吸着", icon="MOD_SHRINKWRAP")
        attach_col.operator("croqui_line.attach_all", text="すべての線を吸着", icon="MOD_SHRINKWRAP")

        detach_col = attach_box.column(align=True)
        detach_col.operator("croqui_line.detach_selected", text="選択した線の吸着を解除", icon="X")
        detach_col.operator("croqui_line.detach_all", text="すべての線の吸着を解除", icon="X")


classes = (CROQUI_PT_line_tool,)


def register() -> None:
    for cls in classes:
        utils.register_class_safe(cls)


def unregister() -> None:
    for cls in reversed(classes):
        utils.unregister_class_safe(cls)
