import { config } from 'dotenv';
config();

async function searchUSDA(query: string, maxResults: number = 5, dataTypes: string = 'Foundation,SR Legacy,Survey (FNDDS),Branded'): Promise<any[]> {
  if (!query) return [];
  const usdaApiKey = process.env.USDA_API_KEY;
  if (!usdaApiKey) {
    console.error('[USDA API] Error: Missing USDA_API_KEY environment variable.');
    return [];
  }
  const fetchSize = Math.max(10, maxResults * 2);
  const dataTypeQuery = dataTypes.split(',').map(d => `dataType=${encodeURIComponent(d)}`).join('&');
  try {
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${usdaApiKey}&query=${encodeURIComponent(query)}&pageSize=${fetchSize}&${dataTypeQuery}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal as any });
    clearTimeout(timeout);
    
    if (!response.ok) return [];
    const data = await response.json();
    let foods = data.foods || [];

    const tokens = query.trim().split(/\s+/).filter(Boolean);
    if (foods.length === 0 && tokens.length > 1) {
      const invertedComma = [...tokens].reverse().join(', ');
      const invertedSpace = [...tokens].reverse().join(' ');
      const altQueries = [invertedComma, invertedSpace];
      for (const altQuery of altQueries) {
        try {
          const altUrl = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${usdaApiKey}&query=${encodeURIComponent(altQuery)}&pageSize=${fetchSize}&${dataTypeQuery}`;
          const altResponse = await fetch(altUrl);
          if (altResponse.ok) {
            const altData = await altResponse.json();
            if (altData.foods && altData.foods.length > 0) {
              foods = altData.foods;
              break;
            }
          }
        } catch (err) {
        }
      }
    }
    
    const qLower = query.toLowerCase().trim();
    const queryHasOil = qLower.includes("oil");
    const queryHasPowder = qLower.includes("powder");

    foods = foods.filter((f: any) => {
      const kcalNutrient = f.foodNutrients?.find((n: any) => n.nutrientName === "Energy" && n.unitName === "kcal");
      const kcal = kcalNutrient ? parseFloat(kcalNutrient.value) : 0;
      const proteinNutrient = f.foodNutrients?.find((n: any) => n.nutrientName === "Protein" && n.unitName === "g");
      const protein = proteinNutrient ? parseFloat(proteinNutrient.value) : 0;
      
      const name = (f.description || "").toLowerCase();
      
      const isExpectedZero = ["water", "tea", "coffee", "vinegar", "mustard", "diet", "zero", "salt", "spices", "herb", "seasoning", "broth", "bouillon", "extract", "flavoring"].some(k => name.includes(k) || qLower.includes(k));
      if (kcal === 0 && protein < 0.5 && !isExpectedZero) return false;
      
      if (!queryHasOil && name.includes("oil")) return false;
      if (!queryHasPowder && (name.includes("powder") || name.includes("mix, dry"))) return false;

      return true;
    });

    foods.sort((a: any, b: any) => {
      const aName = (a.description || "").toLowerCase();
      const bName = (b.description || "").toLowerCase();
      if (aName === qLower && bName !== qLower) return -1;
      if (bName === qLower && aName !== qLower) return 1;
      if (aName === `${qLower}, raw` && bName !== `${qLower}, raw`) return -1;
      if (bName === `${qLower}, raw` && aName !== `${qLower}, raw`) return 1;
      if (aName === `${qLower}s, raw` && bName !== `${qLower}s, raw`) return -1;
      if (bName === `${qLower}s, raw` && aName !== `${qLower}s, raw`) return 1;
      if (aName.startsWith(qLower) && !bName.startsWith(qLower)) return -1;
      if (bName.startsWith(qLower) && !aName.startsWith(qLower)) return 1;
      return aName.length - bName.length;
    });
    
    return foods.slice(0, maxResults);
  } catch (error) {
    console.error("[USDA API] Error:", error);
    return [];
  }
}

(async () => {
  const hits = await searchUSDA('potato raw');
  console.log('hits:', hits.length);
  if (hits.length > 0) {
    console.log(hits.map((h: any) => h.description));
  }
})();
