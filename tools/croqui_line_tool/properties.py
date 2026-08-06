# Croqui Line Tool - properties.py
#
# Sceneに保持する設定値(プロパティ)と、その変更コールバックをまとめたモジュール。
#
# ・croqui_line_tool (PropertyGroup)  … Version 1からある「線の太さ・色」
# ・croqui_line_target                … Version 2で追加「吸着対象モデル」
# ・croqui_line_offset                … Version 2で追加「表面からの距離」
# ・croqui_line_wrap_method           … Version 2で追加「吸着方法」

import bpy
from bpy.props import EnumProperty, FloatProperty, FloatVectorProperty, PointerProperty
from bpy.types import Context, Object, PropertyGroup

from . import utils

# ------------------------------------------------------------
# Version 1: 線の太さ・色(Version 1から内容は変更なし。operators.pyから移設)
# ------------------------------------------------------------


def _on_line_width_update(self: "CroquiLineToolSettings", context: Context) -> None:
    """線の太さが変更された時に呼ばれる。既存の全Croqui線のBevel Depthを更新する。"""
    for obj in utils.iter_all_croqui_lines():
        if obj.type == "CURVE":
            obj.data.bevel_depth = self.line_width


def _on_line_color_update(self: "CroquiLineToolSettings", context: Context) -> None:
    """線の色が変更された時に呼ばれる。

    Croqui_Line_Materialは全ての線オブジェクトで共有されているマテリアルなので、
    このマテリアルの色を更新するだけで既存の全ての線に自動的に反映される。
    """
    utils.get_or_create_material(self.line_color)


class CroquiLineToolSettings(PropertyGroup):
    """パネルに表示する線の設定値(太さ・色)を保持するプロパティグループ。"""

    line_width: FloatProperty(
        name="線の太さ",
        description="作成する線のBevel Depth(太さ)",
        default=0.003,
        min=0.0001,
        max=0.1,
        soft_min=0.0001,
        soft_max=0.1,
        precision=4,
        update=_on_line_width_update,
    )

    line_color: FloatVectorProperty(
        name="線の色",
        description="作成する線のマテリアルカラー",
        subtype="COLOR",
        size=3,
        default=(0.02, 0.02, 0.02),
        min=0.0,
        max=1.0,
        update=_on_line_color_update,
    )


# ------------------------------------------------------------
# Version 2: 吸着対象・距離・方法
# ------------------------------------------------------------

# 吸着方法(EnumProperty)の選択肢。
WRAP_METHOD_ITEMS = (
    (
        "NEAREST_SURFACEPOINT",
        "最寄りの表面",
        "対象モデルの全方向から最も近い表面へ吸着します",
    ),
    (
        "PROJECT",
        "投影",
        "XYZの正負全方向へ投影して対象モデルの表面へ吸着します",
    ),
)


def _poll_mesh_target(self, obj: Object) -> bool:
    """吸着対象モデルとして選択できるのはMeshオブジェクトだけに制限する。

    Curve・Armature・Empty・Light・Cameraなどはここでfalseを返すことで、
    プロパティのオブジェクト選択UI(検索・ドロップダウン)に表示されなくなる。
    """
    return obj.type == "MESH"


def _update_existing_shrinkwraps(context: Context) -> None:
    """吸着対象・距離・方法のいずれかが変更された時に呼ばれる共通処理。

    既にCroqui_Surface_Shrinkwrapが付いているCroqui線だけに現在の設定を反映する。
    まだ吸着していない線へ新しくモディファイアを追加することはしない。
    対象が未設定/Mesh以外の間は何もしない(既存の設定を壊さないため)。
    処理中に何が起きてもBlender全体を止めないよう、例外は全てここで吸収する。
    """
    try:
        scene = context.scene
        target = scene.croqui_line_target

        if not utils.is_valid_mesh_target(target):
            return

        offset = scene.croqui_line_offset
        wrap_method = scene.croqui_line_wrap_method

        for obj in utils.iter_all_croqui_lines():
            if obj == target:
                continue
            if not utils.has_shrinkwrap(obj):
                continue
            try:
                utils.apply_shrinkwrap(obj, target, offset, wrap_method)
            except Exception as error:
                print(f"[Croqui Line Tool] {obj.name} のShrinkwrap設定更新に失敗しました: {error}")

    except Exception as error:
        print(f"[Croqui Line Tool] Shrinkwrap設定の反映中にエラーが発生しました: {error}")


def _on_target_update(self, context: Context) -> None:
    _update_existing_shrinkwraps(context)


def _on_offset_update(self, context: Context) -> None:
    _update_existing_shrinkwraps(context)


def _on_wrap_method_update(self, context: Context) -> None:
    _update_existing_shrinkwraps(context)


# ------------------------------------------------------------
# register / unregister
# ------------------------------------------------------------

# register_classが必要なのはPropertyGroupだけ。
# croqui_line_target / croqui_line_offset / croqui_line_wrap_method は
# Scene型へ直接生やすプリミティブなプロパティなので、register_classは不要。
classes = (CroquiLineToolSettings,)


def register() -> None:
    for cls in classes:
        utils.register_class_safe(cls)

    # Version 1: 線の太さ・色(scene.croqui_line_tool.line_width / line_color)
    bpy.types.Scene.croqui_line_tool = PointerProperty(type=CroquiLineToolSettings)

    # Version 2: 吸着対象モデル
    bpy.types.Scene.croqui_line_target = PointerProperty(
        name="吸着対象モデル",
        description="線を吸着させる対象のMeshオブジェクト",
        type=Object,
        poll=_poll_mesh_target,
        update=_on_target_update,
    )

    # Version 2: 表面からの距離(Blender Unit)
    bpy.types.Scene.croqui_line_offset = FloatProperty(
        name="表面からの距離",
        description="モデル表面からのオフセット距離(Blender Unit)",
        default=0.001,
        min=-0.1,
        max=0.1,
        soft_min=-0.1,
        soft_max=0.1,
        precision=4,
        update=_on_offset_update,
    )

    # Version 2: 吸着方法
    bpy.types.Scene.croqui_line_wrap_method = EnumProperty(
        name="吸着方法",
        description="Shrinkwrapモディファイアの吸着方法",
        items=WRAP_METHOD_ITEMS,
        default="NEAREST_SURFACEPOINT",
        update=_on_wrap_method_update,
    )


def unregister() -> None:
    # 登録した時と逆順で、Sceneに生やしたプロパティを削除する。
    # delattrではなくdelete_scene_property_safe()を使い、途中まで登録された
    # 状態(前回のインストールが失敗している等)でもAttributeErrorにならないようにする。
    utils.delete_scene_property_safe("croqui_line_wrap_method")
    utils.delete_scene_property_safe("croqui_line_offset")
    utils.delete_scene_property_safe("croqui_line_target")
    utils.delete_scene_property_safe("croqui_line_tool")

    for cls in reversed(classes):
        utils.unregister_class_safe(cls)
