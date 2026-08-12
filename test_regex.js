const str = '{"_internalReasoning": "The user logged a substantial breakfast"}';
const dietMatch = str.match(/"(?:scratchpad|_internalReasoning)"\s*:\s*"([^]*?)("|$)/);
console.log(dietMatch);
