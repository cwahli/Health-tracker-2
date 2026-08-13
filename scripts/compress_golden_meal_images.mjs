import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const TARGET_DIR = path.resolve('tests/Golden_meal');
const MAX_BYTES = 300 * 1024; // 300 KB = 307,200 bytes

function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAllFiles(filePath, fileList);
    } else {
      const ext = path.extname(file).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.webp', '.heic'].includes(ext)) {
        fileList.push(filePath);
      }
    }
  }
  return fileList;
}

async function compressImage(filePath) {
  const initialStat = fs.statSync(filePath);
  const initialSize = initialStat.size;

  if (initialSize <= MAX_BYTES) {
    console.log(`[OK] Already <= 300KB: ${path.relative(TARGET_DIR, filePath)} (${(initialSize / 1024).toFixed(1)} KB)`);
    return;
  }

  const inputBuffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const isPng = ext === '.png';

  let currentBuffer = inputBuffer;
  let maxDim = 1920;
  let quality = 82;

  while (maxDim >= 800) {
    quality = isPng ? 85 : 80;
    while (quality >= 35) {
      let pipeline = sharp(inputBuffer).rotate().resize({
        width: maxDim,
        height: maxDim,
        fit: 'inside',
        withoutEnlargement: true,
      });

      if (isPng) {
        pipeline = pipeline.png({ quality: quality, compressionLevel: 9, effort: 7 });
      } else {
        pipeline = pipeline.jpeg({ quality: quality, mozjpeg: true });
      }

      const outBuffer = await pipeline.toBuffer();
      if (outBuffer.length <= MAX_BYTES) {
        fs.writeFileSync(filePath, outBuffer);
        const finalKb = (outBuffer.length / 1024).toFixed(1);
        const origKb = (initialSize / 1024).toFixed(1);
        console.log(`[COMPRESSED] ${path.relative(TARGET_DIR, filePath)}: ${origKb} KB -> ${finalKb} KB (dim=${maxDim}, q=${quality})`);
        return;
      }

      // If PNG is still too large, try converting to JPEG under 300KB if standard PNG quantization exceeds limit
      if (isPng && quality <= 50) {
        const jpgBuffer = await sharp(inputBuffer)
          .rotate()
          .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80, mozjpeg: true })
          .toBuffer();
        if (jpgBuffer.length <= MAX_BYTES) {
          // If user needs PNG extension, sharp can encode as PNG with indexed palette
          const indexedPng = await sharp(inputBuffer)
            .rotate()
            .resize({ width: Math.min(maxDim, 1400), height: Math.min(maxDim, 1400), fit: 'inside', withoutEnlargement: true })
            .png({ colours: 128, compressionLevel: 9 })
            .toBuffer();
          if (indexedPng.length <= MAX_BYTES) {
            fs.writeFileSync(filePath, indexedPng);
            console.log(`[COMPRESSED PNG] ${path.relative(TARGET_DIR, filePath)}: ${(initialSize/1024).toFixed(1)} KB -> ${(indexedPng.length/1024).toFixed(1)} KB`);
            return;
          }
        }
      }

      quality -= 7;
    }
    maxDim -= 200;
  }

  // Final fallback
  const finalPipeline = sharp(inputBuffer)
    .rotate()
    .resize({ width: 1000, height: 1000, fit: 'inside' });
  const finalBuffer = isPng
    ? await finalPipeline.png({ colours: 64, compressionLevel: 9 }).toBuffer()
    : await finalPipeline.jpeg({ quality: 50, mozjpeg: true }).toBuffer();

  fs.writeFileSync(filePath, finalBuffer);
  console.log(`[FALLBACK] ${path.relative(TARGET_DIR, filePath)}: ${(initialSize / 1024).toFixed(1)} KB -> ${(finalBuffer.length / 1024).toFixed(1)} KB`);
}

async function main() {
  const allImages = getAllFiles(TARGET_DIR);
  console.log(`Found ${allImages.length} images in ${TARGET_DIR}\n`);

  for (const img of allImages) {
    await compressImage(img);
  }

  console.log('\n--- Final Verification ---');
  let allPass = true;
  for (const img of allImages) {
    const size = fs.statSync(img).size;
    const kb = (size / 1024).toFixed(1);
    if (size > MAX_BYTES) {
      console.error(`FAIL: ${img} is ${kb} KB (> 300 KB)`);
      allPass = false;
    } else {
      console.log(`PASS: ${path.relative(TARGET_DIR, img)} = ${kb} KB`);
    }
  }

  if (allPass) {
    console.log(`\nSUCCESS: All ${allImages.length} images are <= 300 KB!`);
  }
}

main().catch(console.error);
