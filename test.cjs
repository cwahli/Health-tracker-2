const http = require('http');
const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/gemini/food-analyze',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
}, res => {
  let body = '';
  res.on('data', d => {
    const lines = d.toString().split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.substring(6).trim();
        if (jsonStr === '[DONE]') break;
        try {
            const data = JSON.parse(jsonStr);
            if (data.type === 'final_response' || data.type === 'status' || data.type === 'final_meal') {
                console.log(JSON.stringify(data, null, 2));
            }
        } catch (e) {}
      }
    }
  });
});
req.write(JSON.stringify({ transcription: 'I ate a crispy chicken wrap', capturedImage: null }));
req.end();
