import { UserProfile, FoodLog, BiomarkerLog, RecommendationReport } from '../types';
import { t } from './i18n';

export type DemoProfileType = 'empty' | 'average' | 'complex';

export function getDemoProfile(type: DemoProfileType = 'average'): UserProfile {
  if (type === 'empty') {
    return {
      nickname: 'New User (Demo)',
      photoUrl: '',
      email: 'demo@healthcockpit.com',
      age: '' as any,
      ethnicity: 'Unknown',
      weight: '' as any,
      height: '' as any,
      gender: 'Unknown',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
      language: 'en',
      userType: 'Demo',
      topNutrientsToMonitor: ['calories', 'saturatedFat', 'sodium'],
      agentCredits: {
        totalUsed: 0,
        dailyQuota: 20,
        remaining: 20,
        lastResetTime: new Date().toISOString(),
        grantedCredits: [
          {
            amount: 15,
            expiresAt: new Date(Date.now() + 48 * 3600000).toISOString(),
            grantedAt: new Date().toISOString()
          }
        ],
        modelUsage: {}
      }
    };
  }

  if (type === 'complex') {
    return {
      nickname: 'Arthur (Demo)',
      photoUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=120',
      email: 'demo@healthcockpit.com',
      age: 52,
      ethnicity: 'Hispanic',
      weight: 94,
      height: 175,
      gender: 'Male',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
      language: 'en',
      userType: 'Demo',
      topNutrientsToMonitor: ['calories', 'saturatedFat', 'sodium', 'carbohydrates', 'protein'],
      agentCredits: {
        totalUsed: 5,
        dailyQuota: 20,
        remaining: 15,
        lastResetTime: new Date().toISOString(),
        grantedCredits: [
          {
            amount: 15,
            expiresAt: new Date(Date.now() + 48 * 3600000).toISOString(),
            grantedAt: new Date().toISOString()
          }
        ],
        modelUsage: {
          'gemini-3.5-flash-lite': 5
        }
      }
    };
  }

  // default: average
  return {
    nickname: 'Alex (Demo)',
    photoUrl: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&q=80&w=120',
    email: 'demo@healthcockpit.com',
    age: 28,
    ethnicity: 'Caucasian',
    weight: 74,
    height: 178,
    gender: 'Male',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
    language: 'en',
    userType: 'Demo',
    topNutrientsToMonitor: ['calories', 'saturatedFat', 'sodium'],
    agentCredits: {
      totalUsed: 12,
      dailyQuota: 20,
      remaining: 20,
      lastResetTime: new Date().toISOString(),
      grantedCredits: [
        {
          amount: 15,
          expiresAt: new Date(Date.now() + 48 * 3600000).toISOString(), // 2 days duration
          grantedAt: new Date().toISOString()
        }
      ],
      modelUsage: {
        'gemini-3.5-flash-lite': 12
      }
    }
  };
}

