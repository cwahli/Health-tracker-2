import { runGeneralizedBiomarkerAudit } from '../src/utils/biomarkerAuditEngine';

const customBiomarkers = {
  egfr: {
    name: "egfr",
    unit: "mL/min/1.73m2",
    normalRange: "over 90",
    category: "kidneys",
    riskCategories: ["Kidney", "Chronic Kidney Disease"],
    catalogApproved: true
  },
  egfr_mlmin173m2: {
    name: "eGFR",
    unit: "mL/min/1.73m2",
    normalRange: "over 90",
    category: "kidneys",
    riskCategories: ["Kidney"],
    catalogApproved: true
  },
  egfr_ml_min_1_73m2: {
    name: "eGFR",
    unit: "mL/min/1.73m2",
    normalRange: "over 90",
    category: "kidneys",
    riskCategories: ["Kidney"],
    catalogApproved: true
  }
};

const history = [
  {
    date: "2026-08-16",
    biomarkers: {
      egfr: 95
    }
  }
];

const report = runGeneralizedBiomarkerAudit(customBiomarkers as any, history as any);
console.log("Duplicate Groups:", JSON.stringify(report.duplicateGroups.map(g => g.memberKeys), null, 2));
