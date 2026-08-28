import fs from 'fs';
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

// 1. Add states
const stateInsert = `
  const [explicitFoodTags, setExplicitFoodTags] = useState<any[]>([]);
  const [catalogMatches, setCatalogMatches] = useState<any[]>([]);
  const [tagPortionPreFill, setTagPortionPreFill] = useState<number>(100);

  useEffect(() => {
    if (type !== 'food' || inputText.trim().length < 3) {
      setCatalogMatches([]);
      return;
    }
    const timer = setTimeout(async () => {
      const regex = /\\b(\\d+(?:\\.\\d+)?)\\s*(g|ml|oz|servings?|portion|pieces?)\\b/i;
      const match = inputText.match(regex);
      if (match) {
        setTagPortionPreFill(parseFloat(match[1]));
      } else {
        setTagPortionPreFill(100);
      }

      const words = inputText.trim().split(/\\s+/);
      const searchTerms = words.slice(Math.max(words.length - 4, 0)).join(' ');
      
      try {
        const res = await fetch(\`/api/food/search?q=\${encodeURIComponent(searchTerms)}\`);
        if (res.ok) {
          const data = await res.json();
          if (data.results && data.results.length > 0 && data.results.length < 4) {
            setCatalogMatches(data.results);
          } else {
            setCatalogMatches([]);
          }
        }
      } catch (err) {
        console.error(err);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [inputText, type]);
`;

code = code.replace("const [inputText, setInputText] = useState('');", "const [inputText, setInputText] = useState('');\n" + stateInsert);

// 2. Modify send payload
const payloadRegex = /const payload\s*=\s*\{[\s\S]*?\};/;
const payloadMatch = code.match(payloadRegex);
if (payloadMatch) {
  const newPayload = payloadMatch[0].replace(/\}\s*?;$/, "  explicitFoodTags\n};");
  code = code.replace(payloadMatch[0], newPayload);
}

fs.writeFileSync('src/components/LogChat.tsx', code);
console.log("Patched states and payload");