export function getDemoBiomarkerHistory(type: DemoProfileType = 'average'): BiomarkerLog[] {
  if (type === 'empty') {
    return [];
  }

  const dates = [
    new Date(Date.now() - 14 * 24 * 3600000).toISOString().split('T')[0], // 14 days ago
    new Date(Date.now() - 2 * 24 * 3600000).toISOString().split('T')[0]   // 2 days ago
  ];

  if (type === 'complex') {
    return [
      {
        id: 'demo_biomarker_log_complex_1',
        date: dates[0],
        biomarkers: {
          fasting_glucose: 142, // diabetic range
          hba1c: 7.4,          // diabetic range
          total_cholesterol: 245,
          ldl: 165,
          hdl: 36,            // low HDL
          triglycerides: 230,  // high
          egfr: 62,           // CKD Stage 2 threshold
          vitamin_d: 12,      // severe deficiency
          wbc: 7.1,
          hemoglobin: 13.8,
          bmi: 30.7           // Obese
        },
        note: 'Comprehensive lab report - patient presents with chronic fatigue, mild peripheral edema, and uncontrolled hypertension.',
        summary: 'Metabolic panels confirm Type 2 Diabetes (HbA1c 7.4%, Fasting Glucose 142 mg/dL) and severe mixed Hyperlipidemia. Renal filtration (eGFR 62) is close to Stage 3 threshold. Severe hypovitaminosis D (12 ng/mL) requires clinical repletion.',
        tests: [
          { key: 'fasting_glucose', originalTestName: 'Fasting Plasma Glucose', valueNumeric: 142, unit: 'mg/dL' },
          { key: 'hba1c', originalTestName: 'Glycated Hemoglobin HbA1c', valueNumeric: 7.4, unit: '%' },
          { key: 'total_cholesterol', originalTestName: 'Total Serum Cholesterol', valueNumeric: 245, unit: 'mg/dL' },
          { key: 'ldl', originalTestName: 'Low-Density Lipoprotein Cholesterol', valueNumeric: 165, unit: 'mg/dL' },
          { key: 'hdl', originalTestName: 'High-Density Lipoprotein Cholesterol', valueNumeric: 36, unit: 'mg/dL' },
          { key: 'triglycerides', originalTestName: 'Serum Triglycerides', valueNumeric: 230, unit: 'mg/dL' },
          { key: 'vitamin_d', originalTestName: 'Vitamin D, 25-Hydroxy', valueNumeric: 12, unit: 'ng/mL' },
          { key: 'egfr', originalTestName: 'Estimated GFR (CKD-EPI)', valueNumeric: 62, unit: 'mL/min/1.73m²' },
          { key: 'bmi', originalTestName: 'Body Mass Index', valueNumeric: 30.7, unit: 'kg/m²' }
        ]
      },
      {
        id: 'demo_biomarker_log_complex_2',
        date: dates[1],
        biomarkers: {
          fasting_glucose: 131, // improved slightly
          hba1c: 7.1,          // improved slightly
          total_cholesterol: 228,
          ldl: 151,
          hdl: 38,
          triglycerides: 198,
          egfr: 64,           // stabilized
          vitamin_d: 19,      // improving with initial supplementation
          wbc: 6.9,
          hemoglobin: 14.1,
          bmi: 30.2
        },
        note: 'Follow-up consultation. Patient is initiating basic carbohydrate and sodium restriction.',
        summary: 'Renal filtration has stabilized at 64 mL/min. Lipids and glycemic indices demonstrate early, positive micro-trends following dietary adjustments, though patient remains well above optimal metabolic baselines.',
        tests: [
          { key: 'fasting_glucose', originalTestName: 'Fasting Plasma Glucose', valueNumeric: 131, unit: 'mg/dL' },
          { key: 'hba1c', originalTestName: 'Glycated Hemoglobin HbA1c', valueNumeric: 7.1, unit: '%' },
          { key: 'total_cholesterol', originalTestName: 'Total Serum Cholesterol', valueNumeric: 228, unit: 'mg/dL' },
          { key: 'ldl', originalTestName: 'Low-Density Lipoprotein Cholesterol', valueNumeric: 151, unit: 'mg/dL' },
          { key: 'hdl', originalTestName: 'High-Density Lipoprotein Cholesterol', valueNumeric: 38, unit: 'mg/dL' },
          { key: 'triglycerides', originalTestName: 'Serum Triglycerides', valueNumeric: 198, unit: 'mg/dL' },
          { key: 'vitamin_d', originalTestName: 'Vitamin D, 25-Hydroxy', valueNumeric: 19, unit: 'ng/mL' },
          { key: 'egfr', originalTestName: 'Estimated GFR (CKD-EPI)', valueNumeric: 64, unit: 'mL/min/1.73m²' },
          { key: 'bmi', originalTestName: 'Body Mass Index', valueNumeric: 30.2, unit: 'kg/m²' }
        ]
      }
    ];
  }

  // default: average
  return [
    {
      id: 'demo_biomarker_log_1',
      date: dates[0],
      biomarkers: {
        fasting_glucose: 94,
        hba1c: 5.4,
        total_cholesterol: 215,
        ldl: 138,
        hdl: 45,
        triglycerides: 165,
        egfr: 92,
        vitamin_d: 17, // low
        wbc: 6.4,
        hemoglobin: 14.8,
        bmi: 23.4
      },
      note: 'Baseline lab results from initial health checkout.',
      summary: 'Metabolic markers are stable except for moderate hyperlipidemia (LDL/Triglycerides slightly above optimum) and a distinct Vitamin D deficiency.',
      tests: [
        { key: 'fasting_glucose', originalTestName: 'Fasting Plasma Glucose', valueNumeric: 94, unit: 'mg/dL' },
        { key: 'hba1c', originalTestName: 'Glycated Hemoglobin HbA1c', valueNumeric: 5.4, unit: '%' },
        { key: 'total_cholesterol', originalTestName: 'Total Serum Cholesterol', valueNumeric: 215, unit: 'mg/dL' },
        { key: 'ldl', originalTestName: 'Low-Density Lipoprotein Cholesterol', valueNumeric: 138, unit: 'mg/dL' },
        { key: 'triglycerides', originalTestName: 'Serum Triglycerides', valueNumeric: 165, unit: 'mg/dL' },
        { key: 'vitamin_d', originalTestName: 'Vitamin D, 25-Hydroxy', valueNumeric: 17, unit: 'ng/mL' },
        { key: 'egfr', originalTestName: 'Estimated GFR (CKD-EPI)', valueNumeric: 92, unit: 'mL/min/1.73m²' }
      ]
    },
    {
      id: 'demo_biomarker_log_2',
      date: dates[1],
      biomarkers: {
        fasting_glucose: 91,
        hba1c: 5.3,
        total_cholesterol: 208, // minor improvement after nutrition adjustments
        ldl: 132,
        hdl: 46,
        triglycerides: 155,
        egfr: 94,
        vitamin_d: 22, // improving slightly with supplements
        wbc: 6.2,
        hemoglobin: 14.6,
        bmi: 23.4
      },
      note: 'Follow-up tracking following nutritional and active routine modifications.',
      summary: 'Lipids are showing early signs of positive response to dietary fiber. Vitamin D has begun trending upward due to targeted supplements.',
      tests: [
        { key: 'fasting_glucose', originalTestName: 'Fasting Plasma Glucose', valueNumeric: 91, unit: 'mg/dL' },
        { key: 'total_cholesterol', originalTestName: 'Total Serum Cholesterol', valueNumeric: 208, unit: 'mg/dL' },
        { key: 'ldl', originalTestName: 'Low-Density Lipoprotein Cholesterol', valueNumeric: 132, unit: 'mg/dL' },
        { key: 'triglycerides', originalTestName: 'Serum Triglycerides', valueNumeric: 155, unit: 'mg/dL' },
        { key: 'vitamin_d', originalTestName: 'Vitamin D, 25-Hydroxy', valueNumeric: 22, unit: 'ng/mL' }
      ]
    }
  ];
}

