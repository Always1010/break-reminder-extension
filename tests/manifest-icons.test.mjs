import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  const path = `icons/icon${size}.png`;
  assert.equal(manifest.icons?.[size], path, `清单应声明 ${size}px 扩展图标`);
  assert.equal(manifest.action?.default_icon?.[size], path, `工具栏应声明 ${size}px 图标`);
  const file = await readFile(new URL(`../${path}`, import.meta.url));
  assert.equal(file.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${path} 应为 PNG 图标`);
  assert.equal(file.readUInt32BE(16), size, `${path} 宽度应为 ${size}px`);
  assert.equal(file.readUInt32BE(20), size, `${path} 高度应为 ${size}px`);
}

console.log("manifest icon tests passed");
