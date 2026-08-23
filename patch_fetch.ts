import fs from 'fs';

let content = fs.readFileSync('server.ts', 'utf-8');

const oldFetchFn = `export async function fetchUSDAFoodById(fdcId: string, retryCount = 1): Promise<any | null> {
  try {
    const usdaApiKey = process.env.USDA_API_KEY || "DEMO_KEY";
    const url = \`https://api.nal.usda.gov/fdc/v1/food/\${fdcId}?api_key=\${usdaApiKey}\`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, { signal: controller.signal as any });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) return null;
    return await response.json();
  } catch (err) {
    console.error(\`[fetchUSDAFoodById] Error fetching FDC ID \${fdcId}:\`, err);
    return null;
  }
}`;

const newFetchFn = `export async function fetchUSDAFoodById(fdcId: string, retryCount = 1): Promise<any | null> {
  try {
    const usdaApiKey = process.env.USDA_API_KEY || "DEMO_KEY";
    const url = \`https://api.nal.usda.gov/fdc/v1/food/\${fdcId}?api_key=\${usdaApiKey}\`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, { signal: controller.signal as any });
    clearTimeout(timeout);
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
      if (retryCount > 0) {
        await new Promise(r => setTimeout(r, 1000));
        return await fetchUSDAFoodById(fdcId, retryCount - 1);
      }
      return null;
    }
    return await response.json();
  } catch (err) {
    if (retryCount > 0) {
      await new Promise(r => setTimeout(r, 1000));
      return await fetchUSDAFoodById(fdcId, retryCount - 1);
    }
    console.error(\`[fetchUSDAFoodById] Error fetching FDC ID \${fdcId}:\`, err);
    return null;
  }
}`;

content = content.replace(oldFetchFn, newFetchFn);

const oldSearchFn = `        const response = await fetch(url, { signal: controller.signal as any });
    clearTimeout(timeout);
    
    if (!response.ok) return [];
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) return [];`;

const newSearchFn = `        const response = await fetch(url, { signal: controller.signal as any });
    clearTimeout(timeout);
    
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
      if (!response.ok && response.status === 429) {
        await new Promise(r => setTimeout(r, 2000)); // wait on rate limit
      }
      // Return empty for now, maybe the fallback queries will work
      return [];
    }`;

content = content.replace(oldSearchFn, newSearchFn);
fs.writeFileSync('server.ts', content);
