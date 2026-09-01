import fs from 'fs';

let content = fs.readFileSync('src/jobs/SupabaseJobSync.ts', 'utf-8');

content = content.replace("JobStore.updateJob(row.id, updatePayload);", "JobStore.apply({ type: 'RealtimeRow', id: row.id, ...updatePayload } as any);");
content = content.replace("JobStore.updateJob(row.id, updatedFields);", "JobStore.apply({ type: 'RealtimeRow', id: row.id, ...updatedFields } as any);");

fs.writeFileSync('src/jobs/SupabaseJobSync.ts', content);
