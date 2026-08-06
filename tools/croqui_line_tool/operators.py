# Croqui Line Tool - operators.py
#
# 各種Operator(ボタンを押したときの処理)を定義するモジュール。
# 設定値(プロパティ)はproperties.py、共通処理(判定・作成補助・モディファイア
# 操作)はutils.pyに分離しているため、このファイルは「操作の流れ」だけを持つ。
#
# Version 1からある3つのOperator(create_line / delete_selected / delete_all)は
# bl_idname・挙動とも変更していない。Version 2で4つのOperator
# (attach_selected / attach_all / detach_selected / detach_all)を追加した。

import bpy
from bpy.types import Context, Operator

from . import utils

# ------------------------------------------------------------
# Operator: 線を作成 (Version 1)
# ------------------------------------------------------------


class CROQUI_LINE_OT_create_line(Operator):
    """新しいCroqui線(3D Bezierカーブ)を作成し、編集モードへ切り替える。"""

    bl_idname = "croqui_line.create_line"
    bl_label = "線を作成"
    bl_description = "新しい筋肉線・関節線用のカーブを作成します"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context: Context) -> set:
        try:
            settings = context.scene.croqui_line_tool

            # 編集モード・ポーズモードなどから呼ばれても安全なようにオブジェクトモードへ戻す。
            utils.ensure_object_mode()

            # --- カーブデータを作成 ---
            line_name = utils.generate_next_line_name()
            curve_data = bpy.data.curves.new(name=line_name, type="CURVE")
            curve_data.dimensions = "3D"
            curve_data.resolution_u = 12  # 重くなりすぎない標準的な解像度
            curve_data.bevel_depth = settings.line_width
            curve_data.bevel_resolution = 4
            curve_data.use_fill_caps = True

            # --- Bezierスプラインを1本追加(制御点2つ) ---
            spline = curve_data.splines.new(type="BEZIER")
            spline.bezier_points.add(1)  # デフォルトの1点 + 1点 = 合計2点

            start_point = spline.bezier_points[0]
            end_point = spline.bezier_points[1]
            start_point.co = (0.0, 0.0, 0.0)
            end_point.co = (0.0, 0.2, 0.0)
            for point in (start_point, end_point):
                point.handle_left_type = "AUTO"
                point.handle_right_type = "AUTO"

            # --- マテリアルを取得(無ければ作成)して割り当て ---
            material = utils.get_or_create_material(settings.line_color)
            curve_data.materials.append(material)

            # --- オブジェクトを作成し、専用コレクションへリンク ---
            obj = bpy.data.objects.new(line_name, curve_data)
            obj[utils.CROQUI_LINE_PROP] = True

            collection = utils.get_or_create_collection(context)
            collection.objects.link(obj)

            # --- 選択状態を更新(既存の選択は解除してから、新しい線だけを選択) ---
            bpy.ops.object.select_all(action="DESELECT")
            context.view_layer.objects.active = obj
            obj.select_set(True)

            # --- ユーザーが制御点を編集できるよう、編集モードへ切り替える ---
            # (Version 2でも仕様通り、ここで自動吸着は行わない)
            try:
                bpy.ops.object.mode_set(mode="EDIT")
            except RuntimeError as error:
                # 編集モードへの切り替えに失敗しても、オブジェクト自体は作成済みなので
                # 処理は継続する(3Dビューポート以外から呼ばれた場合などを想定)。
                print(f"[Croqui Line Tool] 編集モードへの切り替えに失敗しました: {error}")

            self.report({"INFO"}, f"線を作成しました: {line_name}")
            return {"FINISHED"}

        except Exception as error:  # 想定外のエラーでもBlenderを停止させない
            print(f"[Croqui Line Tool] 線の作成中にエラーが発生しました: {error}")
            self.report({"ERROR"}, "線の作成中にエラーが発生しました。詳細はコンソールを確認してください")
            return {"CANCELLED"}


# ------------------------------------------------------------
# Operator: 選択した線を削除 (Version 1)
# ------------------------------------------------------------


class CROQUI_LINE_OT_delete_selected(Operator):
    """選択中のオブジェクトのうち、Croqui Line Toolで作成した線だけを削除する。"""

    bl_idname = "croqui_line.delete_selected"
    bl_label = "選択した線を削除"
    bl_description = "選択中のオブジェクトのうち、Croqui線だけを削除します"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context: Context) -> set:
        try:
            utils.ensure_object_mode()

            targets = [obj for obj in context.selected_objects if utils.is_croqui_line(obj)]

            if not targets:
                self.report({"INFO"}, "選択中にCroqui Line Toolの線がありません")
                return {"CANCELLED"}

            count = len(targets)
            for obj in targets:
                bpy.data.objects.remove(obj, do_unlink=True)

            self.report({"INFO"}, f"{count}本の線を削除しました")
            return {"FINISHED"}

        except Exception as error:
            print(f"[Croqui Line Tool] 選択した線の削除中にエラーが発生しました: {error}")
            self.report({"ERROR"}, "線の削除中にエラーが発生しました。詳細はコンソールを確認してください")
            return {"CANCELLED"}


