import { getAuth } from 'firebase-admin/auth';

export async function verifyFirebaseIdToken(req: any): Promise<{ uid: string; email?: string }> {
  const host = req.headers?.host || '';
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1') || process.env.NODE_ENV !== 'production' || process.env.ALLOW_UNAUTH_SYNC === '1';

  const h = req.headers?.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) {
    if (isLocalhost) {
      if (req.body && (req.body.uid || req.body.email || req.body.payload?.user_id)) {
        return { 
          uid: req.body.uid || req.body.payload?.user_id || 'guest', 
          email: req.body.email || req.body.userEmail || '' 
        };
      }
    }
    const err: any = new Error('Missing Authorization Bearer token');
    err.status = 401;
    throw err;
  }
  try {
    const decoded = await getAuth().verifyIdToken(token);
    console.log('[FreeTier] requireAuth');
    return { uid: decoded.uid, email: decoded.email };
  } catch (authErr) {
    if (isLocalhost) {
      console.warn('[FreeTier] Localhost Firebase token verification fallback');
      return { 
        uid: req.body?.uid || req.body?.payload?.user_id || 'localhost_user', 
        email: req.body?.email || req.body?.userEmail || '' 
      };
    }
    throw authErr;
  }
}
