# Croqui Vertex Ink - properties.py
#
# Sceneに保持する設定値(プロパティ)をまとめたモジュール。
#
# ・croqui_ink_intensity … 焼き込み時に輝度へ掛ける強度(0-1)

import bpy
from bpy.props import FloatProperty

from . import utils


def register() -> None:
    bpy.types.Scene.croqui_ink_intensity = FloatProperty(
        name="強度",
        description="LinePaintの輝度から_PAINTへ焼き込む際に掛ける強度(0=無効, 1=そのまま)",
        default=1.0,
        min=0.0,
        max=1.0,
        soft_min=0.0,
        soft_max=1.0,
        precision=3,
    )


def unregister() -> None:
    utils.delete_scene_property_safe("croqui_ink_intensity")
