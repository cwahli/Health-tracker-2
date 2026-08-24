const regex = /\b(burgers?|sandwich(es)?|buns?|rolls?|wraps?|pies?|nuggets?|pizzas?|dumplings?|patties|patty|tacos?|burritos?|noodles?|rice|soup|fried|batter|breaded|bowls?|poke|salad|salads|combos?|meals?|platters?|boxes?|bentos?|currys?|curries|stews?|casseroles?|pastas?|spaghetti|macaroni|risotto|paella|teriyaki|stir-?fry|mix|mixed|dish|dishes|entrees?|compounds?|sets?|surimi|with|and)\b/i;

const str1 = "beef steak with fries and gravy";
const str2 = "chicken and rice";
const str3 = "chicken";

console.log(regex.test(str1)); // should be true
console.log(regex.test(str2)); // should be true
console.log(regex.test(str3)); // should be false
