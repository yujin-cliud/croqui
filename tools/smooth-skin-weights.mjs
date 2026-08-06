// スキンウェイト平滑化ツール(Blender不要のウェイト改善)。
// 関節を深く曲げたときのメッシュの潰れ・膨らみ(リニアブレンドスキニングの弱点)は、
// ウェイトの切り替わりが急なほど悪化する。隣接頂点とウェイトをなじませる
// (ラプラシアン平滑化)ことで、折り畳みの変形品質を上げる。
// 使い方: node tools/smooth-skin-weights.mjs <対象.glb> [反復回数=3] [強さ0-1=0.5]
import { NodeIO } from '@gltf-transform/core';

const target = process.argv[2];
const ITER = parseInt(process.argv[3] ?? '3', 10);
const LAMBDA = parseFloat(process.argv[4] ?? '0.5');
// 対象ジョイント名の部分一致フィルタ(カンマ区切り)。指定時はそのジョイントに
// ウェイトを持つ頂点だけを平滑化する(例: "thigh,leg_,knee" で脚だけ)。
const FILTER = (process.argv[5] ?? '').split(',').filter(Boolean);
if (!target) { console.error('使い方: node tools/smooth-skin-weights.mjs <対象.glb> [反復] [強さ] [対象ジョイント]'); process.exit(1); }

const io = new NodeIO();
const doc = await io.read(target);

for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const J = prim.getAttribute('JOINTS_0');
    const Wt = prim.getAttribute('WEIGHTS_0');
    const idx = prim.getIndices();
    if (!J || !Wt || !idx) continue;
    const nV = J.getCount();
    const ja = J.getArray();
    const wa = Wt.getArray();
    const ia = idx.getArray();

    // フィルタ対象ジョイント集合(スキンのジョイント順で判定)
    const skin = doc.getRoot().listSkins()[0];
    const jointNames = skin ? skin.listJoints().map((j) => j.getName() ?? '') : [];
    const targetJoint = new Set();
    if (FILTER.length && jointNames.length) {
      jointNames.forEach((nm, ji) => { if (FILTER.some((f) => nm.includes(f))) targetJoint.add(ji); });
    }
    const inScope = (v) => {
      if (targetJoint.size === 0) return true;
      for (let c = 0; c < 4; c++) if (wa[v * 4 + c] > 0.01 && targetJoint.has(ja[v * 4 + c])) return true;
      return false;
    };

    // 隣接リスト(エッジで繋がる頂点)
    const adj = Array.from({ length: nV }, () => new Set());
    for (let t = 0; t < ia.length; t += 3) {
      const a = ia[t], b = ia[t + 1], c = ia[t + 2];
      adj[a].add(b); adj[a].add(c);
      adj[b].add(a); adj[b].add(c);
      adj[c].add(a); adj[c].add(b);
    }

    // 疎(top4)→密マップ化して平滑化し、top4に戻す
    let dense = Array.from({ length: nV }, () => new Map());
    for (let v = 0; v < nV; v++) {
      for (let c = 0; c < 4; c++) {
        const w = wa[v * 4 + c];
        if (w > 0) dense[v].set(ja[v * 4 + c], (dense[v].get(ja[v * 4 + c]) ?? 0) + w);
      }
    }
    for (let it = 0; it < ITER; it++) {
      const next = Array.from({ length: nV }, () => new Map());
      for (let v = 0; v < nV; v++) {
        const nb = adj[v];
        if (nb.size === 0 || !inScope(v)) { next[v] = dense[v]; continue; }
        const avg = new Map();
        for (const u of nb) {
          for (const [j, w] of dense[u]) avg.set(j, (avg.get(j) ?? 0) + w / nb.size);
        }
        const out = new Map();
        const keys = new Set([...dense[v].keys(), ...avg.keys()]);
        for (const j of keys) {
          out.set(j, (dense[v].get(j) ?? 0) * (1 - LAMBDA) + (avg.get(j) ?? 0) * LAMBDA);
        }
        next[v] = out;
      }
      dense = next;
    }
    // top4化+正規化して書き戻し
    for (let v = 0; v < nV; v++) {
      if (!inScope(v)) continue;
      const top = [...dense[v].entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
      for (let c = 0; c < 4; c++) {
        ja[v * 4 + c] = top[c] ? top[c][0] : 0;
        wa[v * 4 + c] = top[c] ? top[c][1] / sum : 0;
      }
    }
    J.setArray(ja);
    Wt.setArray(wa);
    console.log(`平滑化: ${nV}頂点 × ${ITER}回 (強さ${LAMBDA})`);
  }
}
await io.write(target, doc);
console.log(`書き出し: ${target}`);
