let lastInputs = [];
let lastResult = null;

function detectFlaggedTelemetryErrorsCached(resolvedBiomarkers, profile, activeHistory, allDefinitions) {
  if (lastInputs[0] === resolvedBiomarkers &&
      lastInputs[1] === profile &&
      lastInputs[2] === activeHistory &&
      lastInputs[3] === allDefinitions) {
    return lastResult;
  }
  lastInputs = [resolvedBiomarkers, profile, activeHistory, allDefinitions];
  console.log("CACHE MISS");
  lastResult = []; // fake result
  return lastResult;
}
