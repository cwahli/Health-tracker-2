import { runGeneralizedBiomarkerAudit } from '../src/utils/biomarkerAuditEngine';

const customBiomarkers = {
  "egfr": {
    "key": "egfr",
    "name": "eGFR",
    "unit": "mL/min/1.73m2",
    "status": "Optimal"
  },
  "egfr_non_afr_am_ml_min_1_73m2": {
    "key": "egfr_non_afr_am_ml_min_1_73m2",
    "name": "eGFR Non-Afr. Am.",
    "unit": "mL/min/1.73m2",
    "status": "Optimal"
  },
  "egfr_ml_min_1_73m2": {
    "key": "egfr_ml_min_1_73m2",
    "name": "eGFR",
    "unit": "mL/min/1.73m2",
    "status": "Optimal"
  }
};

const report = runGeneralizedBiomarkerAudit(customBiomarkers, [], customBiomarkers);
console.log(JSON.stringify(report.duplicateGroups, null, 2));
