const { journeyFromJob } = require('./dist/utils/goldenJourney');
const { restageBoardFromCatalog } = require('./dist/utils/bugTapeReview');
const job = require('./debug4.json');
const journey = journeyFromJob(job);
const invariants = restageBoardFromCatalog({ invariants: [] }, journey);
console.log(JSON.stringify(invariants, null, 2));