# ------------------------------------------------------------
# Operator: すべてのCroqui線を削除 (Version 1)
# ------------------------------------------------------------


class CROQUI_LINE_OT_delete_all(Operator):
    """シーン内に存在する、Croqui Line Toolで作成した線をすべて削除する。"""

    bl_idname = "croqui_line.delete_all"
    bl_label = "すべてのCroqui線を削除"
    bl_description = "シーン内のCroqui Line Toolの線をすべて削除します"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context: Context) -> set:
        try:
            utils.ensure_object_mode()

            targets = utils.iter_all_croqui_lines()

            if not targets:
                self.report({"INFO"}, "削除対象のCroqui線がありません")
                return {"CANCELLED"}

            count = len(targets)
            for obj in targets:
                bpy.data.objects.remove(obj, do_unlink=True)

            self.report({"INFO"}, f"すべてのCroqui線({count}本)を削除しました")
            return {"FINISHED"}

        except Exception as error:
            print(f"[Croqui Line Tool] 全ての線の削除中にエラーが発生しました: {error}")
            self.report({"ERROR"}, "線の削除中にエラーが発生しました。詳細はコンソールを確認してください")
            return {"CANCELLED"}


# ------------------------------------------------------------
# 内部ヘルパー: 吸着系Operatorの共通チェック
# ------------------------------------------------------------


def _get_valid_target_or_none(self: Operator, context: Context):
    """吸着対象モデルを取得する。未設定/Mesh以外ならユーザーへ警告してNoneを返す。"""
    target = context.scene.croqui_line_target
    if not utils.is_valid_mesh_target(target):
        self.report({"WARNING"}, "吸着対象モデルが未指定、またはMeshオブジェクトではありません")
        return None
    return target


# ------------------------------------------------------------
# Operator: 選択した線を吸着 (Version 2)
# ------------------------------------------------------------


class CROQUI_LINE_OT_attach_selected(Operator):
    """選択中のCroqui線だけを、吸着対象モデルの表面へShrinkwrapで吸着させる。"""

    bl_idname = "croqui_line.attach_selected"
    bl_label = "選択した線を吸着"
    bl_description = "選択中のCroqui線を、吸着対象モデルの表面へ吸着させます"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context: Context) -> set:
        try:
            utils.ensure_object_mode()

            target = _get_valid_target_or_none(self, context)
            if target is None:
                return {"CANCELLED"}

            offset = context.scene.croqui_line_offset
            wrap_method = context.scene.croqui_line_wrap_method

            # 選択中のオブジェクトのうち、Croqui線であり、かつ吸着対象自身ではないものだけを対象にする。
            lines = [
                obj
                for obj in context.selected_objects
                if utils.is_croqui_line(obj) and obj != target
            ]

            if not lines:
                self.report({"INFO"}, "選択中にCroqui Line Toolの線がありません")
                return {"CANCELLED"}

            count = 0
            for obj in lines:
                try:
                    utils.apply_shrinkwrap(obj, target, offset, wrap_method)
                    count += 1
                except Exception as error:
                    print(f"[Croqui Line Tool] {obj.name} への吸着処理に失敗しました: {error}")

            self.report({"INFO"}, f"{count}本の線を吸着しました")
            return {"FINISHED"}

        except Exception as error:
            print(f"[Croqui Line Tool] 選択した線の吸着中にエラーが発生しました: {error}")
            self.report({"ERROR"}, "吸着処理中にエラーが発生しました。詳細はコンソールを確認してください")
            return {"CANCELLED"}


# ------------------------------------------------------------
# Operator: すべての線を吸着 (Version 2)
# ------------------------------------------------------------


