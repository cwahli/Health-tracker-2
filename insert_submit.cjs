const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const target = `          // Durable jobs execute on server via /api/jobs/submit
          if (job.kind === 'food_log' || job.kind === 'food_compare' || job.kind === 'medical') {
`;

const replacement = `          // Durable jobs execute on server via /api/jobs/submit
          if (job.kind === 'food_log' || job.kind === 'food_compare' || job.kind === 'medical') {
            // Ensure job is submitted to server for retries or new jobs not yet pushed
            if (!job.serverSubmittedAt || job.resumeStage || job.statusMessage?.includes('Retry')) {
              console.log(\`[JobQueueRunner] Submitting job \${job.id} to server...\`);
              let stringImages = [];
              try {
                const { ImageStore } = await import('./jobs/ImageStore');
                const rawImages = (await ImageStore.getImages(job.id)) || [];
                stringImages = await Promise.all(
                  rawImages.map(async (img) => {
                    if (typeof img === 'string') return img;
                    if (img && typeof img === 'object') {
                      const blob = img instanceof Blob ? img : new Blob([img], { type: img.type || 'image/jpeg' });
                      return new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = () => resolve('');
                        reader.readAsDataURL(blob);
                      });
                    }
                    return '';
                  })
                );
              } catch(e) {}
              
              await fetch('/api/jobs/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jobId: job.id,
                  userId: auth.currentUser?.uid || 'anonymous',
                  kind: job.kind,
                  mode: job.mode,
                  text: job.inputSnapshot?.text || '',
                  images: stringImages.filter(Boolean),
                  history: job.messages || [],
                  userProfile: profileRef.current,
                  ...job.inputSnapshot
                })
              });
              JobStore.updateJob(job.id, { serverSubmittedAt: Date.now(), resumeStage: undefined });
            }
`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/App.tsx', code);
  console.log('Patched App.tsx with submit logic');
} else {
  console.log('Target not found in App.tsx');
}
