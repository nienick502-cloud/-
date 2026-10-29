// 验证异步语义请求的竞态与降级行为；不替代浏览器视觉检查。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const library = JSON.parse(fs.readFileSync(new URL('data/demo_library.json', root), 'utf8'));
const script = html.slice(html.indexOf('let photoSequence = 0;'), html.indexOf("$('polaroid').onclick"));
const nodes = new Map();
function element(id) {
  if (!nodes.has(id)) nodes.set(id, {
    textContent: '', disabled: false, classList: {add() {}, remove() {}},
    querySelector() { return null; }, remove() {}, appendChild() {}, replaceChildren() {}
  });
  return nodes.get(id);
}
const images = [];
const requests = [];
const state = {};
const ranked = (first = 0) => [first, ...library.map((_, i) => i).filter(i => i !== first)]
  .map(songIndex => ({songIndex, segIndex: 1, energy: .5, score: .25,
    file: library[songIndex].file, start: library[songIndex].segments[1][1], end: library[songIndex].segments[1][2]}));
const context = vm.createContext({
  Image: class { constructor() { images.push(this); } },
  AbortController, FormData, URL: {revokeObjectURL() {}},
  location: {protocol: 'http:'}, LIBRARY: library, state, $: element,
  stopAudio() {}, renderCandidates() {}, renderSong() {}, setFluidPalette() {}, startAudio() {},
  analyzeImage() { return {warm: .5, lum: .5, sat: .5, contrast: .2, palette: []}; },
  matchLibrary() { return ranked(2); },
  setTimeout, clearTimeout, console,
  fetch(url, options) {
    // 故意忽略signal，使已取消的旧请求仍可返回，检查序号保护。
    return new Promise((resolve, reject) => requests.push({resolve, reject, options}));
  }
});
vm.runInContext(script, context);
const file = new Blob(['test'], {type: 'image/png'});

context.loadPhoto('blob:first', '第一张', false, file);
const first = images.at(-1).onload();
context.loadPhoto('blob:second', '第二张', false, file);
const second = images.at(-1).onload();
assert.equal(requests[0].options.signal.aborted, true);
requests[1].resolve({ok: true, json: async () => ({method: 'semantic', ranked: ranked(1), concepts: [{label: '海边'}]})});
await second;
assert.equal(state.songIndex, 1);
requests[0].resolve({ok: true, json: async () => ({method: 'semantic', ranked: ranked(0), concepts: [{label: '沙漠'}]})});
await first;
assert.equal(state.songIndex, 1, '旧请求不能覆盖新图片结果');
assert.equal(element('imageConcepts').textContent, '画面意境 · 海边');

context.loadPhoto('blob:offline', '断网', false, file);
const offline = images.at(-1).onload();
requests[2].reject(new TypeError('Failed to fetch'));
await offline;
assert.equal(state.songIndex, 2);
assert.equal(element('matchStatus').textContent, '色彩匹配 · 本地语义服务未连接');
assert.equal(element('imageConcepts').textContent, '');
assert.equal(element('play').disabled, false);

context.loadPhoto('blob:invalid', '无效结果', false, file);
const invalid = images.at(-1).onload();
requests[3].resolve({ok: true, json: async () => ({method: 'semantic', ranked: [], concepts: []})});
await invalid;
assert.equal(state.songIndex, 2, '无效API结果须回退到可用色彩结果');
assert.notEqual(element('matchStatus').textContent, '本地语义匹配');

// 歌曲数量和索引仍合法，但后端曲库已更新、页面未重建时，不可按旧索引播放。
for (const field of ['file', 'start', 'end']) {
  context.loadPhoto('blob:mismatch-' + field, '错位曲库', false, file);
  const mismatch = images.at(-1).onload();
  const changed = ranked(0);
  changed[0][field] = field === 'file' ? library[1].file : changed[0][field] + 1;
  requests.at(-1).resolve({ok: true, json: async () => ({method: 'semantic', ranked: changed, concepts: [{label: '旧曲库标签'}]})});
  await mismatch;
  assert.equal(state.songIndex, 2, field + ' 不一致时须回退，不能误播旧页面对应的歌曲或段落');
  assert.equal(element('matchStatus').textContent, '色彩匹配 · 语义结果与页面曲库不一致');
  assert.equal(element('imageConcepts').textContent, '');
}
console.log('通过：旧请求隔离、断连降级、无效结果降级、歌曲/起点/终点错位防护、真实状态文案。');
