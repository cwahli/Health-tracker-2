import { buildJourney } from './src/utils/goldenJourney';
import { restageBoardFromCatalog } from './src/utils/bugTapeReview';
import job from './debug4.json';
const journey = buildJourney({ logText: job.backendLogs, foodLog: job.pendingFoodLog, scout: job.scoutItems });
const invariants = restageBoardFromCatalog({ invariants: [] } as any, journey);
console.log(JSON.stringify(invariants, null, 2));
