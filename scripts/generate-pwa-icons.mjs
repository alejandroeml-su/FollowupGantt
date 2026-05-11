// Genera los PNG placeholder para PWA (Wave P20-A).
// Convierte `public/icon-sync.svg` (cloud-engranaje) a PNG 192/512.
//
// Uso:
//   node scripts/generate-pwa-icons.mjs
//
// Salida:
//   public/icons/icon-192.png
//   public/icons/icon-512.png
//
// NOTA: estos son placeholders generados desde el SVG branding existente.
// Para producción definitiva, Edwin puede regenerar con assets de mayor
// fidelidad o reemplazar manualmente los PNGs.

import { readFileSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "..");

const SVG = resolve(root, "public/icon-sync.svg");
const OUT_192 = resolve(root, "public/icons/icon-192.png");
const OUT_512 = resolve(root, "public/icons/icon-512.png");

async function main() {
  const svgBuf = readFileSync(SVG);
  await mkdir(resolve(root, "public/icons"), { recursive: true });

  // Fondo solido `theme_color` del manifest para que se vea bien
  // como icon maskable en Android (rellena las esquinas).
  const bg = { r: 79, g: 70, b: 229, alpha: 1 }; // #4f46e5

  for (const [out, size] of [
    [OUT_192, 192],
    [OUT_512, 512],
  ]) {
    const png = await sharp(svgBuf, { density: 384 })
      .resize(size, size, { fit: "contain", background: bg })
      .flatten({ background: bg })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(out, png);
    console.log(`[pwa-icons] ${out} (${png.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
