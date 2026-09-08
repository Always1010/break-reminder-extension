import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const assets = [
  ["gentle-rain", "sounds/gentle-rain.ogg", "OggS"],
  ["gentle-wind", "sounds/gentle-wind.ogg", "OggS"],
  ["piano-loop", "sounds/piano-loop.mp3", "ID3"],
  ["calm-loop", "sounds/calm-loop.mp3", "ID3"],
  ["soft-sax", "sounds/soft-sax.ogg", "OggS"]
];

const optionsHtml = await readFile(new URL("../options.html", import.meta.url), "utf8");
const offscreenJs = await readFile(new URL("../offscreen.js", import.meta.url), "utf8");

for (const [soundId, path, expectedHeader] of assets) {
  assert.ok(optionsHtml.includes(`value="${soundId}"`), `${soundId} 应显示在声音选项中`);
  assert.ok(offscreenJs.includes(`"${soundId}": "${path}"`), `${soundId} 应映射到本地音频文件`);
  const file = await readFile(new URL(`../${path}`, import.meta.url));
  assert.equal(file.subarray(0, expectedHeader.length).toString("ascii"), expectedHeader, `${path} 应具有有效的音频文件头`);
}

assert.ok(optionsHtml.includes('value="white-noise"'), "白噪音应显示在声音选项中");
assert.ok(offscreenJs.includes('message.sound === "white-noise"'), "白噪音应由本地音频引擎生成");

console.log("sound asset tests passed");
