const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
console.log('url', supabaseUrl);
const supabase = createClient(supabaseUrl.replace(/\/rest\/v1\/?$/, ''), supabaseKey);
async function test() {
  const { data, error } = await supabase.from('food_logs').select('verdict, description, message, debug_url, chat_transcript').limit(1);
  if (error) { console.error('Error:', error.message); }
  else { console.log('Columns exist, rows returned:', data.length); }
}
test();
