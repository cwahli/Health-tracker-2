export async function pushTranslationsToSheets(keys: Record<string, string>) {
  console.log("Pushing translations to Google Sheets");
  return true;
}

export async function pullTranslationsFromSheets() {
  console.log("Pulling translations from Google Sheets");
  return { "en": { "hello": "world" } };
}
