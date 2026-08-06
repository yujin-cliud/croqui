// 凹み(曲率)ベイクツール: メッシュの「溝」(筋肉の筋・腹筋の割れ目等)を
// 幾何学から計算し、カスタム頂点属性 _CAVITY (0..1) としてGLBへ焼き込む。
// 線画モードのマテリアルがこれをインクとして描画する。
// スクリーンスペースのエッジ検出と違い、ノイズ無し・カメラ非依存・全ポーズ追従。
// 使い方: node tools/bake-cavity.mjs public/models/male2.glb
import { NodeIO } from '@gltf-transform/core';

const target = process.argv[2];
if (!target) { console.error('使い方: node tools/bake-cavity.mjs <対象.glb>'); process.exit(1); }

const io = new NodeIO();
const doc = await io.read(target);

for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    if (!prim.getAttribute('JOINTS_0')) continue; // スキンメッシュのみ
    const posAcc = prim.getAttribute('POSITION');
    const idxAcc = prim.getIndices();
    if (!posAcc || !idxAcc) continue;
    const POS = posAcc.getArray();
    const IDX = idxAcc.getArray();
    const nV = posAcc.getCount();
    if (nV < 1000) continue; // コントローラ形状等はスキップ

    // 面法線→頂点法線
    const N = new Float32Array(nV * 3);
    for (let t = 0; t < IDX.length; t += 3) {
      const a = IDX[t], b = IDX[t + 1], c = IDX[t + 2];
      const ax = POS[a*3], ay = POS[a*3+1], az = POS[a*3+2];
      const ux = POS[b*3]-ax, uy = POS[b*3+1]-ay, uz = POS[b*3+2]-az;
      const vx = POS[c*3]-ax, vy = POS[c*3+1]-ay, vz = POS[c*3+2]-az;
      const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
      for (const v of [a, b, c]) { N[v*3]+=nx; N[v*3+1]+=ny; N[v*3+2]+=nz; }
    }
    for (let v = 0; v < nV; v++) {
      const l = Math.hypot(N[v*3], N[v*3+1], N[v*3+2]) || 1;
      N[v*3]/=l; N[v*3+1]/=l; N[v*3+2]/=l;
    }
    // 隣接
    const adj = Array.from({ length: nV }, () => new Set());
    for (let t = 0; t < IDX.length; t += 3) {
      const a = IDX[t], b = IDX[t+1], c = IDX[t+2];
      adj[a].add(b); adj[a].add(c); adj[b].add(a); adj[b].add(c); adj[c].add(a); adj[c].add(b);
    }
    // 凹み度: 隣接頂点重心へのベクトルが法線方向に正 = 凹(溝)
    let cav = new Float32Array(nV);
    for (let v = 0; v < nV; v++) {
      let sx = 0, sy = 0, sz = 0, cnt = 0;
      for (const u of adj[v]) { sx += POS[u*3]-POS[v*3]; sy += POS[u*3+1]-POS[v*3+1]; sz += POS[u*3+2]-POS[v*3+2]; cnt++; }
      if (!cnt) continue;
      cav[v] = (sx*N[v*3] + sy*N[v*3+1] + sz*N[v*3+2]) / cnt;
    }
    // 2回スムージング(メッシュ由来のちらつき取り)
    for (let it = 0; it < 2; it++) {
      const next = new Float32Array(nV);
      for (let v = 0; v < nV; v++) {
        let s = cav[v], c = 1;
        for (const u of adj[v]) { s += cav[u]; c++; }
        next[v] = s / c;
      }
      cav = next;
    }
    // 95%点で正規化して0..1へ(凸側=負は0)
    const sorted = [...cav].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(nV * 0.95)] || 1;
    const out = new Float32Array(nV);
    for (let v = 0; v < nV; v++) out[v] = Math.max(0, Math.min(1, cav[v] / p95));

    const acc = doc.createAccessor('_CAVITY').setType('SCALAR').setArray(out);
    const buffer = doc.getRoot().listBuffers()[0];
    if (buffer) acc.setBuffer(buffer);
    prim.setAttribute('_CAVITY', acc);
    console.log(`ベイク: ${nV}頂点 (95%点=${p95.toExponential(2)})`);
  }
}
await io.write(target, doc);
console.log(`書き出し: ${target}`);
