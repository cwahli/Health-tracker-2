const matchChain = 'mr_oat';
const cQuery = 'mr oat rolled oats';
console.log(cQuery.includes(matchChain));
console.log(cQuery.includes(matchChain.replace(/_/g, ' ')));
