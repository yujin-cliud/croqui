// 描画キャンバス(docs/04)の設定値。マジックナンバーをここに集約する。
export const DRAWING = {
  penWidth: 3,
  penColor: '#222222',
  eraserWidth: 28,
  // 「戻す」で保持する履歴の上限。1件ごとにキャンバス全体のスナップショットを
  // 保持するため、メモリを抑える目的で上限を設ける。
  undoLimit: 20,
};
