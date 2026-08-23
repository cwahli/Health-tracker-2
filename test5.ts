import { executeFoodResolverCurator } from './server_food_resolver_curator.ts';
async function test() {
   const mockLLM = async (prompt: string, s: any) => JSON.stringify({
      actions: [
        {
          type: 'pick_existing',
          query: 'soybean oil',
          parametricFdcId: '172370',
          parametricFoodName: 'soybean oil',
          confidence: 'high',
          reason: 'test'
        }
      ]
   });
   
   const fetchFn = async (id: string) => {
     return { title: "Oil, vegetable, soybean, refined", nutrients: { calories: 884, totalFat: 100 } };
   };
   
   const gaps = [
     {
       query: 'soybean oil',
       candidates: []
     }
   ];
   
   const res = await executeFoodResolverCurator(gaps, console.log, mockLLM as any, fetchFn as any, async () => [], fetchFn as any);
   console.log("RESULT", JSON.stringify(res, null, 2));
}

test();
