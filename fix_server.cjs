const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// 1. Add adminAuth
if (!code.includes('firebase-admin/auth')) {
  const imports = `import * as admin from 'firebase-admin';
if (!admin.apps.length) {
  admin.initializeApp();
}
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
const adminAuth = getAdminAuth();
`;
  code = code.replace('import express from "express";', imports + 'import express from "express";');
}

// 2. add to sync endpoints
const saveStr = `app.post("/api/sync/save", (req, res) => {
  try {`;
const saveRep = `app.post("/api/sync/save", async (req, res) => {
  try {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
      return res.status(401).json({ error: 'Unauthorized: missing token' });
    }
    try {
      const decoded = await adminAuth.verifyIdToken(idToken);
      if (decoded.email?.toLowerCase() !== (req.body.email || '').toLowerCase()) {
        return res.status(403).json({ error: 'Forbidden: email mismatch' });
      }
    } catch (e) {
      return res.status(401).json({ error: 'Unauthorized: invalid token' });
    }`;
code = code.replace(saveStr, saveRep);

const loadStr = `app.post("/api/sync/load", (req, res) => {
  try {`;
const loadRep = `app.post("/api/sync/load", async (req, res) => {
  try {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
      return res.status(401).json({ error: 'Unauthorized: missing token' });
    }
    try {
      const decoded = await adminAuth.verifyIdToken(idToken);
      if (decoded.email?.toLowerCase() !== (req.body.email || '').toLowerCase()) {
        return res.status(403).json({ error: 'Forbidden: email mismatch' });
      }
    } catch (e) {
      return res.status(401).json({ error: 'Unauthorized: invalid token' });
    }`;
code = code.replace(loadStr, loadRep);

// 3. Fix addDebugLog
const log1 = `addDebugLog({ systemInstruction: body.systemInstruction, messages: body.messages });`;
const log1Rep = `addDebugLog({ 
  systemInstruction: body.systemInstruction 
    ? \`[\${body.systemInstruction.length} chars — truncated for log]\` 
    : null, 
  messages: body.messages 
});`;
code = code.replace(log1, log1Rep);

// Need to also find other addDebugLog calls
fs.writeFileSync('server.ts', code);
