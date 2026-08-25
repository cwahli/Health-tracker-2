const fs = require('fs');
let content = fs.readFileSync('vite.config.ts', 'utf8');
if (!content.includes('chunkSizeWarningLimit')) {
  content = content.replace('export default defineConfig({', "export default defineConfig({\n  build: { chunkSizeWarningLimit: 2000, rollupOptions: { maxParallelFileOps: 2 } },");
  fs.writeFileSync('vite.config.ts', content);
}
