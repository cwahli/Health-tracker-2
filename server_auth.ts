import { getAuth } from 'firebase-admin/auth';

export async function verifyFirebaseIdToken(req: any): Promise<{ uid: string; email?: string }> {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) {
    if (process.env.ALLOW_UNAUTH_SYNC === '1') {
       if (req.body && req.body.uid) {
           return { uid: req.body.uid, email: req.body.email || req.body.userEmail || '' };
       }
    }
    const err: any = new Error('Missing Authorization Bearer token');
    err.status = 401;
    throw err;
  }
  const decoded = await getAuth().verifyIdToken(token);
  console.log('[FreeTier] requireAuth');
  return { uid: decoded.uid, email: decoded.email };
}
