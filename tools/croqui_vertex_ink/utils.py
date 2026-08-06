# Croqui Vertex Ink - utils.py
#
# 複数のOperatorから共通で使う処理をまとめたモジュール。
# ・安全なクラス登録/解除(ZIP再インストール時の二重登録エラー対策)
# ・LinePaint属性(頂点ペイント用)の作成・取得
# ・LinePaint→_PAINTへの焼き込み計算(輝度変換・ドメイン変換)
#
# このファイル自身はbpy.types.Operator等のクラスを持たないため、
# register() / unregister() は用意していない。

from typing import Optional

import bpy
import numpy as np
from bpy.types import Attribute, Mesh, Object

# ------------------------------------------------------------
# 定数
# ------------------------------------------------------------

# 頂点ペイント用のカラー属性名(FLOAT_COLOR / POINTドメイン)。
LINE_PAINT_ATTR_NAME = "LinePaint"

# 焼き込み先のカスタム属性名。
# 先頭アンダースコアは必須(BlenderのglTFエクスポータは"_"始まりの
# カスタム属性しか書き出さない仕様のため、ここを変えると書き出されなくなる)。
BAKE_ATTR_NAME = "_PAINT"

# 輝度計算の重み(Rec.709準拠)。FLOAT_COLORはリニア値でガンマがかかって
# いないため、そのままの値に重みを掛けるだけで正しい輝度が得られる。
LUMINANCE_WEIGHTS = (0.2126, 0.7152, 0.0722)


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
            print(f"[Croqui Vertex Ink] {cls.__name__} の既存登録の解除に失敗しました: {error}")
    bpy.utils.register_class(cls)


def unregister_class_safe(cls: type) -> None:
    """クラスの登録を解除する。登録されていない場合は何もしない(エラーにしない)。"""
    existing = getattr(bpy.types, cls.__name__, None)
    if existing is None:
        return
    try:
        bpy.utils.unregister_class(existing)
    except RuntimeError as error:
        print(f"[Croqui Vertex Ink] {cls.__name__} の登録解除に失敗しました: {error}")


def delete_scene_property_safe(name: str) -> None:
    """bpy.types.Sceneに生やしたプロパティを安全に削除する。

    プロパティが存在しない状態(登録が途中で失敗した場合など)でdelattrすると
    AttributeErrorになるため、事前にhasattrで存在確認してから削除する。
    """
    if hasattr(bpy.types.Scene, name):
        try:
            delattr(bpy.types.Scene, name)
        except Exception as error:
            print(f"[Croqui Vertex Ink] Scene.{name} の削除に失敗しました: {error}")


# ------------------------------------------------------------
# 安全対策
# ------------------------------------------------------------


def ensure_object_mode() -> None:
    """現在のモードがオブジェクトモードでなければ、安全にオブジェクトモードへ戻す。

    頂点ペイントモードのまま属性の作成・変換・書き込みを行うと不安定になる
    ことがあるための対策。3Dビューポート以外から呼ばれてmode_setが失敗した
    場合でも、アドオン全体が停止しないようにコンソールへログを出すだけに
    留める(例外を再送出しない)。
    """
    if bpy.context.mode != "OBJECT":
        try:
            bpy.ops.object.mode_set(mode="OBJECT")
        except RuntimeError as error:
            print(f"[Croqui Vertex Ink] オブジェクトモードへの切り替えに失敗しました: {error}")


def get_active_mesh_object(context) -> Optional[Object]:
    """アクティブオブジェクトを取得する。Meshでなければ None を返す。"""
    obj = context.active_object
    if obj is None or obj.type != "MESH":
        return None
    return obj


# ------------------------------------------------------------
# LinePaint属性(頂点ペイント準備)
# ------------------------------------------------------------


