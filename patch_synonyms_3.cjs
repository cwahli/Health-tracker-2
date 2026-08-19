const fs = require('fs');
const content = fs.readFileSync('server_matching_engine.ts', 'utf8');

const search = `'crunchy': ['fresh', 'raw', 'crispy']`;
const replace = `'crunchy': ['fresh', 'raw', 'crispy'],
    'baked': ['homemade', 'readytoeat', 'roasted'],
    'falafel': ['homemade'],
    'mayonnaise': ['regular', 'dressing', 'sauce'],
    'garlic': ['mayonnaise', 'sauce'],
    'boiled': ['hardboiled', 'softboiled', 'cooked'],
    'hard': ['hardboiled', 'cooked'],
    'egg': ['hardboiled', 'cooked', 'whole'],
    'breast': ['meat', 'only', 'cooked', 'roasted'],
    'grilled': ['roasted', 'cooked', 'broilers', 'fryers']`;

fs.writeFileSync('server_matching_engine.ts', content.replace(search, replace));
