const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerExpandedSection.tsx', 'utf8');

const targetContent = `          </div>
        </div>
      </div>

      {/* Collapsible More Details Accordion */}`;

const replacementContent = `          </div>
        </div>
      </div>

      {/* Clinical Risk Tags */
      ((def.riskCategories && def.riskCategories.length > 0) || (def.potentialMedicalConditions && def.potentialMedicalConditions.length > 0)) && (
        <div className="flex flex-wrap gap-1.5 px-1 py-0.5">
          {def.riskCategories && def.riskCategories.length > 0 && def.riskCategories.map((catName: string, i: number) => (
            <span key={\`risk-\${i}\`} className="px-1.5 py-0.5 text-[9px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-md border border-rose-100/60 dark:border-rose-900/40 whitespace-nowrap">
              {catName}
            </span>
          ))}
          {def.potentialMedicalConditions && def.potentialMedicalConditions.length > 0 && def.potentialMedicalConditions.map((cond: string, i: number) => (
            <span key={\`cond-\${i}\`} className="px-1.5 py-0.5 text-[9px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-md border border-amber-100/60 dark:border-amber-900/40 whitespace-nowrap">
              {cond}
            </span>
          ))}
        </div>
      )}

      {/* Collapsible More Details Accordion */}`;

if (code.includes(targetContent)) {
  code = code.replace(targetContent, replacementContent);
  fs.writeFileSync('src/components/BiomarkerExpandedSection.tsx', code);
  console.log('Successfully patched BiomarkerExpandedSection.tsx');
} else {
  console.log('Target content not found. Dump:');
  const lines = code.split('\\n');
  const idx = lines.findIndex(l => l.includes('Collapsible More Details Accordion'));
  if (idx !== -1) {
    console.log(lines.slice(idx - 10, idx + 5).join('\\n'));
  }
}
