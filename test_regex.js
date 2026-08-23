const labelItem = { originalName: "Quorn Sweet Chilli Mini Fillets Nutrition Facts Label" };
const primaryItem = { originalName: "Quorn Sweet Chilli Mini Fillets" };
const cleanLabel = (labelItem.originalName || labelItem.keyword || "").toLowerCase().replace(/nutrition\s*facts?\s*label|nutrition\s*label/g, '').replace(/[^a-z0-9]/g, '');
const cleanTarget = (primaryItem.originalName || primaryItem.keyword || "").toLowerCase().replace(/[^a-z0-9]/g, '');
console.log(cleanLabel === cleanTarget);
console.log(cleanLabel, cleanTarget);
