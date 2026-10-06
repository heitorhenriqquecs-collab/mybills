const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'assets', 'logo.png');
const masterPath = path.join(root, 'assets', 'mybills-icon.png');
const icoPath = path.join(root, 'assets', 'mybills.ico');
const crop = { left: 245, top: 108, width: 760, height: 760 };

const androidSizes = {
  'mipmap-ldpi': { foreground: 81, launcher: 36 },
  'mipmap-mdpi': { foreground: 108, launcher: 48 },
  'mipmap-hdpi': { foreground: 162, launcher: 72 },
  'mipmap-xhdpi': { foreground: 216, launcher: 96 },
  'mipmap-xxhdpi': { foreground: 324, launcher: 144 },
  'mipmap-xxxhdpi': { foreground: 432, launcher: 192 }
};

function roundedMask(size, radius = Math.round(size * 0.16)) {
  return Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/></svg>`);
}

function circleMask(size) {
  return Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
}

async function pngAt(input, size, mask = null) {
  let image = sharp(input).resize(size, size, { fit: 'fill' }).ensureAlpha();
  if (mask) image = image.composite([{ input: mask(size), blend: 'dest-in' }]);
  return image.png().toBuffer();
}

function makeIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = header.length;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map(image => image.data)]);
}

async function main() {
  const master = await sharp(source)
    .extract(crop)
    .resize(1024, 1024, { fit: 'fill' })
    .png()
    .toBuffer();
  fs.writeFileSync(masterPath, master);

  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoImages = [];
  for (const size of icoSizes) icoImages.push({ size, data: await pngAt(master, size, roundedMask) });
  fs.writeFileSync(icoPath, makeIco(icoImages));

  for (const [folder, sizes] of Object.entries(androidSizes)) {
    const directory = path.join(root, 'android', 'app', 'src', 'main', 'res', folder);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'ic_launcher_foreground.png'), await pngAt(master, sizes.foreground));
    fs.writeFileSync(path.join(directory, 'ic_launcher.png'), await pngAt(master, sizes.launcher, roundedMask));
    fs.writeFileSync(path.join(directory, 'ic_launcher_round.png'), await pngAt(master, sizes.launcher, circleMask));
  }

  console.log(`Ícones gerados somente com o símbolo da marca: ${masterPath}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
