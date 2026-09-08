export function sendLog(type: string, stage: string, message: string, data?: any) {
  const ts = new Date().toISOString();
  console.log(`[${ts}][${stage}][${type}] ${message}`);
  // Add logic here to broadcast or persist if needed
}

export function addDebugLog(msg: string) {
  const ts = new Date().toISOString();
  console.log(`[${ts}][debug] ${msg}`);
}
