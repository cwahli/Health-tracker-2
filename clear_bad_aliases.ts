import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!url || !key) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(url, key);

async function run() {
  // We want to delete bad aliases for butter croissant and mac and cheese
  const { data: aliases, error } = await supabase.from('food_aliases').select('*').in('alias_key', ['butter croissant', 'mac & cheese', 'mac and cheese', 'croissant', 'butter', 'unsalted butter', 'whipped butter']);
  
  if (error) {
    console.error('Error fetching aliases:', error);
  } else {
    console.log('Found aliases:', aliases);
    if (aliases && aliases.length > 0) {
      const keys = aliases.map(a => a.alias_key);
      const { error: delError } = await supabase.from('food_aliases').delete().in('alias_key', keys);
      console.log('Deleted aliases:', keys, delError ? delError : 'Success');
    }
  }
}
run();
