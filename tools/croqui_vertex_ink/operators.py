# Croqui Vertex Ink - operators.py
#
# 各種Operator(ボタンを押したときの処理)を定義するモジュール。
# 共通処理(属性の作成・変換・書き込み)はutils.pyに分離しているため、
# このファイルは「操作の流れ」だけを持つ。
#
# 1. croqui_ink.prepare_paint … LinePaint属性を作成/再利用し、頂点ペイントモードへ入る
# 2. croqui_ink.bake_paint    … LinePaintの輝度を_PAINT(FLOAT/POINT)へ焼き込む
# 3. croqui_ink.export_glb    … export_attributes=True でglTF(GLB)を書き出す

import bpy
from bpy.props import StringProperty
from bpy.types import Context, Operator
from bpy_extras.io_utils import ExportHelper

from . import utils

# ------------------------------------------------------------
# Operator 1: ペイント準備
# ------------------------------------------------------------


class CROQUI_INK_OT_prepare_paint(Operator):
    """アクティブメッシュにLinePaint属性を用意し、頂点ペイントモードへ切り替える。"""

    bl_idname = "croqui_ink.prepare_paint"
    bl_label = "ペイント準備"
    bl_description = "LinePaint属性(FLOAT_COLOR/POINT)を作成し、頂点ペイントモードに入ります"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context: Context) -> set:
        try:
            obj = utils.get_active_mesh_object(context)
            if obj is None:
                self.report({"WARNING"}, "アクティブなメッシュオブジェクトがありません")
                return {"CANCELLED"}

            utils.ensure_object_mode()

            mesh = obj.data
            attr = utils.get_or_create_line_paint_attribute(mesh)
            utils.set_active_paint_attribute(mesh, attr)

            try:
                bpy.ops.object.mode_set(mode="VERTEX_PAINT")
            except RuntimeError as error:
                # 3Dビューポート以外から呼ばれた場合など、モード切り替えに失敗しても
                # 属性自体は作成済みなので処理は継続する。
                print(f"[Croqui Vertex Ink] 頂点ペイントモードへの切り替えに失敗しました: {error}")
                self.report(
                    {"WARNING"},
                    f"LinePaint属性は用意できましたが、頂点ペイントモードへの切り替えに失敗しました: {obj.name}",
                )
                return {"FINISHED"}

            self.report({"INFO"}, f"ペイント準備が完了しました: {obj.name} / {utils.LINE_PAINT_ATTR_NAME}")
            return {"FINISHED"}

        except Exception as error:
            print(f"[Croqui Vertex Ink] ペイント準備中にエラーが発生しました: {error}")
            self.report({"ERROR"}, "ペイント準備中にエラーが発生しました。詳細はコンソールを確認してください")
            return {"CANCELLED"}


# ------------------------------------------------------------
# Operator 2: 焼き込み
# ------------------------------------------------------------


class CROQUI_INK_OT_bake_paint(Operator):
    """LinePaintの輝度(×強度)を、FLOAT/POINTドメインの_PAINT属性へ焼き込む。"""

    bl_idname = "croqui_ink.bake_paint"
    bl_label = "焼き込み"
    bl_description = "LinePaintの輝度に強度を掛けて_PAINT属性(FLOAT/POINT)へ書き込みます"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context: Context) -> set:
        try:
            obj = utils.get_active_mesh_object(context)
            if obj is None:
                self.report({"WARNING"}, "アクティブなメッシュオブジェクトがありません")
                return {"CANCELLED"}

            mesh = obj.data

            if mesh.color_attributes.get(utils.LINE_PAINT_ATTR_NAME) is None:
                self.report(
                    {"WARNING"},
                    f"{utils.LINE_PAINT_ATTR_NAME}属性がありません。先に「ペイント準備」を実行してください",
                )
                return {"CANCELLED"}

            # 属性の変換・foreach_get/set はオブジェクトモードで行う。
            utils.ensure_object_mode()

            # 頂点ペイントは既定でCORNER(フェイスコーナー)ドメインになりがちなため、
            # 焼き込み前に必ずPOINT(頂点)ドメインへ揃える。
            color_attr = utils.convert_attribute_to_point_domain(mesh, utils.LINE_PAINT_ATTR_NAME)

            intensity = context.scene.croqui_ink_intensity
            luminance = utils.compute_point_luminance(mesh, color_attr, intensity)
            utils.write_bake_attribute(mesh, luminance)

            self.report(
                {"INFO"},
                f"焼き込みが完了しました: 頂点数={len(mesh.vertices)} / 強度={intensity:.3f} → {utils.BAKE_ATTR_NAME}",
            )
            return {"FINISHED"}

        except Exception as error:
            print(f"[Croqui Vertex Ink] 焼き込み中にエラーが発生しました: {error}")
            self.report({"ERROR"}, "焼き込み中にエラーが発生しました。詳細はコンソールを確認してください")
            return {"CANCELLED"}


# ------------------------------------------------------------
# Operator 3: エクスポート
# ------------------------------------------------------------


class CROQUI_INK_OT_export_glb(Operator, ExportHelper):
    """export_attributes=True でglTF(GLB)を書き出す。"""

    bl_idname = "croqui_ink.export_glb"
    bl_label = "エクスポート"
    bl_description = "カスタム属性(_PAINT等)を含めてGLBを書き出します"
    bl_options = {"REGISTER", "UNDO"}

    filename_ext = ".glb"
    filter_glob: StringProperty(default="*.glb", options={"HIDDEN"})

    def execute(self, context: Context) -> set:
        try:
            if not hasattr(bpy.ops.export_scene, "gltf"):
                self.report(
                    {"ERROR"},
                    "glTF 2.0 エクスポータが見つかりません。"
                    "プリファレンス→アドオンで「glTF 2.0 format」を有効化してください",
                )
                return {"CANCELLED"}

            # export_attributes=True: "_"始まりのカスタム属性(_PAINT等)を書き出す。
            # これはBlenderのUIでいう「Data > Mesh > Attributes」のチェックボックスに相当する。
            bpy.ops.export_scene.gltf(
                filepath=self.filepath,
                export_format="GLB",
                export_attributes=True,
            )

            self.report({"INFO"}, f"GLBを書き出しました: {self.filepath}")
            return {"FINISHED"}

        except Exception as error:
            print(f"[Croqui Vertex Ink] エクスポート中にエラーが発生しました: {error}")
            self.report({"ERROR"}, "エクスポート中にエラーが発生しました。詳細はコンソールを確認してください")
            return {"CANCELLED"}


# ------------------------------------------------------------
# register / unregister
# ------------------------------------------------------------

classes = (
    CROQUI_INK_OT_prepare_paint,
    CROQUI_INK_OT_bake_paint,
    CROQUI_INK_OT_export_glb,
)


def register() -> None:
    for cls in classes:
        utils.register_class_safe(cls)


def unregister() -> None:
    for cls in reversed(classes):
        utils.unregister_class_safe(cls)
