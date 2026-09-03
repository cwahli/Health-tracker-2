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
      mostImportantNextStep: t(lang, 'seedFbNext'),
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
        year5: t(lang, 'seedFbFc5'),
        year10: t(lang, 'seedFbFc10'),
        year20: t(lang, 'seedFbFc20'),
        optimized5: t(lang, 'seedFbFcOpt5'),
        optimized10: t(lang, 'seedFbFcOpt10'),
        optimized20: t(lang, 'seedFbFcOpt20')
      },
      topNutrientTargets: ["calories", "solubleFibre", "saturatedFat", "protein", "sodium", "carbohydrates"],
      topWeeklyNutrientTargets: ["vitaminD", "omega3", "magnesium"],
      nutrientRankingRationale: t(lang, 'seedFbRationale')
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
    mostImportantNextStep: t(lang, 'seedFbGenNext'),
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
      year5: t(lang, 'seedFbGenFc5'),
      year10: t(lang, 'seedFbGenFc10'),
      year20: t(lang, 'seedFbGenFc20'),
      optimized5: t(lang, 'seedFbGenFcOpt5'),
      optimized10: t(lang, 'seedFbGenFcOpt10'),
      optimized20: t(lang, 'seedFbGenFcOpt20')
    },
    topNutrientTargets: ["calories", "saturatedFat", "sodium", "protein", "solubleFibre", "carbohydrates"],
    topWeeklyNutrientTargets: ["vitaminD", "omega3", "magnesium"],
    nutrientRankingRationale: t(lang, 'seedFbGenRationale')
  };
}
