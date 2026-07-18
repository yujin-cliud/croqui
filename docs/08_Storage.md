# 08 Storage

IndexedDBを使用する。

## Stores

Database: croqui-db  
Version: 1

Object Stores:

- settings
- favorites
- downloads

## Storage Interface

ManagerはIStorageServiceのみ参照する。

## Save Target

- お気に入り
- 設定
- ダウンロード済みポーズ情報

保存失敗でもアプリを止めない。
