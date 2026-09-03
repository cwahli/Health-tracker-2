import { UserProfile, RecommendationReport } from '../types';
import { t } from './i18n';

export function getLocalFallbackReport(profile: UserProfile | null): RecommendationReport {
  const email = profile?.email?.toLowerCase() || '';
  const lang = profile?.language;
  const isSpecialUser = email === 'chiwah.liu@gmail.com' || email === 'cwah.liu@gmail.com';

  if (isSpecialUser) {
    return {
      timestamp: new Date().toISOString(),
      dailyNutrientTargets: {
        calories: "1,700–1,800 kcal",
        protein: "90–100 g (protects kidneys)",
        totalFat: "55–65 g",
        saturatedFat: "under 15 g (critical for LDL)",
        unsaturatedFat: "35–45 g",
        omega3: "2.5–3 g",
        carbohydrates: "160–185 g (low GI)",
        addedSugar: "under 20 g",
        totalFibre: "35–40 g",
        solubleFibre: "10–15 g (critical for LDL)",
        sodium: "under 1,200 mg (kidney + BP protection)",
        potassium: "3,500–4,000 mg",
        magnesium: "400–420 mg",
        calcium: "1,000 mg",
        iron: "8 mg",
        zinc: "11 mg",
        selenium: "55 mcg",
        iodine: "150 mcg",
        phosphorus: "700 mg",
        vitaminD: "2,000 IU (East Asians commonly deficient)",
        vitaminB12: "2.4 mcg",
        folate: "400 mcg",
        vitaminC: "90 mg",
        vitaminE: "15 mg",
        vitaminK: "120 mcg",
        vitaminA: "900 mcg",
        vitaminB6: "1.7 mg",
        thiamine: "1.2 mg",
        riboflavin: "1.3 mg",
        niacin: "16 mg"
      },
      mostImportantNextStep: "See GP urgently about statin — rosuvastatin 5mg is the evidence-based starting point for East Asian men with your high LDL, HbA1c, and declining kidney filtration.",
      actions: [
        {
          id: "act_1",
          task: t(lang, 'seedFbActionStatinTask'),
          explanation: t(lang, 'seedFbActionStatinExpl'),
          priority: "high",
          completed: false,
          type: "doctor"
        },
        {
          id: "act_2",
          task: t(lang, 'seedFbActionHba1cTask'),
          explanation: t(lang, 'seedFbActionHba1cExpl'),
          priority: "high",
          completed: false,
          type: "test"
        },
        {
          id: "act_3",
          task: t(lang, 'seedFbActionKidneyTask'),
          explanation: t(lang, 'seedFbActionKidneyExpl'),
          priority: "high",
          completed: false,
          type: "test"
        },
        {
          id: "act_4",
          task: t(lang, 'seedFbActionVitDTask'),
          explanation: t(lang, 'seedFbActionVitDExpl'),
          priority: "medium",
          completed: false,
          type: "test"
        },
        {
          id: "act_5",
          task: t(lang, 'seedFbActionOilTask'),
          explanation: t(lang, 'seedFbActionOilExpl'),
          priority: "high",
          completed: false,
          type: "lifestyle"
        }
      ],
      dailyBenefits: [
        { id: "ben_1", activity: t(lang, 'seedFbBenefitWalk'), target: t(lang, 'seedFbTargetWeekly'), completed: false },
        { id: "ben_2", activity: t(lang, 'seedFbBenefitFlax'), target: t(lang, 'seedBenefitTargetDaily'), completed: false },
        { id: "ben_3", activity: t(lang, 'seedFbBenefitSatFat'), target: t(lang, 'seedBenefitTargetDaily'), completed: false },
        { id: "ben_4", activity: t(lang, 'seedFbBenefitFibre'), target: "10-15g soluble", completed: false }
      ],
      latestInsights: [
        {
          title: t(lang, 'seedFbInsightStatinTitle'),
          summary: t(lang, 'seedFbInsightStatinSummary'),
          link: "https://pubmed.ncbi.nlm.nih.gov/32041285/"
        },
        {
          title: t(lang, 'seedFbInsightFibreTitle'),
          summary: t(lang, 'seedFbInsightFibreSummary'),
          link: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4832151/"
        }
      ],
      healthRiskForecast: {
        year5: "Mildly progressive atherosclerosis, risk of transitioning from borderline pre-diabetes to active Type 2 Diabetes, and decline in renal filtration capacity to Stage 3 CKD.",
        year10: "Significant vascular plaque buildup. Kidney function might drop to GFR < 60, triggering high blood pressure. Elevated Risk of cardiovascular events.",
        year20: "40% probability of a coronary event. Accelerated kidney wear requiring complex nephrological intervention.",
        optimized5: "Restored LDL < 100 mg/dL, stabilized blood sugar in normal ranges, and kidney filtration preserved at healthy levels.",
        optimized10: "Plaque progression halted. Fully functional cardiovascular system and kidney values stabilized in the safe green zone.",
        optimized20: "Optimal cardiovascular performance. Healthy aging index score 95th percentile, active longevity with zero diabetic or renal complications."
      },
      topNutrientTargets: ["calories", "solubleFibre", "saturatedFat", "protein", "sodium", "carbohydrates"],
      topWeeklyNutrientTargets: ["vitaminD", "omega3", "magnesium"],
      nutrientRankingRationale: "Focusing on Saturated Fat restriction is your single most important clinical priority, as limiting saturated fats directly halts the overproduction of atherogenic LDL particles and vascular plaque buildup. Pairing this with increased Soluble Fibre binds intestinal cholesterol to accelerate lipid excretion and stabilize glucose spikes, creating a foundational baseline for metabolic stability. Managing overall Caloric intake, Sodium, and Protein provides essential protection for renal filtration (eGFR) and vascular pressure, but these serve as secondary supporting targets. Prioritizing saturated fat reduction and soluble fiber intake delivers the highest overall health leverage, addressing the root driver of cardiovascular risk far more effectively than isolated micronutrient adjustments."
    };
  }

  // Standard generic profile-based fallback
  return {
    timestamp: new Date().toISOString(),
    dailyNutrientTargets: {
      calories: "1,500–1,600 kcal",
      protein: "80–90 g",
      totalFat: "50–60 g",
      saturatedFat: "under 12 g",
      unsaturatedFat: "30–40 g",
      omega3: "2.0–2.5 g",
      carbohydrates: "150–170 g",
      addedSugar: "under 15 g",
      totalFibre: "30–35 g",
      solubleFibre: "8–12 g",
      sodium: "under 1,500 mg",
      potassium: "3,500 mg",
      magnesium: "400 mg",
      calcium: "1,000 mg",
      iron: "8 mg",
      zinc: "11 mg",
      selenium: "55 mcg",
      iodine: "150 mcg",
      phosphorus: "700 mg",
      vitaminD: "2,000 IU",
      vitaminB12: "2.4 mcg",
      folate: "400 mcg",
      vitaminC: "90 mg",
      vitaminE: "15 mg",
      vitaminK: "120 mcg",
      vitaminA: "900 mcg",
      vitaminB6: "1.7 mg",
      thiamine: "1.2 mg",
      riboflavin: "1.3 mg",
      niacin: "16 mg"
    },
    mostImportantNextStep: "Reduce saturated fat strictly to under 12g per day and complete a clinical blood re-test in 3 months to monitor cholesterol and glucose trends.",
    actions: [
      {
        id: "act_1",
        task: t(lang, 'seedFbGenActionScreeningTask'),
        explanation: t(lang, 'seedFbGenActionScreeningExpl'),
        priority: "high",
        completed: false,
        type: "doctor"
      },
      {
        id: "act_2",
        task: t(lang, 'seedFbGenActionHba1cTask'),
        explanation: t(lang, 'seedFbGenActionHba1cExpl'),
        priority: "high",
        completed: false,
        type: "test"
      }
    ],
    dailyBenefits: [
      { id: "ben_1", activity: t(lang, 'seedFbGenBenefitWalk'), target: t(lang, 'seedBenefitTargetDaily'), completed: false },
      { id: "ben_2", activity: t(lang, 'seedFbGenBenefitOil'), target: t(lang, 'seedBenefitTargetDaily'), completed: false }
    ],
    latestInsights: [
      {
        title: t(lang, 'seedFbGenInsightFiberTitle'),
        summary: t(lang, 'seedFbGenInsightFiberSummary'),
        link: "https://pubmed.ncbi.nlm.nih.gov/30612722/"
      }
    ],
    healthRiskForecast: {
      year5: "Slight vascular stiffness and mild risk of elevated glucose tolerance if sedentary habits persist.",
      year10: "Increasing risk of metabolic decline and minor cardiovascular strain.",
      year20: "Elevated probability of cardiovascular plaques and reduced active energy index.",
      optimized5: "Pristine blood pressure levels, balanced lipid particles, and metabolic health completely optimized.",
      optimized10: "Robust vascular health, optimized glycemic control, and ideal weight targets maintained.",
      optimized20: "Healthy aging with minimal chronic disease probability and vibrant metabolic index."
    },
    topNutrientTargets: ["calories", "saturatedFat", "sodium", "protein", "solubleFibre", "carbohydrates"],
    topWeeklyNutrientTargets: ["vitaminD", "omega3", "magnesium"],
    nutrientRankingRationale: "Focusing on Saturated Fat restriction is your single most important clinical priority, as limiting saturated fats directly halts the overproduction of atherogenic LDL particles and vascular plaque buildup. Pairing this with increased Soluble Fibre binds intestinal cholesterol to accelerate lipid excretion and stabilize glucose spikes, creating a foundational baseline for metabolic stability. Managing overall Caloric intake, Sodium, and Protein provides essential protection for renal filtration (eGFR) and vascular pressure, but these serve as secondary supporting targets. Prioritizing saturated fat reduction and soluble fiber intake delivers the highest overall health leverage, addressing the root driver of cardiovascular risk far more effectively than isolated micronutrient adjustments."
  };
}
