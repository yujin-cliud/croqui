# Croqui Line Tool - __init__.py
#
# このファイルはBlenderアドオンのエントリーポイントです。
# bl_infoでアドオン情報を定義し、他モジュール(properties.py / operators.py /
# panel.py)のregister() / unregister() を呼び出すだけの薄い構成にしています。
#
# Version 2で「表面への吸着(Shrinkwrap)」機能を追加したのに伴い、
# 設定値を扱うproperties.pyと共通処理を扱うutils.pyを新設した。
# utils.pyはOperator/PropertyGroup等のクラスを持たないため、
# register()/unregister()は無く、ここから呼び出す必要もない。

bl_info = {
    "name": "Croqui Line Tool",
    "author": "Croqui",
    "version": (2, 0, 0),
    "blender": (5, 1, 0),
    "location": "View3D > Sidebar > Croqui",
    "description": "人体モデル上に筋肉線・関節線を作成し、モデル表面へ吸着させるための専用ツール(Version 2)",
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
    operators.pyのOperatorやpanel.pyの描画処理はscene.croqui_line_tool /
    scene.croqui_line_target などのプロパティを参照するため、
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