def get_or_create_line_paint_attribute(mesh: Mesh) -> Attribute:
    """LinePaint属性(FLOAT_COLOR / POINTドメイン)を取得する。無ければ新規作成する。

    既に同名の属性が存在する場合は型・ドメインを問わずそのまま再利用する
    (ドメインがCORNERになっていた場合の変換は、焼き込み時にconvert_to_point_domain()
    が行う)。
    """
    attr = mesh.color_attributes.get(LINE_PAINT_ATTR_NAME)
    if attr is None:
        attr = mesh.color_attributes.new(
            name=LINE_PAINT_ATTR_NAME,
            type="FLOAT_COLOR",
            domain="POINT",
        )
    return attr


def set_active_paint_attribute(mesh: Mesh, attr: Attribute) -> None:
    """頂点ペイントモードでの描き込み先として、指定した属性をアクティブにする。"""
    index = mesh.color_attributes.find(attr.name)
    if index >= 0:
        mesh.color_attributes.active_color_index = index


# ------------------------------------------------------------
# 焼き込み(LinePaint → _PAINT)
# ------------------------------------------------------------


def convert_attribute_to_point_domain(mesh: Mesh, attr_name: str) -> Attribute:
    """指定した属性がPOINT(頂点)ドメインでなければ、POINTドメインへ変換する。

    頂点ペイントは既定でフェイスコーナー(CORNER)ドメインになりがちだが、
    glTFのカスタム属性は頂点単位(POINT)で書き出す必要があるため、焼き込みの
    前段階として必ずPOINTドメインへ揃える。変換にはBlender標準の
    「属性を変換」オペレータ(geometry.attribute_convert)を使い、Python側で
    頂点/コーナーを1つずつ回すことはしない(大規模メッシュでの速度低下を防ぐため)。
    """
    attr = mesh.attributes.get(attr_name)
    if attr is None:
        raise ValueError(f"属性 '{attr_name}' が見つかりません")

    if attr.domain == "POINT":
        return attr

    mesh.attributes.active = attr
    bpy.ops.geometry.attribute_convert(mode="GENERIC", domain="POINT", data_type="FLOAT_COLOR")

    converted = mesh.attributes.get(attr_name)
    if converted is None:
        raise RuntimeError(f"属性 '{attr_name}' のPOINTドメインへの変換に失敗しました")
    return converted


def compute_point_luminance(mesh: Mesh, color_attr: Attribute, intensity: float) -> np.ndarray:
    """POINTドメインのFLOAT_COLOR属性から、頂点ごとの輝度(0-1)をまとめて計算する。

    Blender標準のforeach_get/foreach_setとnumpyのベクトル演算のみを使い、
    頂点数ぶんのPythonループは行わない(10万頂点級のメッシュを想定した速度対策)。
    """
    vertex_count = len(mesh.vertices)
    flat = np.empty(vertex_count * 4, dtype=np.float32)
    color_attr.data.foreach_get("color", flat)
    rgba = flat.reshape(vertex_count, 4)

    weights = np.array(LUMINANCE_WEIGHTS, dtype=np.float32)
    luminance = rgba[:, :3] @ weights
    luminance = luminance * float(intensity)
    luminance = np.clip(luminance, 0.0, 1.0)
    return luminance.astype(np.float32)


def write_bake_attribute(mesh: Mesh, luminance: np.ndarray) -> Attribute:
    """輝度配列を、FLOAT / POINTドメインの"_PAINT"属性へ書き込む(無ければ作成)。"""
    attr = mesh.attributes.get(BAKE_ATTR_NAME)
    if attr is not None and (attr.domain != "POINT" or attr.data_type != "FLOAT"):
        # 想定と異なる型/ドメインで残っている場合は作り直す。
        mesh.attributes.remove(attr)
        attr = None

    if attr is None:
        attr = mesh.attributes.new(name=BAKE_ATTR_NAME, type="FLOAT", domain="POINT")

    attr.data.foreach_set("value", luminance)
    mesh.update()
    return attr
