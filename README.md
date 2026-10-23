# Diff Review

diffを前後の文脈とともに確認し、承認・否認・編集の結果から新しいdiffを出力するChrome拡張です。現在は開発途中のスナップショットです。

## 起動

1. GitHubの「Code → Download ZIP」などでソースを取得し、ZIPを展開します。
2. Chromeで `chrome://extensions/` を開き、「デベロッパーモード」を有効にします。
3. 「パッケージ化されていない拡張機能を読み込む」で、`manifest.json` があるフォルダを選びます。
4. 拡張アイコンから専用タブを開きます。「サンプルで試す」またはdiffの読み込みから開始します。

ビルドやnpm installは不要です。Manifest V3、manifest上の最低Chromeバージョンは116です。Chrome実機での確認はまだ行っていません。

## 開発

Node.jsとGitが必要です。依存パッケージはありません。

```sh
node --test tests/core.test.mjs
node --check app.js
node --check core.js
node --check background.js
```

2026-10-24時点で既存14テストと上記構文チェックは成功しました。クラウド環境（Linux / Node.js v24.19.0 / Git 2.52.0）でも再実行し、すべて成功しています。検証記録は [VERIFICATION.txt](VERIFICATION.txt)、引き継ぎ時点の仕様と残作業は [HANDOFF.md](HANDOFF.md) を参照してください。

## 使える範囲

- UTF-8のunified diffの読み込み、変更ごとの承認・否認・編集・保留
- 前後5行を基本とする文脈表示、元ファイル・フォルダの追加と照合
- 変更の分割、未判断フィルター、検索、Undo/Redo
- 端末内の自動保存、作業JSONの書き出し・復元
- 採用結果のプレビューとdiffのダウンロード

左右比較、TeX数式プレビュー、GitHubからの直接取り込みは未実装です。バイナリ、名前変更、コピー、モード変更、空ファイルの作成・削除、マージ形式は対象外です。CRLFはLFへ正規化します。

ファイルはブラウザ内で処理します。サーバー・外部通信・GitHub認証は使用しません。
