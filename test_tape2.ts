import { config } from 'dotenv';
config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data } = await supabase.from('golden_debug_tapes').select('logText').eq('job_id', 'golden_152aa69b_1787321796149').single();
  if (data) {
    const lines = data.logText.split('\n').filter(l => l.includes('[Reconcile]'));
    console.log("RECONCILE LOGS:");
    console.log(lines.join('\n'));
    const preDiet = data.logText.split('\n').filter(l => l.includes('[Pre-Dietitian'));
    console.log("\nPRE-DIETITIAN:");
    console.log(preDiet.join('\n'));
    const budget = data.logText.split('\n').filter(l => l.includes('[Budget]'));
    console.log("\nBUDGET:");
    console.log(budget.join('\n'));
    const foundation = data.logText.split('\n').filter(l => l.includes('[Foundation]'));
    console.log("\nFOUNDATION:");
    console.log(foundation.join('\n'));
  } else {
    console.log("Not found in db");
  }
}
test();
