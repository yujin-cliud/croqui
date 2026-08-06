# Croqui Line Tool - utils.py
#
# 複数のOperator/プロパティ更新コールバックから共通で使う処理をまとめたモジュール。
# Version 1からある「線の判定・作成補助」に加えて、
# Version 2で追加した「Shrinkwrapモディファイアの作成・更新・削除」もここに置く。
#
# このファイル自身はbpy.types.Operator等のクラスを持たないため、
# register() / unregister() は用意していない(呼び出し側のoperators.py /
# properties.py がそれぞれ自分の登録処理の中でここの関数・定数を使う)。

import re
from typing import List, Optional

import bpy
from bpy.types import Collection, Context, Curve, Material, Modifier, Object

# ------------------------------------------------------------
# 定数
# ------------------------------------------------------------

# 線オブジェクトを識別するためのカスタムプロパティ名(Version 1から変更なし)。
# このキーがTrueのオブジェクトだけを「Croqui Line Toolが作った線」とみなす。
CROQUI_LINE_PROP = "croqui_line"

# 線オブジェクトをまとめて入れる専用コレクションの名前(Version 1から変更なし)。
COLLECTION_NAME = "Croqui_Lines"

# 線オブジェクト名のプレフィックス(例: Croqui_Line_001)(Version 1から変更なし)。
LINE_NAME_PREFIX = "Croqui_Line_"

# 線専用マテリアルの名前(Version 1から変更なし)。
MATERIAL_NAME = "Croqui_Line_Material"

# --- ここからVersion 2で追加した定数 ---

# Croqui Line Toolが追加するShrinkwrapモディファイアの固定名。
MODIFIER_NAME = "Croqui_Surface_Shrinkwrap"

# 「このオブジェクトにCroqui用Shrinkwrapが付いている」ことを示すオブジェクト側の
# カスタムプロパティ名。Modifier自体はカスタムプロパティを安定して保持できない
# バージョンがあるため、判定・管理はオブジェクト側のプロパティで行う。
MODIFIER_PROP = "croqui_line_shrinkwrap"

# オブジェクト名の連番を読み取るための正規表現(例: Croqui_Line_007 → 7)。
_LINE_NAME_PATTERN = re.compile(r"^" + re.escape(LINE_NAME_PREFIX) + r"(\d+)$")


# ------------------------------------------------------------
# 安全なクラス登録・解除(ZIPの上書きインストール等での二重登録エラー対策)
# ------------------------------------------------------------


def register_class_safe(cls: type) -> None:
    """クラスをBlenderへ登録する。

    Blenderを再起動せずにアドオンのZIPを上書きインストールした場合など、
    同名クラスが既にRNAへ登録された状態でregister()が再度呼ばれることがある
    (例: "RuntimeError: register_class(...): already registered as a
    subclass ...")。これを避けるため、登録前に同名クラスが既に
    bpy.types に存在しないか確認し、存在すれば先にそれを解除してから
    改めて登録し直す。
    """
    existing = getattr(bpy.types, cls.__name__, None)
    if existing is not None:
        try:
            bpy.utils.unregister_class(existing)
        except RuntimeError as error:
            print(f"[Croqui Line Tool] {cls.__name__} の既存登録の解除に失敗しました: {error}")
    bpy.utils.register_class(cls)


def unregister_class_safe(cls: type) -> None:
    """クラスの登録を解除する。登録されていない場合は何もしない(エラーにしない)。"""
    existing = getattr(bpy.types, cls.__name__, None)
    if existing is None:
        return
    try:
        bpy.utils.unregister_class(existing)
    except RuntimeError as error:
        print(f"[Croqui Line Tool] {cls.__name__} の登録解除に失敗しました: {error}")


