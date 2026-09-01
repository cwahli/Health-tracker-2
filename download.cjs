const fs = require('fs');
const https = require('https');
https.get('https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev/debug/job_1788002358464_xwt95qr16.json', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => fs.writeFileSync('debug.json', data));
});