class CROQUI_LINE_OT_attach_all(Operator):
    """シーン内の全てのCroqui線を、吸着対象モデルの表面へShrinkwrapで吸着させる。"""

    bl_idname = "croqui_line.attach_all"
    bl_label = "すべての線を吸着"
    bl_description = "シーン内の全てのCroqui線を、吸着対象モデルの表面へ吸着させます"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context: Context) -> set:
        try:
            utils.ensure_object_mode()

            target = _get_valid_target_or_none(self, context)
            if target is None:
                return {"CANCELLED"}

            offset = context.scene.croqui_line_offset
            wrap_method = context.scene.croqui_line_wrap_method

            # Croqui_Linesコレクションの有無に関わらず、カスタムプロパティだけで判定する。
            lines = [obj for obj in utils.iter_all_croqui_lines() if obj != target]

            if not lines:
                self.report({"INFO"}, "吸着対象のCroqui線がありません")
                return {"CANCELLED"}

            count = 0
            for obj in lines:
                try:
                    utils.apply_shrinkwrap(obj, target, offset, wrap_method)
                    count += 1
                except Exception as error:
                    print(f"[Croqui Line Tool] {obj.name} への吸着処理に失敗しました: {error}")

            self.report({"INFO"}, f"すべての線({count}本)を吸着しました")
            return {"FINISHED"}

        except Exception as error:
            print(f"[Croqui Line Tool] すべての線の吸着中にエラーが発生しました: {error}")
            self.report({"ERROR"}, "吸着処理中にエラーが発生しました。詳細はコンソールを確認してください")
            return {"CANCELLED"}


# ------------------------------------------------------------
# Operator: 選択した線の吸着を解除 (Version 2)
# ------------------------------------------------------------


class CROQUI_LINE_OT_detach_selected(Operator):
    """選択中のCroqui線から、Croqui_Surface_Shrinkwrapモディファイアだけを削除する。"""

    bl_idname = "croqui_line.detach_selected"
    bl_label = "選択した線の吸着を解除"
    bl_description = "選択中のCroqui線から吸着(Shrinkwrap)だけを解除します"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context: Context) -> set:
        try:
            utils.ensure_object_mode()

            lines = [obj for obj in context.selected_objects if utils.is_croqui_line(obj)]

            if not lines:
                self.report({"INFO"}, "選択中にCroqui Line Toolの線がありません")
                return {"CANCELLED"}

            count = 0
            for obj in lines:
                try:
                    if utils.remove_shrinkwrap(obj):
                        count += 1
                except Exception as error:
                    print(f"[Croqui Line Tool] {obj.name} の吸着解除に失敗しました: {error}")

            self.report({"INFO"}, f"{count}本の線の吸着を解除しました")
            return {"FINISHED"}

        except Exception as error:
            print(f"[Croqui Line Tool] 選択した線の吸着解除中にエラーが発生しました: {error}")
            self.report({"ERROR"}, "吸着解除中にエラーが発生しました。詳細はコンソールを確認してください")
            return {"CANCELLED"}


# ------------------------------------------------------------
# Operator: すべての線の吸着を解除 (Version 2)
# ------------------------------------------------------------


class CROQUI_LINE_OT_detach_all(Operator):
    """シーン内の全てのCroqui線から、Croqui_Surface_Shrinkwrapモディファイアだけを削除する。"""

    bl_idname = "croqui_line.detach_all"
    bl_label = "すべての線の吸着を解除"
    bl_description = "シーン内の全てのCroqui線から吸着(Shrinkwrap)だけを解除します"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context: Context) -> set:
        try:
            utils.ensure_object_mode()

            lines = utils.iter_all_croqui_lines()

            if not lines:
                self.report({"INFO"}, "対象のCroqui線がありません")
                return {"CANCELLED"}

            count = 0
            for obj in lines:
                try:
                    if utils.remove_shrinkwrap(obj):
                        count += 1
                except Exception as error:
                    print(f"[Croqui Line Tool] {obj.name} の吸着解除に失敗しました: {error}")

            self.report({"INFO"}, f"すべての線の吸着を解除しました({count}本)")
            return {"FINISHED"}

        except Exception as error:
            print(f"[Croqui Line Tool] すべての線の吸着解除中にエラーが発生しました: {error}")
            self.report({"ERROR"}, "吸着解除中にエラーが発生しました。詳細はコンソールを確認してください")
            return {"CANCELLED"}


# ------------------------------------------------------------
# register / unregister
# ------------------------------------------------------------

classes = (
    CROQUI_LINE_OT_create_line,
    CROQUI_LINE_OT_delete_selected,
    CROQUI_LINE_OT_delete_all,
    CROQUI_LINE_OT_attach_selected,
    CROQUI_LINE_OT_attach_all,
    CROQUI_LINE_OT_detach_selected,
    CROQUI_LINE_OT_detach_all,
)


def register() -> None:
    for cls in classes:
        utils.register_class_safe(cls)


def unregister() -> None:
    for cls in reversed(classes):
        utils.unregister_class_safe(cls)