def delete_scene_property_safe(name: str) -> None:
    """bpy.types.Sceneに生やしたプロパティを安全に削除する。

    プロパティが存在しない状態(登録が途中で失敗した場合など)でdelattrすると
    AttributeErrorになるため、事前にhasattrで存在確認してから削除する。
    """
    if hasattr(bpy.types.Scene, name):
        try:
            delattr(bpy.types.Scene, name)
        except Exception as error:
            print(f"[Croqui Line Tool] Scene.{name} の削除に失敗しました: {error}")


# ------------------------------------------------------------
# 線オブジェクトの判定・作成補助(Version 1から移設、内容は変更なし)
# ------------------------------------------------------------


def ensure_object_mode() -> None:
    """現在のモードがオブジェクトモードでなければ、安全にオブジェクトモードへ戻す。

    編集モードやポーズモードのままオブジェクトの作成・削除・モディファイア操作を
    行うとエラーになることがあるための安全対策。3Dビューポート以外から呼ばれて
    mode_setが失敗した場合でも、アドオン全体が停止しないようにコンソールへ
    ログを出すだけに留める(例外を再送出しない)。
    """
    if bpy.context.mode != "OBJECT":
        try:
            bpy.ops.object.mode_set(mode="OBJECT")
        except RuntimeError as error:
            print(f"[Croqui Line Tool] オブジェクトモードへの切り替えに失敗しました: {error}")


def get_or_create_collection(context: Context) -> Collection:
    """線オブジェクトをまとめる専用コレクションを取得する。無ければ新規作成する。

    通常のScene Collection直下にオブジェクトを重複リンクしないよう、
    このコレクションにだけリンクする運用にする。
    """
    collection = bpy.data.collections.get(COLLECTION_NAME)
    if collection is None:
        collection = bpy.data.collections.new(COLLECTION_NAME)

    # シーンにまだ紐付いていなければ、シーンのルートコレクションの子として追加する。
    scene_root = context.scene.collection
    if collection.name not in scene_root.children.keys():
        scene_root.children.link(collection)

    return collection


def _set_bsdf_input(bsdf, input_name: str, value) -> None:
    """Principled BSDFの入力ソケットに値を設定する。

    Blenderのバージョンによってソケット名が異なる可能性があるため、
    存在しない場合は何もせず静かに無視する(アドオンを停止させない)。
    """
    socket = bsdf.inputs.get(input_name)
    if socket is not None:
        socket.default_value = value


def get_or_create_material(color_rgb) -> Material:
    """線専用マテリアル(Croqui_Line_Material)を取得する。無ければ新規作成する。

    同名マテリアルが既に存在する場合は再利用し、重複作成しない。
    ベースカラーは常に現在の設定色で上書きするため、これを呼ぶだけで
    既存の全ての線にも色の変更が反映される(材質を共有しているため)。
    """
    material = bpy.data.materials.get(MATERIAL_NAME)
    if material is None:
        material = bpy.data.materials.new(MATERIAL_NAME)

    material.use_nodes = True

    bsdf = None
    for node in material.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            bsdf = node
            break

    if bsdf is not None:
        r, g, b = color_rgb[0], color_rgb[1], color_rgb[2]
        _set_bsdf_input(bsdf, "Base Color", (r, g, b, 1.0))
        _set_bsdf_input(bsdf, "Roughness", 0.8)
        _set_bsdf_input(bsdf, "Metallic", 0.0)
        # 発光は使用しない。
        _set_bsdf_input(bsdf, "Emission Strength", 0.0)

    return material


def generate_next_line_name() -> str:
    """次に使う線オブジェクト名を生成する(例: Croqui_Line_001)。

    既存のCroqui線(カスタムプロパティを持つオブジェクト)の中から
    最大の連番を探し、その次の番号を採番する。
    """
    max_index = 0
    for obj in bpy.data.objects:
        if not obj.get(CROQUI_LINE_PROP):
            continue
        match = _LINE_NAME_PATTERN.match(obj.name)
        if match:
            max_index = max(max_index, int(match.group(1)))

    return f"{LINE_NAME_PREFIX}{max_index + 1:03d}"


