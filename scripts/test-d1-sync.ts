import 'dotenv/config';
import {
  d1UpsertFoods,
  d1DeleteFoods,
  d1UpsertBiomarkers,
  d1DeleteBiomarkers,
  d1GetProfile,
  d1UpsertProfile,
  d1PullSync,
  d1UpsertJob,
  d1GetJob,
  d1UpdateJob,
  d1ListJobs,
  d1DeleteJob
} from '../server_db_d1.js';

async function testSync() {
  console.log('=== Testing D1 Sync Operations ===');
  const testUid = 'test_user_' + Date.now();
  const testFoodId = 'food_test_' + Date.now();
  const testBioId = 'bio_test_' + Date.now();
  const testJobId = 'job_test_' + Date.now();

  // 1. Upsert Food
  console.log('1. Testing d1UpsertFoods...');
  const foodRes = await d1UpsertFoods([{
    id: testFoodId,
    firebase_uid: testUid,
    date: '2026-09-10',
    name: 'Grilled Salmon Bowl',
    calories: 450,
    protein: 38,
    nutrients: { calories: 450, protein: 38, carbs: 20 },
    items_breakdown: [{ name: 'Salmon', grams: 150 }],
    image_urls: ['https://r2.example.com/salmon.jpg']
  } as any]);
  console.log('Food upsert result:', foodRes);
  if (!foodRes.success) throw new Error('Food upsert failed');

  // 2. Upsert Biomarker
  console.log('2. Testing d1UpsertBiomarkers...');
  const bioRes = await d1UpsertBiomarkers([{
    id: testBioId,
    firebase_uid: testUid,
    date: '2026-09-10',
    biomarkers: { hba1c: 5.4, fasting_glucose: 90 },
    note: 'Routine test',
    tests: ['Metabolic Panel']
  }]);
  console.log('Bio upsert result:', bioRes);
  if (!bioRes.success) throw new Error('Bio upsert failed');

  // 3. Upsert & Get Profile
  console.log('3. Testing d1UpsertProfile and d1GetProfile...');
  const profRes = await d1UpsertProfile(testUid, {
    profile: { nickname: 'Tester', targets: { calories: 2000 } },
    actions: [{ id: 'a1', title: 'Walk 10k steps' }]
  });
  console.log('Profile upsert result:', profRes);
  if (!profRes.success) throw new Error('Profile upsert failed');

  const fetchedProf = await d1GetProfile(testUid);
  console.log('Fetched profile nickname:', fetchedProf?.data?.profile?.nickname);
  if (fetchedProf?.data?.profile?.nickname !== 'Tester') throw new Error('Profile mismatch');

  // 4. Test Pull Sync
  console.log('4. Testing d1PullSync...');
  const pullRes = await d1PullSync({ possibleUids: [testUid], listOnly: false });
  console.log(`Pull returned: ${pullRes.foods.length} foods, ${pullRes.biomarkers.length} biomarkers, ${pullRes.profiles.length} profiles`);
  if (pullRes.foods.length !== 1 || pullRes.foods[0].id !== testFoodId) throw new Error('Pull foods mismatch');
  if (pullRes.biomarkers.length !== 1 || pullRes.biomarkers[0].id !== testBioId) throw new Error('Pull bio mismatch');
  console.log('Food parsed nutrients:', pullRes.foods[0].nutrients);
  console.log('Bio parsed markers:', pullRes.biomarkers[0].biomarkers);

  // 5. Test Agent Job Lifecycle
  console.log('5. Testing Job lifecycle (upsert, update, list, delete)...');
  const jobUpsert = await d1UpsertJob({
    id: testJobId,
    user_id: testUid,
    kind: 'food',
    mode: 'review',
    status: 'running',
    progress_percent: 25,
    status_message: 'Analyzing plate...'
  });
  console.log('Job upsert result:', jobUpsert);
  if (!jobUpsert.success) throw new Error('Job upsert failed');

  await d1UpdateJob(testJobId, {
    status: 'succeeded',
    progress_percent: 100,
    clean_result: { is_r2: true, message: 'Meal logged successfully' }
  });

  const job = await d1GetJob(testJobId);
  console.log('Fetched job status:', job?.status, 'clean_result:', job?.clean_result);
  if (job?.status !== 'succeeded' || !job?.clean_result?.is_r2) throw new Error('Job update mismatch');

  const jobList = await d1ListJobs({ userId: testUid, isFull: true });
  console.log('List jobs count:', jobList.length);
  if (jobList.length !== 1) throw new Error('Job list mismatch');

  // 6. Cleanup
  console.log('6. Cleaning up test rows...');
  await d1DeleteFoods([testFoodId]);
  await d1DeleteBiomarkers([testBioId]);
  await d1DeleteJob(testJobId);
  const verifyPull = await d1PullSync({ possibleUids: [testUid] });
  console.log(`Post-cleanup pull: ${verifyPull.foods.length} foods, ${verifyPull.biomarkers.length} biomarkers`);
  if (verifyPull.foods.length !== 0 || verifyPull.biomarkers.length !== 0) throw new Error('Cleanup failed');

  console.log('=== All D1 Sync Operations Verified Successfully! ===');
}

testSync().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