export function getDemoFoodLogs(type: DemoProfileType = 'average'): FoodLog[] {
  if (type === 'empty') {
    return [];
  }

  const dates = [
    new Date(Date.now() - 1 * 24 * 3600000).toISOString().split('T')[0], // yesterday
    new Date().toISOString().split('T')[0] // today
  ];

  if (type === 'complex') {
    return [
      {
        id: 'demo_food_log_complex_1',
        date: dates[0],
        name: '4 Glazed Donuts & Sweet Vanilla Latte',
        composition: '4 medium yeast donuts with white sugary glaze, 16oz full milk cafe latte sweetened with 4 pumps vanilla simple syrup.',
        weightGrams: 360,
        quantity: '1 heavy breakfast',
        benefits: 'Provides immediate high caloric energy.',
        risks: 'Massive simple carbohydrate/added sugar overload, extremely high glycemic index. Floods bloodstream with glucose, causing severe insulin spike.',
        healthImpact: 'Critical negative impact. Severely compromises glycemic control (exacerbating Arthur\'s diabetic HbA1c of 7.1%) and contributes to weight gain.',
        recommendation: 'bad',
        nutrients: {
          calories: 980,
          protein: 14,
          totalFat: 38,
          saturatedFat: 16,
          unsaturatedFat: 22,
          omega3: 0.1,
          carbohydrates: 145, // huge glycemic load
          addedSugar: 68,     // dangerous sugar dose
          totalFibre: 1.5,
          solubleFibre: 0.2,
          sodium: 780,
          potassium: 390,
          magnesium: 25,
          calcium: 180,
          iron: 1.5,
          zinc: 0.8,
          selenium: 8,
          iodine: 5,
          phosphorus: 120,
          vitaminD: 10,
          vitaminB12: 0.6,
          folate: 20,
          vitaminC: 1,
          vitaminE: 0.5,
          vitaminK: 4,
          vitaminA: 60,
          vitaminB6: 0.1,
          thiamine: 0.05,
          riboflavin: 0.15,
          niacin: 1.2
        }
      },
      {
        id: 'demo_food_log_complex_2',
        date: dates[0],
        name: '3 Slices of Deep Dish Pepperoni Pizza',
        composition: 'Thick white-flour crust, heavy mozzarella cheese, pepperoni, rich salted marinara pizza sauce.',
        weightGrams: 420,
        quantity: '3 large slices',
        benefits: 'High protein and calcium source.',
        risks: 'Extremely high in saturated fat and sodium. Causes immediate fluid retention and vascular pressure spikes.',
        healthImpact: 'Negative. Accelerates vascular strain, risking further glomerular filtration (eGFR) renal decline and elevating blood pressure.',
        recommendation: 'bad',
        nutrients: {
          calories: 1140,
          protein: 44,
          totalFat: 52,
          saturatedFat: 22, // heart-harming
          unsaturatedFat: 30,
          omega3: 0.2,
          carbohydrates: 122,
          addedSugar: 8,
          totalFibre: 3.8,
          solubleFibre: 0.6,
          sodium: 2240, // massive sodium dose
          potassium: 480,
          magnesium: 35,
          calcium: 380,
          iron: 3.5,
          zinc: 2.8,
          selenium: 28,
          iodine: 12,
          phosphorus: 320,
          vitaminD: 15,
          vitaminB12: 1.5,
          folate: 40,
          vitaminC: 5,
          vitaminE: 1.2,
          vitaminK: 15,
          vitaminA: 180,
          vitaminB6: 0.2,
          thiamine: 0.12,
          riboflavin: 0.22,
          niacin: 3.8
        }
      },
      {
        id: 'demo_food_log_complex_3',
        date: dates[1],
        name: 'Baked Herb Chicken Breast with Asparagus',
        composition: '180g skinless chicken breast baked with garlic, thyme, and 1.5 tbsp extra virgin olive oil, 15 spears of steamed fresh asparagus.',
        weightGrams: 350,
        quantity: '1 dinner plate',
        benefits: 'Outstanding source of lean, digestible protein, high dietary fiber, low sodium, and extremely low glycemic impact.',
        risks: 'Minimal risks. Highly compliant metabolic-protective meal.',
        healthImpact: 'Positive. Supports muscle mass while preventing glucose spikes and protecting kidney filtration capabilities.',
        recommendation: 'good',
        nutrients: {
          calories: 420,
          protein: 42,
          totalFat: 18,
          saturatedFat: 2.5,
          unsaturatedFat: 15,
          omega3: 0.4,
          carbohydrates: 12, // perfect for diabetes
          addedSugar: 0,
          totalFibre: 6.2,
          solubleFibre: 1.8,
          sodium: 210, // low sodium protects kidneys & BP
          potassium: 880,
          magnesium: 85,
          calcium: 75,
          iron: 3.8,
          zinc: 2.5,
          selenium: 42,
          iodine: 18,
          phosphorus: 380,
          vitaminD: 0,
          vitaminB12: 1.1,
          folate: 180,
          vitaminC: 22,
          vitaminE: 2.8,
          vitaminK: 85,
          vitaminA: 140,
          vitaminB6: 0.9,
          thiamine: 0.22,
          riboflavin: 0.28,
          niacin: 12.4
        }
      }
    ];
  }

  // default: average
  return [
    {
      id: 'demo_food_log_1',
      date: dates[0],
      name: 'Avocado Toast with Poached Eggs',
      composition: '2 slices sourdough bread, 1 whole avocado, 2 medium poached eggs, cherry tomatoes, pinch of sea salt, black pepper.',
      weightGrams: 340,
      quantity: '1 plate',
      benefits: 'Rich in monounsaturated fats (oleic acid) which support LDL reduction, high-quality proteins for satiety, and dietary fiber from avocado and whole grains.',
      risks: 'Mild caloric density, but extremely nutrient-dense.',
      healthImpact: 'Very positive. Monounsaturated lipids help manage the slightly elevated baseline LDL.',
      recommendation: 'good',
      nutrients: {
        calories: 520,
        protein: 19,
        totalFat: 28,
        saturatedFat: 5.5,
        unsaturatedFat: 22,
        omega3: 0.4,
        carbohydrates: 48,
        addedSugar: 0,
        totalFibre: 11,
        solubleFibre: 3.5,
        sodium: 480,
        potassium: 740,
        magnesium: 65,
        calcium: 80,
        iron: 3.2,
        zinc: 1.8,
        selenium: 32,
        iodine: 24,
        phosphorus: 210,
        vitaminD: 80, // minor boost
        vitaminB12: 1.2,
        folate: 110,
        vitaminC: 15,
        vitaminE: 4.2,
        vitaminK: 28,
        vitaminA: 120,
        vitaminB6: 0.4,
        thiamine: 0.25,
        riboflavin: 0.35,
        niacin: 3.8
      }
    },
    {
      id: 'demo_food_log_2',
      date: dates[0],
      name: 'Double Bacon Cheeseburger & Seasoned Fries',
      composition: 'Double beef patties, white brioche bun, 2 slices cheddar, 2 strips bacon, barbecue sauce, mayonnaise, 150g deep-fried fries.',
      weightGrams: 510,
      quantity: '1 standard combo meal',
      benefits: 'High protein content (beef and cheese).',
      risks: 'Extremely high in saturated fats, sodium, trans fats, and glycemic index of processed buns.',
      healthImpact: 'Negative. Accelerates lipid elevated baseline, increasing cardiovascular strain.',
      recommendation: 'bad',
      nutrients: {
        calories: 1180,
        protein: 48,
        totalFat: 68,
        saturatedFat: 24, // extremely high
        unsaturatedFat: 38,
        omega3: 0.1,
        carbohydrates: 95,
        addedSugar: 14,
        totalFibre: 4.5,
        solubleFibre: 0.8,
        sodium: 1750, // extremely high
        potassium: 620,
        magnesium: 45,
        calcium: 220,
        iron: 5.8,
        zinc: 4.2,
        selenium: 45,
        iodine: 10,
        phosphorus: 480,
        vitaminD: 10,
        vitaminB12: 2.8,
        folate: 35,
        vitaminC: 4,
        vitaminE: 1.8,
        vitaminK: 12,
        vitaminA: 90,
        vitaminB6: 0.3,
        thiamine: 0.15,
        riboflavin: 0.25,
        niacin: 5.2
      }
    },
    {
      id: 'demo_food_log_3',
      date: dates[1],
      name: 'Baked Salmon with Quinoa and Steamed Broccoli',
      composition: '150g wild-caught salmon fillet, 1 cup cooked quinoa, 1.5 cups broccoli florets, drizzled with 1 tsp extra virgin olive oil and lemon juice.',
      weightGrams: 390,
      quantity: '1 dinner portion',
      benefits: 'Outstanding source of omega-3 polyunsaturated fatty acids (EPA/DHA) directly reducing triglycerides. Satiating fiber and rich iron/magnesium.',
      risks: 'Very low risk. Extremely cardioprotective.',
      healthImpact: 'Exceptional. Highly targeted to combat elevated triglycerides and LDL.',
      recommendation: 'good',
      nutrients: {
        calories: 540,
        protein: 38,
        totalFat: 22,
        saturatedFat: 3.2,
        unsaturatedFat: 17.5,
        omega3: 2.1, // very high omega3!
        carbohydrates: 45,
        addedSugar: 0,
        totalFibre: 8.5,
        solubleFibre: 2.2,
        sodium: 290,
        potassium: 910,
        magnesium: 115,
        calcium: 120,
        iron: 4.5,
        zinc: 2.8,
        selenium: 55,
        iodine: 60,
        phosphorus: 440,
        vitaminD: 450, // natural vitamin D boost!
        vitaminB12: 4.8,
        folate: 140,
        vitaminC: 85,
        vitaminE: 3.5,
        vitaminK: 110,
        vitaminA: 180,
        vitaminB6: 0.8,
        thiamine: 0.35,
        riboflavin: 0.45,
        niacin: 8.4
      }
    }
  ];
}

