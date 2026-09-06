import { searchUSDA } from './server_food_db.ts';

async function main() {
  const q1 = await searchUSDA('donut', 'Foundation,SR Legacy,Survey (FNDDS)');
  console.log('donut:', q1.length);
  const q2 = await searchUSDA('coconut milk', 'Foundation,SR Legacy,Survey (FNDDS)');
  console.log('coconut milk:', q2.length);
  const q3 = await searchUSDA('tomato', 'Foundation,SR Legacy,Survey (FNDDS)');
  console.log('tomato:', q3.length);
}
main();
