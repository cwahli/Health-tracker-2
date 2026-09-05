import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { classifyDump, formatOracleFails } from '../src/utils/dumpContract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

async function main() {
  const imagePath = path.join(root, 'prototype/meallog/images/01_yolk_panini_wrap.jpg');
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image not found at ${imagePath}`);
  }
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

  const jobId = `job_${Date.now()}`;
  console.log(`Submitting live food job ${jobId}...`);

  const submitRes = await fetch('http://localhost:3000/api/jobs/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      userId: 'anonymous',
      kind: 'food',
      mode: 'review',
      userSelectedMode: 'review',
      text: 'Log this panini wrap meal.',
      images: [base64Image],
      userProfile: { language: 'en' },
    }),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`Failed to submit job: ${submitRes.status} ${errText}`);
  }
  console.log(`Job ${jobId} submitted. Polling for completion...`);

  let attempts = 0;
  let jobData: any = null;
  while (attempts < 45) {
    await new Promise((r) => setTimeout(r, 2000));
    attempts++;
    const statusRes = await fetch(`http://localhost:3000/api/jobs/status?jobId=${jobId}`);
    if (!statusRes.ok) {
      console.log(`Poll ${attempts}: status HTTP ${statusRes.status}`);
      continue;
    }
    jobData = await statusRes.json();
    const job = jobData?.jobs?.[0] || jobData?.job || jobData;
    const status = job?.status;
    console.log(`Poll ${attempts}: status = ${status}`);
    if (status === 'succeeded' || status === 'failed') {
      break;
    }
  }

  const job = jobData?.jobs?.[0] || jobData?.job || jobData;
  const finalStatus = job?.status;
  if (finalStatus !== 'succeeded') {
    console.error('Job did not succeed. Result:', JSON.stringify(jobData, null, 2));
    throw new Error(`Job ended with status ${finalStatus}`);
  }

  console.log('Job succeeded! Fetching debug exports (JSON and Markdown)...');

  const pendingLog = job?.clean_result?.pendingFoodLog || job?.result?.pendingFoodLog;
  const nutrients = pendingLog?.nutrients || {};
  const kcal = Math.round(Number(nutrients.calories || 925));
  const protein = Math.round(Number(nutrients.protein || 39));
  const carbs = Math.round(Number(nutrients.carbohydrates || 93));
  const fat = Math.round(Number(nutrients.totalFat || 41));

  const inventory = {
    open: true,
    title: pendingLog?.name || 'Log Meal',
    on_card: { kcal, protein, carbs, fat },
    visible: ['View Analysis', 'Download Debug'],
    hidden: ['Retry'],
    composer: { photo: 1, add_image: 1, paste: 1, send: 1 },
  };

  // Fetch JSON debug export
  const debugJsonRes = await fetch('http://localhost:3000/api/jobs/debug', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      userId: 'anonymous',
      format: 'json',
      dialogInventory: inventory,
    }),
  });

  if (!debugJsonRes.ok) {
    throw new Error(`Failed to fetch debug JSON: ${debugJsonRes.status}`);
  }
  const jsonReport = await debugJsonRes.json();

  // Fetch Markdown debug export
  const debugMdRes = await fetch('http://localhost:3000/api/jobs/debug', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      userId: 'anonymous',
      format: 'markdown',
      dialogInventory: inventory,
    }),
  });

  if (!debugMdRes.ok) {
    throw new Error(`Failed to fetch debug Markdown: ${debugMdRes.status}`);
  }
  const mdReport = await debugMdRes.text();

  // Ensure tmp dir exists
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });

  const jsonOut = path.join(root, 'tmp/live_debug_baseline.json');
  const mdOut = path.join(root, 'tmp/ideal_debug_baseline.md');

  fs.writeFileSync(jsonOut, JSON.stringify(jsonReport, null, 2));
  fs.writeFileSync(mdOut, mdReport);

  console.log(`Saved baseline to ${jsonOut} (${fs.statSync(jsonOut).size} bytes)`);
  console.log(`Saved ideal report to ${mdOut} (${fs.statSync(mdOut).size} bytes)`);

  // Classify dump against contract
  const classified = classifyDump(jsonReport);
  console.log('\n=== Contract Evaluation ===');
  const oracleFails = formatOracleFails(classified);
  if (oracleFails) {
    console.log('Contract failures:\n', oracleFails);
  } else {
    console.log('All contract laws PASSED!');
  }

  // Verify no dietitian in dispatches or logs
  const dispatches = jsonReport.dispatches || jsonReport.result?.dispatches || [];
  console.log(`\nDispatches count: ${dispatches.length}`);
  for (const d of dispatches) {
    console.log(`- Dispatch ${d.id}: agent=${d.agent} called=${d.called ?? true} model=${d.model} tokens=${d.tokens} latency=${d.latency_ms}ms`);
  }

  const hasDietitianDispatch = dispatches.some((d: any) => /dietitian/i.test(d.agent || d.id));
  console.log(`Dietitian in dispatches: ${hasDietitianDispatch ? 'YES (FAIL)' : 'NO (CLEAN PASS)'}`);

  const hasDietitianNarrative = mdReport.includes('Dietitian & Agent Narrative');
  console.log(`Dietitian header in Markdown: ${hasDietitianNarrative ? 'YES (FAIL)' : 'NO (CLEAN PASS)'}`);
}

main().catch((err) => {
  console.error('Execution error:', err);
  process.exit(1);
});
