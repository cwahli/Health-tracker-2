const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) { console.error('No credentials'); process.exit(1); }
const supabase = createClient(supabaseUrl, supabaseKey);
async function test() {
  const { data, error } = await supabase.from('food_logs').select('verdict, description, message, debug_url, chat_transcript').limit(1);
  if (error) { console.error('Error:', error.message); }
  else { console.log('Columns exist, rows returned:', data.length); }
}
test();
