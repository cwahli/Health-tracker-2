import 'dotenv/config';
import express from 'express';
import { syncRouter } from '../server_routes_sync.js';
import { jobsRouter } from '../server_routes_jobs.js';
import http from 'http';

async function testExpressRoutes() {
  console.log('=== Testing Express Routes with D1 backend ===');
  const app = express();
  app.use(express.json());
  app.use(syncRouter);
  app.use(jobsRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`Test server listening on ${baseUrl}`);

  try {
    const testUid = 'express_user_' + Date.now();
    const testFoodId = 'express_food_' + Date.now();
    const testBioId = 'express_bio_' + Date.now();
    const testJobId = 'express_job_' + Date.now();

    // 1. POST /api/sync/supabase-push
    console.log('1. Testing POST /api/sync/supabase-push...');
    const pushRes = await fetch(`${baseUrl}/api/sync/supabase-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: testUid,
        foods: [{
          id: testFoodId,
          date: '2026-09-10',
          name: 'Express Salmon',
          calories: 500,
          nutrients: { calories: 500 },
          itemsBreakdown: [{ name: 'Salmon' }]
        }],
        biomarkers: [{
          id: testBioId,
          date: '2026-09-10',
          biomarkers: { ldl: 110 }
        }],
        profile: {
          nickname: 'ExpressTester',
          targets: { calories: 2200 }
        }
      })
    });
    const pushJson: any = await pushRes.json();
    console.log('Push response:', pushJson);
    if (!pushJson.success) throw new Error('Push failed: ' + JSON.stringify(pushJson));

    // 2. POST /api/sync/supabase-pull
    console.log('2. Testing POST /api/sync/supabase-pull...');
    const pullRes = await fetch(`${baseUrl}/api/sync/supabase-pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: testUid, listOnly: false })
    });
    const pullJson: any = await pullRes.json();
    console.log(`Pull response: foods=${pullJson.foods?.length}, bio=${pullJson.biomarkers?.length}, profileNick=${pullJson.profileData?.profile?.nickname}`);
    if (pullJson.foods?.length !== 1 || pullJson.foods[0].id !== testFoodId) {
      throw new Error('Pull foods mismatch');
    }
    if (pullJson.biomarkers?.length !== 1 || pullJson.biomarkers[0].id !== testBioId) {
      throw new Error('Pull bio mismatch');
    }
    if (pullJson.profileData?.profile?.nickname !== 'ExpressTester') {
      throw new Error('Pull profile mismatch');
    }

    // 3. POST /api/sync/food-log-detail
    console.log('3. Testing POST /api/sync/food-log-detail...');
    const detailRes = await fetch(`${baseUrl}/api/sync/food-log-detail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: testUid, logId: testFoodId })
    });
    const detailJson: any = await detailRes.json();
    console.log('Detail response:', detailJson);
    if (!detailJson.success || !detailJson.detail) throw new Error('Detail fetch failed');

    // 4. POST /api/jobs/upsert
    console.log('4. Testing POST /api/jobs/upsert...');
    const jobUpsertRes = await fetch(`${baseUrl}/api/jobs/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payload: {
          id: testJobId,
          user_id: testUid,
          kind: 'food',
          status: 'running',
          progress_percent: 50,
          status_message: 'Working...'
        }
      })
    });
    const jobUpsertJson: any = await jobUpsertRes.json();
    console.log('Job upsert response:', jobUpsertJson);
    if (!jobUpsertJson.success) throw new Error('Job upsert failed');

    // 5. GET /api/jobs/status
    console.log('5. Testing GET /api/jobs/status...');
    const jobStatusRes = await fetch(`${baseUrl}/api/jobs/status?jobId=${testJobId}&full=true`);
    const jobStatusJson: any = await jobStatusRes.json();
    console.log('Job status response:', jobStatusJson);
    if (!jobStatusJson.jobs || jobStatusJson.jobs.length !== 1 || jobStatusJson.jobs[0].id !== testJobId) {
      throw new Error('Job status fetch failed');
    }

    // 6. Delete cleanup via push delete
    console.log('6. Cleaning up via push delete and /api/jobs/delete...');
    await fetch(`${baseUrl}/api/sync/supabase-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: testUid,
        foods: [{ id: testFoodId, sync_state: 'delete' }],
        biomarkers: [{ id: testBioId, sync_state: 'delete' }]
      })
    });

    await fetch(`${baseUrl}/api/jobs/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: testJobId })
    });

    const verifyPull = await (await fetch(`${baseUrl}/api/sync/supabase-pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: testUid })
    })).json();
    console.log(`Cleaned up pull: foods=${(verifyPull as any).foods?.length}, bio=${(verifyPull as any).biomarkers?.length}`);
    if ((verifyPull as any).foods?.length !== 0 || (verifyPull as any).biomarkers?.length !== 0) {
      throw new Error('Post-test cleanup failed');
    }

    console.log('=== All Express Route Tests Passed Successfully on D1! ===');
    process.exit(0);
  } finally {
    server.close();
  }
}

testExpressRoutes().catch(err => {
  console.error('Express test failed:', err);
  process.exit(1);
});
