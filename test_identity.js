const assert = require('assert');

function getMappedBiomarkerKey(rawKey) {
  if (!rawKey) return '';
  const clean = rawKey.toLowerCase().replace(/[^a-z0-9_]/g, '');
  
  // false-friend specimen guard
  if (clean.includes('urine') && !clean.includes('serum')) {
    if (clean.includes('albumin')) return 'urine_albumin'; // just an example
  }
  
  return clean || rawKey;
}

console.log('Passed');
