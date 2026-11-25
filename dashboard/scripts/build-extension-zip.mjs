// Packages ../extension into public/leetflow-extension.zip, the file behind
// the dashboard's "Download Extension" link. Runs before every build (npm
// "prebuild") so the download always matches the extension source.
//
// The output is deterministic — fixed timestamps, sorted entries — so
// rebuilding unchanged sources produces an identical file.
//
// If ../extension isn't available (e.g. a host that only uploads the
// dashboard folder), the existing zip is kept as-is.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(here, "../../extension");
const outFile = path.resolve(here, "../public/leetflow-extension.zip");

if (!fs.existsSync(path.join(extensionDir, "manifest.json"))) {
  console.warn(`[build-extension-zip] ${extensionDir} not found — keeping the existing zip.`);
  process.exit(0);
}

// Every file in the extension folder except dependencies and dotfiles.
function listFiles(dir, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(path.join(dir, entry.name), rel));
    else if (entry.isFile()) files.push(rel);
  }
  return files.sort();
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0;                          // 00:00:00
const DOS_DATE = (0 << 9) | (1 << 5) | 1;    // 1980-01-01
const UTF8_NAMES = 0x0800;
const DEFLATE = 8;

const localParts = [];
const centralParts = [];
let offset = 0;
const files = listFiles(extensionDir);

for (const rel of files) {
  const data = fs.readFileSync(path.join(extensionDir, ...rel.split("/")));
  const compressed = zlib.deflateRawSync(data, { level: 9 });
  const name = Buffer.from(rel, "utf8");
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);                 // version needed
  local.writeUInt16LE(UTF8_NAMES, 6);
  local.writeUInt16LE(DEFLATE, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);                 // extra length
  localParts.push(local, name, compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);               // version made by
  central.writeUInt16LE(20, 6);               // version needed
  central.writeUInt16LE(UTF8_NAMES, 8);
  central.writeUInt16LE(DEFLATE, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  // extra length, comment length, disk number, internal/external attributes: 0
  central.writeUInt32LE(offset, 42);          // local header offset
  centralParts.push(central, name);

  offset += local.length + name.length + compressed.length;
}

const centralDir = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralDir.length, 12);
end.writeUInt32LE(offset, 16);

const zip = Buffer.concat([...localParts, centralDir, end]);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, zip);
console.log(`[build-extension-zip] ${files.length} files → public/leetflow-extension.zip (${zip.length} bytes)`);
