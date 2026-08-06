# Croqui Vertex Ink - __init__.py
#
# このファイルはBlenderアドオンのエントリーポイントです。
# bl_infoでアドオン情報を定義し、他モジュール(properties.py / operators.py /
# panel.py)のregister() / unregister() を呼び出すだけの薄い構成にしています。

bl_info = {
    "name": "Croqui Vertex Ink",
    "author": "Croqui",
    "version": (1, 0, 0),
    "blender": (4, 0, 0),
    "location": "View3D > Sidebar > Croqui",
    "description": "頂点ペイントで線画用のラインを描き込み、glTF/GLBへカスタム頂点属性として書き出す",
    "category": "3D View",
}

# 同一パッケージ内の他モジュールを読み込む。
# (相対importにすることで、ZIPインストール後のパッケージ名に依存しないようにしている)
from . import properties
from . import operators
from . import panel


def register() -> None:
    """アドオン有効化時にBlenderから呼ばれる。

    properties → operators → panel の順で登録する。
    panel.pyの描画処理はscene.croqui_ink_intensityを参照するため、
    先にproperties.register()でプロパティを登録しておく必要がある。
    """
    properties.register()
    operators.register()
    panel.register()


def unregister() -> None:
    """アドオン無効化時にBlenderから呼ばれる。

    登録の逆順(panel → operators → properties)で解除することで、
    依存関係の順序を崩さないようにしている。
    無効化→再有効化を繰り返しても、二重登録エラーが出ないように
    register_class/unregister_classの対応を1対1で保っている。
    """
    panel.unregister()
    operators.unregister()
    properties.unregister()