def is_croqui_line(obj: Optional[Object]) -> bool:
    """オブジェクトがCroqui Line Toolで作成した線かどうかを判定する。

    判定は名前ではなく、必ずカスタムプロパティ(CROQUI_LINE_PROP)で行う。
    Croqui_Linesコレクションに入っているかどうかには依存しない
    (ユーザーが手動で別のコレクションへ移動していても正しく判定できるようにするため)。
    """
    if obj is None:
        return False
    try:
        return bool(obj.get(CROQUI_LINE_PROP))
    except ReferenceError:
        # 削除済みオブジェクトへのダングリング参照だった場合はここに来る。
        return False


def iter_all_croqui_lines() -> List[Object]:
    """シーンに存在する全てのCroqui線オブジェクトを列挙する。"""
    return [obj for obj in bpy.data.objects if is_croqui_line(obj)]


# ------------------------------------------------------------
# Shrinkwrap(表面吸着)関連(Version 2で新規追加)
# ------------------------------------------------------------


def is_valid_mesh_target(target: Optional[Object]) -> bool:
    """吸着対象として有効かどうかを判定する。

    次のいずれかに該当する場合はFalseを返す。
    ・未設定(None)
    ・参照先が削除済み(リンク切れ)
    ・Meshオブジェクトではない
    """
    if target is None:
        return False
    try:
        return target.type == "MESH"
    except ReferenceError:
        # PointerPropertyの参照先が削除済みの場合、属性アクセス時にここへ来ることがある。
        return False


def has_shrinkwrap(obj: Object) -> bool:
    """このオブジェクトに既にCroqui用Shrinkwrapモディファイアが付いているか。"""
    try:
        return obj.modifiers.get(MODIFIER_NAME) is not None
    except ReferenceError:
        return False


def apply_shrinkwrap(obj: Object, target: Object, offset: float, wrap_method: str) -> None:
    """objへCroqui_Surface_Shrinkwrapを追加(既に存在すれば再利用)し、設定を反映する。

    Blenderのshrinkwrapモディファイアは「変形(Deform)」系モディファイアであり、
    Meshだけでなく、Version 1で作成しているCurveオブジェクトにもそのまま
    直接追加できる。そのためCurveをメッシュへ変換する必要はない。
    """
    modifier: Modifier = obj.modifiers.get(MODIFIER_NAME)
    if modifier is None:
        modifier = obj.modifiers.new(name=MODIFIER_NAME, type="SHRINKWRAP")

    modifier.target = target
    modifier.offset = offset
    modifier.wrap_method = wrap_method

    # 投影方向(PROJECT時のみ意味を持つが、方式切り替え時に状態が食い違わないよう
    # NEAREST_SURFACEPOINTの場合は明示的にFalseへ戻しておく)。
    is_project = wrap_method == "PROJECT"
    modifier.use_project_x = is_project
    modifier.use_project_y = is_project
    modifier.use_project_z = is_project
    modifier.use_negative_direction = is_project
    modifier.use_positive_direction = is_project

    # ビューポート・レンダー・編集モードのいずれでも効果が見えるようにする。
    modifier.show_viewport = True
    modifier.show_render = True
    modifier.show_in_editmode = True

    # モディファイア自体にはカスタムプロパティを持たせず、オブジェクト側で管理する。
    obj[MODIFIER_PROP] = True


def remove_shrinkwrap(obj: Object) -> bool:
    """objからCroqui_Surface_Shrinkwrapモディファイアだけを削除する。

    他のモディファイアには一切触れない。
    戻り値: 実際にモディファイアを削除した場合はTrue、元々無かった場合はFalse。
    """
    removed = False
    modifier = obj.modifiers.get(MODIFIER_NAME)
    if modifier is not None:
        obj.modifiers.remove(modifier)
        removed = True

    if MODIFIER_PROP in obj.keys():
        del obj[MODIFIER_PROP]

    return removed