export function getDemoReport(type: DemoProfileType = 'average', lang?: unknown): RecommendationReport {
  if (type === 'empty') {
    return {
      timestamp: new Date().toISOString(),
      dailyNutrientTargets: {
        calories: '2000 - 2400 kcal',
        saturatedFat: '< 20 g',
        sodium: '< 2000 mg'
      },
      mostImportantNextStep: 'Welcome! Please log your foods and upload your biomarker lab reports to generate personalized AI clinical guidance.',
      actions: [],
      dailyBenefits: [],
      latestInsights: [
        { title: t(lang, 'seedEmptyWelcomeTitle'), summary: t(lang, 'seedEmptyWelcomeSummary'), link: '#' }
      ],
      healthRiskForecast: {
        year5: 'No historical biomarkers analyzed yet.',
        year10: 'No historical biomarkers analyzed yet.',
        year20: 'No historical biomarkers analyzed yet.',
        optimized5: 'A healthy lifestyle minimizes long-term risks.',
        optimized10: 'Vibrant baseline optimization.',
        optimized20: 'Lifespan and healthspan expansion.'
      },
      topNutrientTargets: ['calories', 'saturatedFat', 'sodium'],
      topWeeklyNutrientTargets: [],
      nutrientRankingRationale: "Please input clinical test datasets or meal logs to activate personalized ranking priorities. Currently operating on standard cardiovascular guidelines."
    };
  }

  if (type === 'complex') {
    return {
      timestamp: new Date().toISOString(),
      dailyNutrientTargets: {
        calories: '1600 - 1800 kcal',
        saturatedFat: '< 13 g',
        sodium: '< 1500 mg',
        carbohydrates: '< 130 g',
        protein: '70 - 90 g',
        solubleFibre: '> 10 g'
      },
      mostImportantNextStep: 'Strictly limit sodium (<1500mg) and glycemic load (<130g carbs) to address Stage 2 Hypertension and Diabetic HbA1c (7.1%), safeguarding remaining kidney filtration (eGFR 64).',
      actions: [
        { id: 'demo_action_complex_1', task: t(lang, 'seedComplexActionSodiumTask'), explanation: t(lang, 'seedComplexActionSodiumExpl'), priority: 'high', completed: false, type: 'lifestyle' },
        { id: 'demo_action_complex_2', task: t(lang, 'seedComplexActionGlycemicTask'), explanation: t(lang, 'seedComplexActionGlycemicExpl'), priority: 'high', completed: false, type: 'lifestyle' },
        { id: 'demo_action_complex_3', task: t(lang, 'seedComplexActionVitDHighTask'), explanation: t(lang, 'seedComplexActionVitDHighExpl'), priority: 'high', completed: false, type: 'lifestyle' },
        { id: 'demo_action_complex_4', task: t(lang, 'seedComplexActionNephroTask'), explanation: t(lang, 'seedComplexActionNephroExpl'), priority: 'medium', completed: false, type: 'doctor' }
      ],
      dailyBenefits: [
        { id: 'demo_benefit_complex_1', activity: t(lang, 'seedComplexBenefitSodium'), target: t(lang, 'seedBenefitTargetDaily'), completed: false },
        { id: 'demo_benefit_complex_2', activity: t(lang, 'seedComplexBenefitCarbs'), target: t(lang, 'seedBenefitTargetDaily'), completed: false },
        { id: 'demo_benefit_complex_3', activity: t(lang, 'seedComplexBenefitBP'), target: t(lang, 'seedBenefitTargetDaily'), completed: false }
      ],
      latestInsights: [
        { title: t(lang, 'seedComplexInsightCardioTitle'), summary: t(lang, 'seedComplexInsightCardioSummary'), link: '#' },
        { title: t(lang, 'seedComplexInsightDashTitle'), summary: t(lang, 'seedComplexInsightDashSummary'), link: '#' }
      ],
      healthRiskForecast: {
        year5: 'High risk of diabetic microvascular progression and worsening renal filtration (potential CKD Stage 3 entry).',
        year10: 'Elevated risk of severe diabetic neuropathy, chronic nephropathy, and major vascular events.',
        year20: 'Severe cardiorenal morbidity if metabolic and hypertensive markers remain unchecked.',
        optimized5: 'Stabilized renal function (eGFR > 70) and improved insulin sensitivity (HbA1c < 6.2%).',
        optimized10: 'Vastly decreased cardiovascular risk; normal blood pressure bounds and protected glomerular vessels.',
        optimized20: 'Protected healthspan; age-typical vascular compliance and active lifestyle retention.'
      },
      topNutrientTargets: ['sodium', 'carbohydrates', 'calories', 'saturatedFat', 'protein'],
      topWeeklyNutrientTargets: ['solubleFibre', 'magnesium', 'omega3'],
      nutrientRankingRationale: "Sodium restriction (<1500 mg) is your absolute highest priority because reducing total blood volume directly relieves glomerular pressure in the kidneys, critical for preserving Arthur\'s glomerular filtration (eGFR of 64). Carbohydrate restriction (<130 g) holds equal importance to lower glycemic spikes and prevent high fasting glucose from causing microvascular damage to sensitive renal arterioles. Caloric restriction (1600-1800 kcal) supports gradual body fat reduction, which reduces visceral fat-induced cytokine strain, while moderate protein (70-90 g) prevents metabolic waste overload without triggering protein malnutrition."
    };
  }

  // default: average
  return {
    timestamp: new Date().toISOString(),
    dailyNutrientTargets: {
      calories: '2000 - 2400 kcal',
      saturatedFat: '< 20 g',
      sodium: '< 2000 mg',
      protein: '75 - 120 g',
      totalFibre: '> 30 g',
      vitaminD: '2000 IU'
    },
    mostImportantNextStep: 'Optimize lipid panel by prioritizing high-fiber foods (soluble fiber) and supplement Vitamin D (2000-4000 IU daily) to address deficiency.',
      actions: [
        { id: 'demo_action_1', task: t(lang, 'seedDemoActionVitDTask'), explanation: t(lang, 'seedDemoActionVitDExpl'), priority: 'high', completed: false, type: 'lifestyle' },
        { id: 'demo_action_2', task: t(lang, 'seedDemoActionFiberTask'), explanation: t(lang, 'seedDemoActionFiberExpl'), priority: 'medium', completed: false, type: 'lifestyle' },
        { id: 'demo_action_3', task: t(lang, 'seedDemoActionLipidTask'), explanation: t(lang, 'seedDemoActionLipidExpl'), priority: 'medium', completed: false, type: 'doctor' }
      ],
      dailyBenefits: [
        { id: 'demo_benefit_1', activity: t(lang, 'seedDemoBenefitVitD'), target: t(lang, 'seedBenefitTargetDaily'), completed: false },
        { id: 'demo_benefit_2', activity: t(lang, 'seedDemoBenefitFiber'), target: t(lang, 'seedBenefitTargetDaily'), completed: false },
        { id: 'demo_benefit_3', activity: t(lang, 'seedDemoBenefitSatFat'), target: t(lang, 'seedBenefitTargetDaily'), completed: false }
      ],
      latestInsights: [
        { title: t(lang, 'seedDemoInsightFiberTitle'), summary: t(lang, 'seedDemoInsightFiberSummary'), link: '#' },
        { title: t(lang, 'seedDemoInsightVitDTitle'), summary: t(lang, 'seedDemoInsightVitDSummary'), link: '#' }
      ],
    healthRiskForecast: {
      year5: 'Slight risk of subclinical atherosclerosis if lipids remain elevated.',
      year10: 'Moderate cardiovascular risk due to persistent hyperlipidemia.',
      year20: 'Elevated risk of plaque accumulation if lifestyle is unmanaged.',
      optimized5: 'Negligible risk. Arteries remain clear.',
      optimized10: 'Excellent vascular profile.',
      optimized20: 'Extremely low risk; comparable to an ultra-healthy baseline.'
    },
    topNutrientTargets: ['calories', 'saturatedFat', 'sodium', 'protein', 'solubleFibre', 'carbohydrates'],
    topWeeklyNutrientTargets: ['vitaminD', 'omega3', 'magnesium'],
    nutrientRankingRationale: "Focusing on Saturated Fat restriction is your single most important clinical priority, as limiting saturated fats directly halts the overproduction of atherogenic LDL particles and vascular plaque buildup. Pairing this with increased Soluble Fibre binds intestinal cholesterol to accelerate lipid excretion and stabilize glucose spikes, creating a foundational baseline for metabolic stability. Managing overall Caloric intake, Sodium, and Protein provides essential protection for renal filtration (eGFR) and vascular pressure, but these serve as secondary supporting targets. Prioritizing saturated fat reduction and soluble fiber intake delivers the highest overall health leverage, addressing the root driver of cardiovascular risk far more effectively than isolated micronutrient adjustments."
  };
}
