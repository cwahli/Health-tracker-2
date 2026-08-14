const itemA = { servingSize: "1 item", calories: "453 kcal" };
const itemB = { servingSize: null, calories: "453 kcal" };
console.log({ ...itemA, ...itemB });
