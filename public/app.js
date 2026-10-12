import { Muxer, ArrayBufferTarget } from "./vendor/mp4-muxer/mp4-muxer.mjs";

const X_MAX_SEC = 140, X_MAX_BYTES = 512 * 1024 * 1024;
const PDF_MAX_PAGES = 200, BITMAP_W = 1920;
const $ = id => document.getElementById(id);
const cv = $("cv"), ctx = cv.getContext("2d");
let slides = [];   // {bitmap, thumb, name}
let playing = false, playStart = 0, raf = 0;

// ---------- 入力 ----------
async function loadPdfjs(){
  const m = await import("./vendor/pdfjs/pdf.min.mjs");
  m.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
  return m;
}
function thumbOf(bm){
  const c = document.createElement("canvas"); c.width = 240; c.height = Math.round(240 * bm.height / bm.width);
  c.getContext("2d").drawImage(bm, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", .7);
}
function addBitmap(bm, name){ slides.push({ bitmap: bm, thumb: thumbOf(bm), name }); }
async function addPdf(file){
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  if(pdf.numPages > PDF_MAX_PAGES) throw new Error(`${file.name}: ページ数が多すぎます(${PDF_MAX_PAGES}ページまで)`);
  for(let n = 1; n <= pdf.numPages; n++){
    $("loadMsg").textContent = `${file.name} を変換中… ${n}/${pdf.numPages}ページ`;
    const page = await pdf.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: BITMAP_W / v1.width });
    const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    addBitmap(await createImageBitmap(c), `${file.name} p${n}`);
  }
}
async function addFiles(files){
  const list = [...files].sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }));
  const errs = [];
  for(const f of list){
    try{
      if(f.type === "application/pdf" || /\.pdf$/i.test(f.name)) await addPdf(f);
      else if(f.type.startsWith("image/")) addBitmap(await createImageBitmap(f), f.name);
      else errs.push(`${f.name}: 対応していない形式です`);
    }catch(e){ errs.push(`${f.name}: ${e.message || e}`); }
  }
  $("loadMsg").innerHTML = errs.length ? `<span class="is-error-text">${errs.join("<br>")}</span>` : "";
  refresh();
}
const drop = $("drop");
drop.onclick = () => $("file").click();
$("file").onchange = e => { addFiles(e.target.files); e.target.value = ""; };
["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => addFiles(e.dataTransfer.files));
$("clear").onclick = () => { slides.forEach(s => s.bitmap.close && s.bitmap.close()); slides = []; refresh(); };

function renderThumbs(){
  $("thumbs").innerHTML = slides.map((s, i) => `<div class="page-card">
    <div class="page-thumb-wrap"><img class="page-thumb" src="${s.thumb}" alt="">
      <button type="button" class="page-remove" data-d="${i}" title="削除" aria-label="削除">×</button></div>
    <div class="page-label"><span class="page-num">${i + 1}枚目</span><span class="page-source">${s.name.replace(/[<>&"]/g, "")}</span></div>
    <div class="page-actions"><button type="button" class="act-btn" data-m="-1" data-i="${i}" title="前へ">←</button><button type="button" class="act-btn" data-m="1" data-i="${i}" title="後ろへ">→</button></div>
  </div>`).join("");
}
$("thumbs").onclick = e => {
  const b = e.target.closest("button"); if(!b) return;
  if(b.dataset.d !== undefined){ const [s] = slides.splice(+b.dataset.d, 1); s.bitmap.close && s.bitmap.close(); }
  else{ const i = +b.dataset.i, j = i + +b.dataset.m; if(j < 0 || j >= slides.length) return; [slides[i], slides[j]] = [slides[j], slides[i]]; }
  refresh();
};

// ---------- 設定 ----------
function opts(){
  const [W, H] = $("size").value.split("x").map(Number);
  return {
    style: document.querySelector("#styleGrid .selected").dataset.style, W, H,
    hold: Math.max(.5, +$("hold").value || 3), move: Math.max(.2, +$("move").value || .7),
    bg: $("bgc").value, fit: $("fit").value, loopback: $("loopback").checked, bar: $("bar").checked, counter: $("counter").checked,
  };
}
function totalDuration(o){
  const n = slides.length; if(!n) return 0;
  const moves = o.loopback ? n : n - 1;
  return n * o.hold + moves * o.move + (o.loopback ? 0 : 0);
}
// 時刻 t(秒)での「いま何枚目か(小数)」。保持→移動→保持…
const ease = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
function position(t, o){
  const n = slides.length, seg = o.hold + o.move;
  const k = Math.min(Math.floor(t / seg), o.loopback ? n - 1 : n - 1);
  const within = t - k * seg;
  const last = !o.loopback && k >= n - 1;
  if(within < o.hold || last) return k;
  return k + ease(Math.min(1, (within - o.hold) / o.move));
}

// ---------- 描画 ----------
function drawFit(g, bm, x, y, w, h, fit, r){
  g.save();
  g.beginPath(); g.roundRect(x, y, w, h, r); g.clip();
  if(fit === "cover"){
    const s = Math.max(w / bm.width, h / bm.height), dw = bm.width * s, dh = bm.height * s;
    g.drawImage(bm, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }else{
    g.fillStyle = "#fff"; g.fillRect(x, y, w, h);
    const s = Math.min(w / bm.width, h / bm.height), dw = bm.width * s, dh = bm.height * s;
    g.drawImage(bm, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  g.restore();
}
// ---------- 全画面系スタイル(Xのタイムラインで大きく読める) ----------
const wrapD = (d, n, loop) => { if(!loop) return d; if(d > n / 2) d -= n; if(d < -n / 2) d += n; return d; };
// 余白を白でなく背景色のまま見せる版(全画面系の「全体を見せる」用)
function drawImg(g, bm, x, y, w, h, fit, r, paper){
  g.save();
  g.beginPath(); g.roundRect(x, y, w, h, r); g.clip();
  if(paper){ g.fillStyle = "#fff"; g.fillRect(x, y, w, h); }
  const s = (fit === "cover" ? Math.max : Math.min)(w / bm.width, h / bm.height), dw = bm.width * s, dh = bm.height * s;
  g.drawImage(bm, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  g.restore();
}
function drawFull(t, pos, o){
  const { W, H } = o, n = slides.length, seg = o.hold + o.move;
  if(o.style === "slide" || o.style === "zoom"){
    const i = Math.floor(pos), f = pos - i;
    const draw = (idx, a) => {
      let z = 1;
      if(o.style === "zoom"){ const u = Math.min(1, Math.max(0, (t - (idx * seg - o.move)) / (o.hold + 2 * o.move))); z = 1 + .06 * u; }
      ctx.globalAlpha = a; ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
      drawImg(ctx, slides[idx % n].bitmap, 0, 0, W, H, o.fit, 0, false); ctx.restore(); ctx.globalAlpha = 1;
    };
    draw(i, 1);
    if(f > 0 && (i + 1 < n || o.loopback)) draw(i + 1, f);
    return;
  }
  if(o.style === "cube"){
    // キューブ回転: 箱が左へ90度回り、右の面(次のスライド)が正面に来る
    const k = Math.min(Math.floor(pos), n - 1), p = pos - k;
    const nx = (k + 1 < n || o.loopback) ? (k + 1) % n : -1;
    if(p <= 0 || nx < 0){ drawImg(ctx, slides[k].bitmap, 0, 0, W, H, o.fit, 0, false); return; }
    const a = p * Math.PI / 2, c = Math.cos(a), sn = Math.sin(a), sc = 1 / (c + sn) * (1 - .08 * Math.sin(2 * a));
    const w1 = W * c * sc, w2 = W * sn * sc, fh = H * sc, x0 = (W - w1 - w2) / 2, y0 = (H - fh) / 2;
    const face = (bm, x, w, shade) => {
      if(w < 1) return;
      ctx.save(); ctx.translate(x, y0); ctx.scale(w / W, fh / H); drawImg(ctx, bm, 0, 0, W, H, o.fit, 0, false); ctx.restore();
      ctx.fillStyle = `rgba(0,0,0,${shade})`; ctx.fillRect(x, y0, w, fh);
    };
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.25)"; ctx.shadowBlur = W * .03; ctx.fillStyle = o.bg; ctx.fillRect(x0, y0, w1 + w2, fh); ctx.restore();
    face(slides[k].bitmap, x0, w1, .3 * sn);
    face(slides[nx].bitmap, x0 + w1, w2, .3 * c);
    return;
  }
  if(o.style === "curl" || o.style === "toss"){
    const k = Math.min(Math.floor(pos), n - 1), p = pos - k;
    const nx = (k + 1 < n || o.loopback) ? (k + 1) % n : -1;
    const cur = slides[k].bitmap;
    if(p <= 0 || nx < 0){ drawImg(ctx, cur, 0, 0, W, H, o.fit, 0, false); return; }
    const nb = slides[nx].bitmap;
    if(o.style === "toss"){
      // 手前の1枚が左へ傾きながら飛んでいき、下から次の1枚が少し大きくなって現れる
      ctx.save(); ctx.translate(W / 2, H / 2); const s = .93 + .07 * p; ctx.scale(s, s); ctx.translate(-W / 2, -H / 2);
      drawImg(ctx, nb, 0, 0, W, H, o.fit, 0, false); ctx.restore();
      ctx.save(); ctx.translate(W / 2 - p * W * 1.15, H / 2 + p * H * .12); ctx.rotate(-p * .2);
      ctx.shadowColor = "rgba(0,0,0,.3)"; ctx.shadowBlur = W * .03; ctx.shadowOffsetX = W * .008; ctx.fillStyle = o.bg; ctx.fillRect(-W / 2, -H / 2, W, H);
      ctx.shadowColor = "transparent"; ctx.translate(-W / 2, -H / 2);
      drawImg(ctx, cur, 0, 0, W, H, o.fit, 0, false); ctx.restore();
      return;
    }
    // ページめくり: 右端から折り目が左へ進み、めくれた紙の裏側が折り目の左に見える
    const f = W * (1 - p);
    drawImg(ctx, nb, 0, 0, W, H, o.fit, 0, false);
    let g = ctx.createLinearGradient(f, 0, f + W * .08, 0);   // 次ページに落ちる影
    g.addColorStop(0, "rgba(0,0,0,.28)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(f, 0, W * .08, H);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, f, H); ctx.clip();
    drawImg(ctx, cur, 0, 0, W, H, o.fit, 0, false); ctx.restore();
    const fw = Math.min(W - f, f);
    if(fw > 0){
      ctx.save(); ctx.beginPath(); ctx.rect(f - fw, 0, fw, H); ctx.clip();
      ctx.translate(f, 0); ctx.scale(-1, 1); ctx.translate(-f, 0);
      drawImg(ctx, cur, 0, 0, W, H, o.fit, 0, false); ctx.restore();
      g = ctx.createLinearGradient(f - fw, 0, f, 0);   // 裏側の紙の陰影(折り目に近いほど明るい)
      g.addColorStop(0, "rgba(0,0,0,.22)"); g.addColorStop(.85, "rgba(255,255,255,.25)"); g.addColorStop(1, "rgba(255,255,255,.55)");
      ctx.fillStyle = g; ctx.fillRect(f - fw, 0, fw, H);
      g = ctx.createLinearGradient(f - fw - W * .05, 0, f - fw, 0);   // めくれた紙の端の影
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.2)");
      if(f - fw > 0){ ctx.fillStyle = g; ctx.fillRect(f - fw - W * .05, 0, W * .05, H); }
    }
    return;
  }
  // push(横にすっと押し出す)・card(枠付きの1枚が横に流れる)
  const card = o.style === "card", m = card ? Math.min(W, H) * .05 : 0;
  for(let i = 0; i < n; i++){
    const d = wrapD(i - pos, n, o.loopback);
    if(Math.abs(d) >= 1) continue;
    const x = d * W;
    if(card){
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,.18)"; ctx.shadowBlur = W * .02; ctx.shadowOffsetY = W * .006;
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.roundRect(x + m, m, W - 2 * m, H - 2 * m, W * .012); ctx.fill(); ctx.restore();
      drawImg(ctx, slides[i].bitmap, x + m, m, W - 2 * m, H - 2 * m, o.fit, W * .012, true);
    }else drawImg(ctx, slides[i].bitmap, x, 0, W, H, o.fit, 0, false);
  }
}
// 進捗バーとページ番号(全画面系のみ。動画を途中から見た人にも位置が分かる)
function drawOverlay(t, pos, o){
  const { W, H } = o, n = slides.length;
  if(o.counter){
    const cur = Math.round(pos) % n, txt = `${cur + 1} / ${n}`, fs = Math.round(Math.min(W, H) * .036);
    ctx.save(); ctx.font = `700 ${fs}px "Source Sans Pro", system-ui, sans-serif`;
    const pw = ctx.measureText(txt).width + fs * 1.2, ph = fs * 1.7, x = W - pw - fs * .9, y = fs * .9;
    ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.beginPath(); ctx.roundRect(x, y, pw, ph, ph / 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.textAlign = "center"; ctx.fillText(txt, x + pw / 2, y + ph / 2 + 1);
    ctx.restore();
  }
  if(o.bar){
    const bh = Math.max(6, Math.round(H * .009)), total = totalDuration(o) || 1;
    ctx.fillStyle = "rgba(0,0,0,.14)"; ctx.fillRect(0, H - bh, W, bh);
    ctx.fillStyle = "#b93226"; ctx.fillRect(0, H - bh, W * Math.min(1, t / total), bh);
  }
}
function drawFrame(t, o){
  const { W, H } = o, n = slides.length;
  if(cv.width !== W || cv.height !== H){ cv.width = W; cv.height = H; }
  ctx.fillStyle = o.bg; ctx.fillRect(0, 0, W, H);
  if(!n) return;
  const pos = position(t, o);
  if(o.style !== "carousel"){ drawFull(t, pos, o); drawOverlay(t, pos, o); return; }
  // カルーセル(事件ページの見た目: 中央1.15倍・左右0.92倍で半透明、4.5秒ごとに右→左)
  const per = W >= H ? 2.2 : 1.3, gap = W * 0.025;
  const sw = (W - gap * (per - 1)) / per, sh = sw * 9 / 16;
  const cy = H * .5;
  const items = [];
  for(let i = 0; i < n; i++){
    let d = i - pos;
    for(const k of (o.loopback ? [-1, 0, 1] : [0])){
      const dd = d + k * n;
      if(Math.abs(dd) < 2.6) items.push({ i, dd });
    }
  }
  items.sort((a, b) => Math.abs(b.dd) - Math.abs(a.dd));
  for(const it of items){
    const a = Math.min(1, Math.abs(it.dd));
    const scale = 1.15 - a * (1.15 - .92), alpha = 1 - a * .5;
    const cx = W / 2 + it.dd * (sw + gap);
    const w = sw * scale, h = sh * scale;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.shadowColor = "rgba(0,0,0,.16)"; ctx.shadowBlur = W * .016; ctx.shadowOffsetY = W * .005;
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 14 * W / 1120); ctx.fill();
    ctx.shadowColor = "transparent";
    drawFit(ctx, slides[it.i].bitmap, cx - w / 2, cy - h / 2, w, h, o.fit, 14 * W / 1120);
    ctx.restore();
  }
}

// 1枚の秒数を縮めて、Xの上限(140秒)に収める(切り替え時間は保つ)
$("fit140").onclick = () => {
  const o = opts(), n = slides.length, moves = o.loopback ? n : n - 1;
  const h = Math.floor(((X_MAX_SEC - 1 - moves * o.move) / n) * 10) / 10;
  if(h < .5){ alert("枚数が多すぎて、1枚0.5秒でも140秒に収まりません。枚数を減らしてください。"); return; }
  $("hold").value = h; refresh();
};
// ---------- プレビュー ----------
function refresh(){
  renderThumbs();
  const o = opts(), n = slides.length;
  $("count").textContent = n + "枚";
  $("clear").disabled = !n; $("thumbsCard").hidden = !n; $("play").disabled = !n; $("make").disabled = !n;
  const tot = totalDuration(o);
  $("dur").innerHTML = n ? `<span class="badge ${tot > X_MAX_SEC ? "warn" : "ok"}">約${tot.toFixed(1)}秒 ${tot > X_MAX_SEC ? "(Xの上限140秒を超えています)" : "(Xに投稿できる長さ)"}</span>` : "";
  $("fit140").hidden = !(tot > X_MAX_SEC);
  stop(); drawFrame(0, o);
}
function stop(){ playing = false; cancelAnimationFrame(raf); $("play").textContent = "▶ プレビュー"; }
$("play").onclick = () => {
  if(playing) return stop();
  const o = opts(); playing = true; playStart = performance.now(); $("play").textContent = "■ 止める";
  const tick = () => {
    if(!playing) return;
    const t = (performance.now() - playStart) / 1000;
    if(t >= totalDuration(o)){ drawFrame(totalDuration(o), o); return stop(); }
    drawFrame(t, o); raf = requestAnimationFrame(tick);
  };
  tick();
};
["size", "bar", "counter", "hold", "move", "bgc", "fit", "loopback"].forEach(id => $(id).addEventListener("change", refresh));

// ---------- 書き出し(WebCodecsでフレームごとにMP4へ) ----------
async function pickCodec(W, H, fps, bitrate){
  const cands = [["avc1.640034", "avc"], ["avc1.640028", "avc"], ["avc1.42E01F", "avc"], ["vp09.00.40.08", "vp9"]];
  for(const [codec, mux] of cands){
    const cfg = { codec, width: W, height: H, bitrate, framerate: fps };
    try{ const s = await VideoEncoder.isConfigSupported(cfg); if(s.supported) return { cfg, mux }; }catch{}
  }
  return null;
}
async function makeVideo(){
  if(!("VideoEncoder" in window)){ $("msg").innerHTML = `<span class="is-error-text">このブラウザは動画の書き出しに対応していません。Chrome か Edge の新しい版で開いてください。</span>`; return; }
  stop();
  const o = opts(), fps = 30, { W, H } = o, total = totalDuration(o), frames = Math.ceil(total * fps);
  const bitrate = Math.round(W * H * 4);   // 1080pで約8Mbps
  const pick = await pickCodec(W, H, fps, bitrate);
  if(!pick){ $("msg").innerHTML = `<span class="is-error-text">このPCで使える動画エンコーダーが見つかりませんでした。</span>`; return; }
  $("make").disabled = true; $("out").innerHTML = ""; $("prog").hidden = false; $("prog").value = 0; $("prog").max = frames;
  $("msg").textContent = "動画を作っています…";
  let encErr = null;
  try{
    const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: pick.mux, width: W, height: H, frameRate: fps }, fastStart: "in-memory" });
    const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { encErr = e; } });
    enc.configure(pick.cfg);
    for(let f = 0; f < frames; f++){
      if(encErr) throw encErr;
      drawFrame(Math.min(f / fps, total), o);
      const vf = new VideoFrame(cv, { timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps) });
      enc.encode(vf, { keyFrame: f % (fps * 2) === 0 }); vf.close();
      if(enc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 0));
      if(f % 5 === 0){ $("prog").value = f; await new Promise(r => setTimeout(r, 0)); }
    }
    await enc.flush(); enc.close(); muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);
    const name = `スライド動画_${new Date().toISOString().slice(0, 10)}.mp4`;
    $("out").innerHTML = `<video src="${url}" controls class="result-video"></video><a class="btn-primary dl" href="${url}" download="${name}">${name} を保存(${(blob.size / 1048576).toFixed(1)}MB)</a>`;
    const warn = [];
    if(pick.mux !== "avc") warn.push("このPCではH.264が使えずVP9で作りました。XはH.264のMP4が確実なので、別のPC・ブラウザで作り直してください。");
    if(total > X_MAX_SEC) warn.push(`長さが${X_MAX_SEC}秒を超えているため、Xには投稿できません。`);
    if(blob.size > X_MAX_BYTES) warn.push("512MBを超えているため、Xには投稿できません。サイズを小さくしてください。");
    $("msg").innerHTML = `できました(${W}×${H}・${total.toFixed(1)}秒・${pick.mux === "avc" ? "H.264" : "VP9"})` + warn.map(w => `<br><span class="is-error-text">${w}</span>`).join("");
  }catch(e){ $("msg").innerHTML = `<span class="is-error-text">書き出しに失敗しました:${e.message || e}</span>`; }
  $("prog").hidden = true; $("make").disabled = false; drawFrame(0, o);
}
$("make").onclick = makeVideo;

$("styleGrid").addEventListener("click", e => {
  const b = e.target.closest(".theme-swatch"); if(!b) return;
  document.querySelectorAll("#styleGrid .theme-swatch").forEach(x => x.classList.toggle("selected", x === b));
  document.getElementById("cardOverlay").hidden = b.dataset.style === "carousel";
  refresh();
});
window.app = { addBitmap, refresh, drawFrame, opts, slides: () => slides };   // 動作確認用
refresh();