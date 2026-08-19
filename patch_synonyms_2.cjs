const fs = require('fs');
const content = fs.readFileSync('server_matching_engine.ts', 'utf8');

const search = `'salad': ['lettuce', 'greens', 'spinach', 'kale']`;
const replace = `'salad': ['lettuce', 'greens', 'spinach', 'kale'],
    'marinade': ['sauce', 'dressing', 'glaze'],
    'crispy': ['fresh', 'raw', 'crunchy'],
    'crunchy': ['fresh', 'raw', 'crispy']`;

fs.writeFileSync('server_matching_engine.ts', content.replace(search, replace));
