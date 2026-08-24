const pVal = 100;
const text1 = "51g of protein";
const text2 = "51g of quality protein";
const regex = /\b[\d,]+(\.\d+)?\s*g\s*(of\s*)?((lean|high-quality|quality|essential|plant-based|clean|complete|solid|good)\s+)?protein\b/gi;

console.log(text1.replace(regex, `${pVal}g of $3protein`));
console.log(text2.replace(regex, `${pVal}g of $3protein`));
