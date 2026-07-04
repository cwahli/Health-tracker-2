sed -i 's/(parsed.key || biomarkerName).toLowerCase()/String(parsed.key || biomarkerName).toLowerCase()/g' src/components/AgentResultTable.tsx
sed -i 's/biomarkerName.toLowerCase()/String(biomarkerName).toLowerCase()/g' src/components/AgentResultTable.tsx
sed -i 's/bioName.toLowerCase()/String(bioName).toLowerCase()/g' src/components/AgentResultTable.tsx
sed -i 's/(b.name || '\'''\'').toLowerCase()/String(b.name || '\'''\'').toLowerCase()/g' src/components/AgentResultTable.tsx
sed -i 's/(b.key || '\'''\'').toLowerCase()/String(b.key || '\'''\'').toLowerCase()/g' src/components/AgentResultTable.tsx
sed -i 's/initName.toLowerCase()/String(initName).toLowerCase()/g' src/components/AgentResultTable.tsx
sed -i 's/(row.biomarker || '\'''\'').toLowerCase()/String(row.biomarker || '\'''\'').toLowerCase()/g' src/components/AgentResultTable.tsx
sed -i 's/(row.oldName || '\'''\'').toLowerCase()/String(row.oldName || '\'''\'').toLowerCase()/g' src/components/AgentResultTable.tsx
