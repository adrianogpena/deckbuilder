import sharp from 'sharp';

const SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Renders an SVG into a Windows .ico of PNG payloads (allowed since Vista), one per size. */
export async function writeIco(svgPath: string, icoPath: string): Promise<void> {
  const svg = await Bun.file(svgPath).arrayBuffer();
  const images = await Promise.all(
    SIZES.map(async (size) => [size, await sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toBuffer()] as const),
  );
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(([size, png], i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at); // 0 means 256
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt16LE(1, at + 4); // colour planes
    header.writeUInt16LE(32, at + 6); // bits per pixel
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  await Bun.write(icoPath, Buffer.concat([header, ...images.map(([, png]) => png)]));
}
