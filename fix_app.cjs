const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Add useRef
if (!code.includes('const hasRunImageCompression = useRef(false);')) {
  code = code.replace(
    'const [profile, setProfile] = useState<UserProfile | null>(null);',
    'const [profile, setProfile] = useState<UserProfile | null>(null);\n  const hasRunImageCompression = useRef(false);'
  );
}

// 2. Wrap the compression
const compBlockStart = `              if (v2Foods.length > 0) {
                const imagesSnap = await getDocs(collection(db, 'users', uid, 'foodImages'));`;

const compBlockRepl = `              if (v2Foods.length > 0) {
                const imagesSnap = await getDocs(collection(db, 'users', uid, 'foodImages'));
                const shouldCompress = !hasRunImageCompression.current;
                if (shouldCompress) hasRunImageCompression.current = true;`;

code = code.replace(compBlockStart, compBlockRepl);

const updateBlock = `if (imageUrl && imageUrl.startsWith('data:image/') && imageUrl.length > 25000) {`;
const updateBlockRepl = `if (shouldCompress && imageUrl && imageUrl.startsWith('data:image/') && imageUrl.length > 25000) {`;

code = code.replace(updateBlock, updateBlockRepl);

const updateListBlock = `if (url && url.startsWith('data:image/') && url.length > 25000) {`;
const updateListBlockRepl = `if (shouldCompress && url && url.startsWith('data:image/') && url.length > 25000) {`;
code = code.replace(updateListBlock, updateListBlockRepl);

// 3. Fix isValidValue
const validValStr = `const isValidValue = (v) => v !== null && v !== undefined && v !== '';`;
const validValRepl = `const isValidValue = (v: unknown): boolean => v !== null && v !== undefined && v !== '';`;
code = code.replace(validValStr, validValRepl);

fs.writeFileSync('src/App.tsx', code);
