# スライド動画メーカー

画像・PDFから、X(旧Twitter)に投稿できるスライド動画(MP4)を、ブラウザの中だけで作る静的サイト。
デザインは sidenote・pdf-tools と同じ(ヒーロー+切り替えボタン+カード+フッター)。

- スタイル:カルーセル(事件ページ court-calendar と同じ見た目)/ ページめくり / カード飛ばし / キューブ回転 / 横スライド / 枠付き1枚 / フェード / ゆっくりズーム。カルーセル以外は進捗バー・ページ番号を付けられる(Xのタイムラインで大きく読める)
- 出力:MP4(H.264・30fps・音声なし)。Xの上限は2分20秒・512MB(通常のアカウント)
- 書き出しは WebCodecs(Chrome・Edge)。画像・PDFは外部に送られない
- 同梱ライブラリ(`public/vendor/`):pdf.js 4.10.38(PDF→画像)、mp4-muxer 5.1.3(MP4化)

## 開発・公開
- ローカル確認:`python -m http.server 8765 -d public` → http://127.0.0.1:8765/
- 公開:`deploy.bat`(初回は `npx wrangler pages project create slide-video`)
