# Blenderをbackgroundモードで動かして croqui_vertex_ink アドオンを実地検証するスクリプト。
# 実行方法: blender --background --python tools/croqui_vertex_ink/.tmp/verify_addon.py
import os
import sys

import bpy

ADDON_PARENT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUTPUT_GLB = os.path.abspath(os.path.join(os.path.dirname(__file__), "verify_output.glb"))

if ADDON_PARENT_DIR not in sys.path:
    sys.path.insert(0, ADDON_PARENT_DIR)

import croqui_vertex_ink as addon  # noqa: E402

def fail(message):
    print(f"[FAIL] {message}")
    sys.exit(1)

def ok(message):
    print(f"[OK] {message}")


print("=== Croqui Vertex Ink 実地検証 ===")
print(f"Blender version: {bpy.app.version_string}")

# 1. まっさらなシーンにする
bpy.ops.wm.read_factory_settings(use_empty=True)

# 2. アドオンを登録
addon.register()
ok("アドオンを登録しました")

# 3. キューブを追加してアクティブにする
bpy.ops.mesh.primitive_cube_add()
cube = bpy.context.active_object
if cube is None or cube.type != "MESH":
    fail("キューブの作成に失敗しました")
ok(f"キューブを作成しました: {cube.name} (頂点数={len(cube.data.vertices)})")

# 4. 「ペイント準備」を実行(background modeなのでVERTEX_PAINTへの
#    切り替えは失敗する可能性があるが、属性作成自体は成功するはず)
result = bpy.ops.croqui_ink.prepare_paint()
print(f"prepare_paint result: {result}")
if "FINISHED" not in result:
    fail("prepare_paintがFINISHEDになりませんでした")

mesh = cube.data
line_paint = mesh.color_attributes.get("LinePaint")
if line_paint is None:
    fail("LinePaint属性が作成されていません")
if line_paint.data_type != "FLOAT_COLOR":
    fail(f"LinePaintのdata_typeがFLOAT_COLORではありません: {line_paint.data_type}")
if line_paint.domain != "POINT":
    fail(f"LinePaintのdomainがPOINTではありません: {line_paint.domain}")
ok(f"LinePaint属性を確認: data_type={line_paint.data_type}, domain={line_paint.domain}")

# 5. 「数頂点塗る」を模擬する: 頂点0-2を白、それ以外を黒にする
n_verts = len(mesh.vertices)
painted = [0.0, 0.0, 0.0, 1.0] * n_verts
for vi in (0, 1, 2):
    painted[vi * 4 + 0] = 1.0
    painted[vi * 4 + 1] = 1.0
    painted[vi * 4 + 2] = 1.0
line_paint.data.foreach_set("color", painted)
mesh.update()
ok("頂点0,1,2を白(1,1,1,1)、それ以外を黒(0,0,0,1)にペイントしました(模擬)")

# 6. 強度を0.5にして「焼き込み」を実行
bpy.context.scene.croqui_ink_intensity = 0.5
result = bpy.ops.croqui_ink.bake_paint()
print(f"bake_paint result: {result}")
if "FINISHED" not in result:
    fail("bake_paintがFINISHEDになりませんでした")

bake_attr = mesh.attributes.get("_PAINT")
if bake_attr is None:
    fail("_PAINT属性が作成されていません")
if bake_attr.data_type != "FLOAT":
    fail(f"_PAINTのdata_typeがFLOATではありません: {bake_attr.data_type}")
if bake_attr.domain != "POINT":
    fail(f"_PAINTのdomainがPOINTではありません: {bake_attr.domain}")

values = [0.0] * n_verts
bake_attr.data.foreach_get("value", values)
print(f"_PAINT values: {values}")

expected_white = 0.5  # luminance(white)=1.0 * intensity(0.5)
expected_black = 0.0
for vi in (0, 1, 2):
    if abs(values[vi] - expected_white) > 1e-4:
        fail(f"頂点{vi}の_PAINT値が期待値と異なります: got={values[vi]} expected={expected_white}")
for vi in range(3, n_verts):
    if abs(values[vi] - expected_black) > 1e-4:
        fail(f"頂点{vi}の_PAINT値が期待値と異なります: got={values[vi]} expected={expected_black}")
ok(f"_PAINT属性の値を確認(白頂点={expected_white}, 黒頂点={expected_black}, 強度0.5適用済み)")

# 7. 「エクスポート」を実行(GLB)
if os.path.exists(OUTPUT_GLB):
    os.remove(OUTPUT_GLB)

result = bpy.ops.croqui_ink.export_glb(filepath=OUTPUT_GLB)
print(f"export_glb result: {result}")
if "FINISHED" not in result:
    fail("export_glbがFINISHEDになりませんでした")
if not os.path.exists(OUTPUT_GLB):
    fail(f"GLBファイルが生成されていません: {OUTPUT_GLB}")
ok(f"GLBを書き出しました: {OUTPUT_GLB} ({os.path.getsize(OUTPUT_GLB)} bytes)")

# 8. アドオンを無効化→再度有効化しても二重登録エラーが出ないことを確認
addon.unregister()
addon.register()
ok("無効化→再有効化してもエラーが出ないことを確認しました")

print("=== すべてのBlender内検証に成功しました ===")
