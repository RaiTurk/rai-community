import { readFileSync, writeFileSync } from 'node:fs';

export function writeWindowsIcon(destination, fullSizePng) {
  const shellSizes = [16, 20, 24, 30, 32, 40, 48, 60, 64, 72, 96, 128];
  const images = shellSizes.map(size => [
    size, readFileSync(new URL(`../desktop/webview2/icons/rai-${size}.png`, import.meta.url)),
  ]);
  images.push([256, readFileSync(fullSizePng)]);
  const headerSize = 6;
  const entrySize = 16;
  const directory = Buffer.alloc(headerSize + images.length * entrySize);
  directory.writeUInt16LE(1, 2); // ICO file type.
  directory.writeUInt16LE(images.length, 4);

  let imageOffset = directory.length;
  for (const [index, [size, png]] of images.entries()) {
    const entry = headerSize + index * entrySize;
    directory[entry] = directory[entry + 1] = size % 256; // 0 represents 256 px.
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(imageOffset, entry + 12);
    imageOffset += png.length;
  }
  writeFileSync(destination, Buffer.concat([directory, ...images.map(([, png]) => png)]));
}
