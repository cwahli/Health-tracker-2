const fs = require('fs');
const content = fs.readFileSync('server_matching_engine.ts', 'utf8');

const search = `  const isTokenMatch = (t1: string, t2: string) => {`;
const replace = `  const SYNONYMS: Record<string, string[]> = {
    'wrap': ['tortilla', 'bread', 'pita', 'flatbread'],
    'tender': ['breast', 'chicken', 'nugget', 'strip'],
    'tenders': ['breast', 'chicken', 'nugget', 'strip'],
    'strip': ['breast', 'chicken', 'tender', 'nugget'],
    'strips': ['breast', 'chicken', 'tender', 'nugget'],
    'greens': ['lettuce', 'salad', 'spinach', 'kale'],
    'salad': ['lettuce', 'greens', 'spinach', 'kale']
  };

  const isTokenMatch = (t1: string, t2: string) => {
    const s1 = t1.toLowerCase();
    const s2 = t2.toLowerCase();
    if (s1 === s2) return true;
    if (s1 + 's' === s2 || s2 + 's' === s1) return true;
    if (s1 + 'es' === s2 || s2 + 'es' === s1) return true;
    if (s1.length >= 4 && s2.length >= 4 && s1.slice(0, 4) === s2.slice(0, 4)) return true;
    
    // Check structural synonyms
    if (SYNONYMS[s2] && SYNONYMS[s2].some(syn => s1 === syn || s1 + 's' === syn || syn + 's' === s1 || (s1.length >= 4 && syn.length >= 4 && s1.slice(0, 4) === syn.slice(0, 4)))) return true;
    if (SYNONYMS[s1] && SYNONYMS[s1].some(syn => s2 === syn || s2 + 's' === syn || syn + 's' === s2 || (s2.length >= 4 && syn.length >= 4 && s2.slice(0, 4) === syn.slice(0, 4)))) return true;

    return false;
  };`;

fs.writeFileSync('server_matching_engine.ts', content.replace(search, replace));
