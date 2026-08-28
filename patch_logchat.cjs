const fs = require('fs');
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

// 1. Line 1380
code = code.replace(
/      const remotePhoto =\n        job\.photoUrl \|\|\n        job\.result\?\.photoUrl \|\|\n        job\.result\?\.clean_result\?\.photoUrl \|\|\n        \(job\.result as any\)\?\.data\?\.photoUrl \|\|\n        \(job as any\)\.clean_result\?\.photoUrl \|\|\n        \(job as any\)\.photo_url;/g,
`      const remotePhoto =
        job.photoUrl ||
        job.result?.photoUrl ||
        job.result?.clean_result?.photoUrl ||
        (job.result as any)?.data?.photoUrl ||
        (job as any).clean_result?.photoUrl ||
        (job as any).photo_url;
      const remotePhotos = job.result?.imageUrls || job.result?.photoUrls || job.result?.clean_result?.imageUrls || job.result?.clean_result?.photoUrls || (job as any).clean_result?.imageUrls || (job as any).clean_result?.photoUrls || (remotePhoto ? [remotePhoto] : []);`
);

code = code.replace(
/            } else if \(remotePhoto\) {\n              userMsg\.imageUrl = remotePhoto;\n              userMsg\.imageUrls = \[remotePhoto\];\n            }/g,
`            } else if (remotePhotos && remotePhotos.length > 0) {
              userMsg.imageUrl = remotePhotos[0];
              userMsg.imageUrls = remotePhotos;
            }`
);

code = code.replace(
/            if \(remotePhoto\) {\n              userMsg\.imageUrl = remotePhoto;\n              userMsg\.imageUrls = \[remotePhoto\];\n            }/g,
`            if (remotePhotos && remotePhotos.length > 0) {
              userMsg.imageUrl = remotePhotos[0];
              userMsg.imageUrls = remotePhotos;
            }`
);

code = code.replace(
/          \} else if \(foodLog && remotePhoto\) {\n            foodLog\.imageUrl = foodLog\.imageUrl \|\| remotePhoto;\n            foodLog\.imageUrls = foodLog\.imageUrls\?\.length \? foodLog\.imageUrls : \[remotePhoto\];\n          }/g,
`          } else if (foodLog && remotePhotos && remotePhotos.length > 0) {
            foodLog.imageUrl = foodLog.imageUrl || remotePhotos[0];
            foodLog.imageUrls = foodLog.imageUrls?.length ? foodLog.imageUrls : remotePhotos;
          }`
);

code = code.replace(
/          if \(foodLog && remotePhoto\) {\n            foodLog\.imageUrl = foodLog\.imageUrl \|\| remotePhoto;\n            foodLog\.imageUrls = foodLog\.imageUrls\?\.length \? foodLog\.imageUrls : \[remotePhoto\];\n          }/g,
`          if (foodLog && remotePhotos && remotePhotos.length > 0) {
            foodLog.imageUrl = foodLog.imageUrl || remotePhotos[0];
            foodLog.imageUrls = foodLog.imageUrls?.length ? foodLog.imageUrls : remotePhotos;
          }`
);

code = code.replace(
/              \} else if \(remotePhoto\) {\n                foodLog\.imageUrl = foodLog\.imageUrl \|\| remotePhoto;\n                foodLog\.imageUrls = foodLog\.imageUrls\?\.length \? foodLog\.imageUrls : \[remotePhoto\];\n              }/g,
`              } else if (remotePhotos && remotePhotos.length > 0) {
                foodLog.imageUrl = foodLog.imageUrl || remotePhotos[0];
                foodLog.imageUrls = foodLog.imageUrls?.length ? foodLog.imageUrls : remotePhotos;
              }`
);

code = code.replace(
/            if \(foodLog && remotePhoto\) {\n              foodLog\.imageUrl = foodLog\.imageUrl \|\| remotePhoto;\n              foodLog\.imageUrls = foodLog\.imageUrls\?\.length \? foodLog\.imageUrls : \[remotePhoto\];\n            }/g,
`            if (foodLog && remotePhotos && remotePhotos.length > 0) {
              foodLog.imageUrl = foodLog.imageUrl || remotePhotos[0];
              foodLog.imageUrls = foodLog.imageUrls?.length ? foodLog.imageUrls : remotePhotos;
            }`
);

// 1577 replacement
code = code.replace(
/        const remotePhoto = job\.photoUrl \|\| job\.result\?\.photoUrl \|\| \(job\.result as any\)\?\.clean_result\?\.photoUrl;\n        try {\n          const realImages = await ImageStore\.getImages\(activeJobId\);\n          const realUrls = \(realImages && realImages\.length > 0\)\n            \? realImages\.map\(\(img: any\) => typeof img === 'string' \? img : URL\.createObjectURL\(img as Blob\)\)\n            : \(remotePhoto \? \[remotePhoto\] : \[\]\);/g,
`        const remotePhoto = job.photoUrl || job.result?.photoUrl || (job.result as any)?.clean_result?.photoUrl;
        const remotePhotos = job.result?.imageUrls || job.result?.photoUrls || job.result?.clean_result?.imageUrls || job.result?.clean_result?.photoUrls || (job as any).clean_result?.imageUrls || (job as any).clean_result?.photoUrls || (remotePhoto ? [remotePhoto] : []);
        try {
          const realImages = await ImageStore.getImages(activeJobId);
          const realUrls = (realImages && realImages.length > 0)
            ? realImages.map((img: any) => typeof img === 'string' ? img : URL.createObjectURL(img as Blob))
            : remotePhotos;`
);

fs.writeFileSync('src/components/LogChat.tsx', code);
