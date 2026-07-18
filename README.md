# Croqui

> 描く題材を探す時間を減らし、描く時間を増やす。

Croquiは、イラスト・漫画・アニメーションを学ぶ人のための、3Dマネキンを使ったクロッキー練習Webアプリです。

Ver.1ではMVPとして公開することを最優先にします。

## Features

- 3Dマネキン表示
- ポーズ切替
- ランダムポーズ
- タグ検索
- イラスト練習用の描画スペース(ペン・消しゴム・戻す・クリア)
- 細かな拡大・縮小(スムーズズーム)
- クロッキータイマー
- 自動次ポーズ
- お気に入り
- 背景3色
- カメラ操作
- PWA
- オフライン利用
- ローカル保存

## Tech Stack

- React
- Vite
- TypeScript
- Three.js
- React Three Fiber
- Drei
- Zustand
- IndexedDB
- PWA

## 開発状況

現在はVer.1の開発途中です。
木製マネキンの立ちポーズを中心に、ポーズ数を増やしています。

## Setup

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Documents

設計書は `docs/` を参照してください。

Claude Codeは最初に `CLAUDE.md` を読むこと。
