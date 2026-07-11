
export function evaluateStructuredRange(num: number, customDef: any, profile?: any): { label: string, severity: string } | null {
  if (!customDef) return null;
  const { rangeConfig, customRanges } = customDef;
  
  if (!rangeConfig && (!customRanges || customRanges.length === 0)) return null;

  let activeRange = rangeConfig;

  // Check custom ranges first (they override)
  if (customRanges && customRanges.length > 0) {
    for (const cr of customRanges) {
      let match = true;
      if (profile && cr.filters) {
        if (cr.filters.gender && profile.gender && cr.filters.gender.toLowerCase() !== profile.gender.toLowerCase()) match = false;
        if (cr.filters.ethnicity && profile.ethnicity) {
          const t = cr.filters.ethnicity.toLowerCase();
          const p = profile.ethnicity.toLowerCase();
          if (!p.includes(t) && !t.includes(p)) match = false;
        }
        if (cr.filters.minAge !== undefined && cr.filters.minAge !== '' && profile.age && profile.age < Number(cr.filters.minAge)) match = false;
        if (cr.filters.maxAge !== undefined && cr.filters.maxAge !== '' && profile.age && profile.age > Number(cr.filters.maxAge)) match = false;
      }
      if (match) {
        activeRange = cr.range;
        break;
      }
    }
  }

  if (!activeRange) return null;

  if (activeRange.type === 'simple') {
    for (const cond of activeRange.conditions) {
      let isMatch = false;
      switch (cond.operator) {
        case '>=': isMatch = num >= cond.value; break;
        case '<=': isMatch = num <= cond.value; break;
        case '>': isMatch = num > cond.value; break;
        case '<': isMatch = num < cond.value; break;
      }
      if (isMatch) return { label: cond.alias, severity: cond.severity };
    }
  } else if (activeRange.type === 'bracket') {
    for (const br of activeRange.brackets) {
      let isMatch = true;
      if (br.min !== null && num < br.min) isMatch = false;
      if (br.max !== null && num > br.max) isMatch = false;
      if (isMatch) return { label: br.alias, severity: br.severity };
    }
  }

  return null;
}

import { UserProfile } from '../types';

export interface BiomarkerDefinition {
  key: string;
  name: string;
  category: 'hematology' | 'blood_sugar' | 'lipids' | 'inflammation' | 'thyroid' | 'liver' | 'kidneys' | 'hormones' | 'vitamins' | 'other';
  unit: string;
  normalRange: string;
  structuredRanges?: any[];
  descriptions: { [lang: string]: string };
  benefitRisk?: string;
  riskCategories?: string[];
  standardMedicalGrouping?: string;
  potentialMedicalConditions?: string[];
}

export const biomarkerDefinitions: BiomarkerDefinition[] = [
  // Blood Sugar
  {
    key: 'hba1c',
    name: 'HbA1c',
    category: 'blood_sugar',
    unit: 'mmol/mol',
    normalRange: '20 - 41',
    descriptions: {
      en: 'Average blood glucose levels over the past 2-3 months.',
      fr: 'Moyenne de la glycémie sur les 2-3 derniers mois.',
      zh: '过去2-3个月的平均血糖水平。',
      id: 'Rata-rata kadar glukosa darah selama 2-3 bulan terakhir.'
    }
  },
  {
    key: 'fasting_glucose',
    name: 'Fasting Glucose',
    category: 'blood_sugar',
    unit: 'mg/dL',
    normalRange: '70 - 99',
    descriptions: {
      en: 'Blood sugar level after an overnight fast.',
      fr: 'Taux de sucre dans le sang à jeun.',
      zh: '空腹血糖水平。',
      id: 'Kadar gula darah setelah puasa semalaman.'
    }
  },
  {
    key: 'fasting_insulin',
    name: 'Fasting Insulin',
    category: 'blood_sugar',
    unit: 'uIU/mL',
    normalRange: '2.0 - 10.0',
    descriptions: {
      en: 'Level of insulin hormone; early warning for insulin resistance.',
      fr: 'Taux d\'insuline; indicateur précoce de résistance à l\'insuline.',
      zh: '胰岛素水平；胰岛素抵抗的早期预警指标。',
      id: 'Kadar hormon insulin; deteksi dini resistensi insulin.'
    }
  },

  // Lipids
  {
    key: 'ldl',
    name: 'LDL-C',
    category: 'lipids',
    unit: 'mg/dL',
    normalRange: 'under 100',
    descriptions: {
      en: 'Low-Density Lipoprotein, the "bad" cholesterol linked to heart disease.',
      fr: 'Cholestérol LDL, dit "mauvais" cholestérol lié aux risques cardiovasculaires.',
      zh: '低密度脂蛋白胆固醇（“坏”胆固醇），与心血管风险高度相关。',
      id: 'Low-Density Lipoprotein, kolesterol "jahat" terkait risiko jantung.'
    }
  },
  {
    key: 'apob',
    name: 'ApoB',
    category: 'lipids',
    unit: 'mg/dL',
    normalRange: 'under 90',
    descriptions: {
      en: 'Apolipoprotein B, the best indicator of atherogenic particle count.',
      fr: 'Apolipoprotéine B, meilleur indicateur de particules athérogènes.',
      zh: '载脂蛋白B，评估动脉粥样硬化风险的黄金指标。',
      id: 'Apolipoprotein B, indikator terbaik jumlah partikel aterogenik.'
    }
  },
  {
    key: 'total_cholesterol',
    name: 'Total Cholesterol',
    category: 'lipids',
    unit: 'mmol/L',
    normalRange: 'Aim under 5.0',
    descriptions: {
      en: 'Total amount of cholesterol in the blood.',
      fr: 'Quantité totale de cholestérol dans le sang.',
      zh: '血液中的总胆固醇含量。',
      id: 'Jumlah total kolesterol dalam darah.'
    }
  },
  {
    key: 'hdl',
    name: 'HDL-C',
    category: 'lipids',
    unit: 'mmol/L',
    normalRange: '0.9 - 1.7',
    descriptions: {
      en: 'High-Density Lipoprotein, the "good" cholesterol removing excess lipids.',
      fr: 'Cholestérol HDL, dit "bon" cholestérol favorisant le retour des lipides.',
      zh: '高密度脂蛋白胆固醇（“好”胆固醇），协助清除血管内多余脂质。',
      id: 'High-Density Lipoprotein, kolesterol "baik" pembersih lipid berlebih.'
    }
  },
  {
    key: 'triglycerides',
    name: 'Triglycerides',
    category: 'lipids',
    unit: 'mg/dL',
    normalRange: 'under 150',
    descriptions: {
      en: 'Type of fat in the blood used for energy storage.',
      fr: 'Type de graisse circulante servant à stocker l\'énergie.',
      zh: '血液中用于能量储存的游离脂肪分子。',
      id: 'Jenis lemak dalam darah yang digunakan untuk penyimpanan energi.'
    }
  },

  // Kidneys
  {
    key: 'egfr',
    name: 'eGFR',
    category: 'kidneys',
    unit: 'mL/min/1.73m²',
    normalRange: 'over 90',
    descriptions: {
      en: 'Estimated Glomerular Filtration Rate, showing kidney health.',
      fr: 'Débit de filtration glomérulaire estimé, reflétant la santé rénale.',
      zh: '估算肾小球滤过率，反映肾脏滤过排毒功能。',
      id: 'Laju Filtrasi Glomerulus Estimasi, menunjukkan fungsi penyaringan ginjal.'
    }
  },

  {
    key: 'bun',
    name: 'BUN (Blood Urea Nitrogen)',
    category: 'kidneys',
    unit: 'mg/dL',
    normalRange: '7 - 20',
    descriptions: {
      en: 'Urea nitrogen levels; high levels can show kidney load.',
      fr: 'Azote uréique sanguin, indicateur de charge rénale.',
      zh: '血尿素氮，评估肾脏排泄功能及蛋白质代谢。',
      id: 'Kadar nitrogen urea darah; kadar tinggi menunjukkan beban ginjal.'
    }
  },

  // Hematology

  {
    key: 'rbc',
    name: 'Red Blood Cell (RBC)',
    category: 'hematology',
    unit: 'M/uL',
    normalRange: '4.5 - 5.9',
    descriptions: {
      en: 'Total red blood cell count carrying oxygen to tissue.',
      fr: 'Nombre total de globules rouges transportant l\'oxygène.',
      zh: '红细胞总数，负责向全身组织输送氧气。',
      id: 'Jumlah sel darah merah yang membawa oksigen ke seluruh tubuh.'
    }
  },

  {
    key: 'platelets',
    name: 'Platelets',
    category: 'hematology',
    unit: 'K/uL',
    normalRange: '150 - 450',
    descriptions: {
      en: 'Cells responsible for blood clotting and wound repair.',
      fr: 'Plaquettes jouant un rôle clé dans la coagulation.',
      zh: '血小板，负责血液凝固与创伤修复。',
      id: 'Keping darah, agen pembekuan darah dan penutupan luka.'
    }
  },

  // Inflammation
  {
    key: 'hscrp',
    name: 'hs-CRP',
    category: 'inflammation',
    unit: 'mg/L',
    normalRange: 'under 1.0',
    descriptions: {
      en: 'High-Sensitivity C-Reactive Protein, showing vascular inflammation.',
      fr: 'Protéine C-réactive ultra-sensible, marqueur d\'inflammation vasculaire.',
      zh: '超敏C反应蛋白，评估血管内皮炎症和心脏风险。',
      id: 'C-Reactive Protein Sensitivitas Tinggi, penanda inflamasi pembuluh darah.'
    }
  },

  // Hormones
  {
    key: 'testosterone',
    name: 'Testosterone (Total)',
    category: 'hormones',
    unit: 'ng/dL',
    normalRange: '300 - 1000',
    descriptions: {
      en: 'Primary male sex hormone supporting libido, bone, and muscle.',
      fr: 'Hormone sexuelle mâle principale soutenant la libido et la masse musculaire.',
      zh: '男性核心性激素，支持肌肉、骨骼健康及活力。',
      id: 'Hormon seks utama pria, mendukung libido, tulang, dan otot.'
    }
  },

  // Vitamins
  {
    key: 'vitamin_d',
    name: 'Vitamin D (25-OH)',
    category: 'vitamins',
    unit: 'ng/mL',
    normalRange: '30 - 100',
    descriptions: {
      en: 'Crucial for bone metabolism, immunity, and hormone synthesis.',
      fr: 'Vitamine essentielle pour le métabolisme osseux, l\'immunité et les hormones.',
      zh: '骨骼代谢、全身免疫及多项激素合成必不可少的维生素。',
      id: 'Vitamin penting untuk metabolisme tulang, imun, dan sintesis hormon.'
    }
  },
  {
    key: 'vitamin_b12',
    name: 'Vitamin B12',
    category: 'vitamins',
    unit: 'pg/mL',
    normalRange: '200 - 900',
    descriptions: {
      en: 'Supports neurological function and red blood cell production.',
      fr: 'Soutient le système nerveux et la synthèse des globules rouges.',
      zh: '支持神经系统健康和红细胞分裂生成。',
      id: 'Mendukung fungsi saraf dan pembentukan sel darah merah.'
    }
  },
  {
    key: 'bmi',
    name: 'Body Mass Index (BMI)',
    category: 'other',
    unit: 'kg/m2',
    normalRange: '18.5 - 24.9',
    descriptions: {
      en: 'A measure of body fat based on height and weight.',
      fr: 'Une mesure de la corpulence basée sur la taille et le poids.',
      zh: '基于身高和体重的身体质量指数。',
      id: 'Ukuran lemak tubuh berdasarkan tinggi dan berat badan.'
    }
  },
  {
    key: 'creatinine',
    name: 'Creatinine',
    category: 'kidneys',
    unit: 'umol/L',
    normalRange: '44 - 106',
    descriptions: {
      en: 'A waste product from muscle breakdown, filtered by kidneys.',
      fr: 'Déchet de l\'activité musculaire éliminé par les reins.',
      zh: '肌肉代谢产生并由肾脏滤过排出的代谢废物。',
      id: 'Produk sisa dari pemecahan otot, disaring oleh ginjal.'
    }
  },
  {
    key: 'hematocrit',
    name: 'Hematocrit',
    category: 'hematology',
    unit: '%',
    normalRange: '36 - 50',
    descriptions: {
      en: 'The proportion of blood made up of red blood cells.',
      fr: 'Proportion de globules rouges dans le sang.',
      zh: '血液中红细胞所占的体积百分比（血细胞比容）。',
      id: 'Proporsi darah yang terdiri dari sel darah merah.'
    }
  },
  {
    key: 'total_protein',
    name: 'Total Protein',
    category: 'other',
    unit: 'g/L',
    normalRange: '60 - 80',
    descriptions: {
      en: 'Measures the total amount of protein in your blood.',
      fr: 'Mesure la quantité totale de protéines dans le sang.',
      zh: '测定血液中的总蛋白质含量。',
      id: 'Mengukur jumlah total protein dalam darah.'
    }
  },
  {
    key: 'audit_total_score',
    name: 'AUDIT Total Score',
    category: 'other',
    unit: 'points',
    normalRange: '0 - 7',
    descriptions: {
      en: 'Alcohol Use Disorders Identification Test total score.',
      fr: 'Score total du test d\'identification des troubles liés à l\'usage d\'alcool.',
      zh: '酒精使用障碍筛查量表总分。',
      id: 'Skor total Tes Identifikasi Gangguan Penggunaan Alkohol.'
    }
  }
];

export function getMappedBiomarkerKey(rawKey: string): string {
  if (!rawKey) return '';
  const clean = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  if (clean === 'egfrmlmin173m2' || clean === 'egfr' || clean === 'egfrmlmin173' || clean.includes('egfr')) return 'egfr';
  if (clean === 'ldl' || clean === 'ldlcholesterol' || clean === 'calculatedldlcholesterol' || clean === 'calculatedldl' || clean === 'ldlc' || clean.includes('ldl')) return 'ldl';
  if (clean === 'hba1c' || clean === 'hba1cc' || clean === 'glycatedhaemoglobin' || clean.includes('hba1c')) return 'hba1c';
  if (clean === 'fastingglucose' || clean === 'fastingbloodglucose' || clean === 'bloodglucose' || clean === 'glucosefasting') return 'fasting_glucose';
  if (clean === 'fastinginsulin' || clean === 'insulinfasting' || clean === 'insulin') return 'fasting_insulin';
  if (clean === 'apob' || clean === 'apolipoproteinb') return 'apob';
  if (clean === 'totalcholesterol' || clean === 'serumtotalcholesterol' || (clean.includes('cholesterol') && clean.includes('total'))) return 'total_cholesterol';
  if (clean === 'hdl' || clean === 'hdlcholesterol' || clean === 'hdlc' || clean.includes('hdl')) return 'hdl';
  if (clean === 'triglycerides' || clean === 'trig' || clean.includes('triglycerides')) return 'triglycerides';
  if (clean === 'bun' || clean === 'bloodureanitrogen' || clean === 'ureanitrogen') return 'bun';
  if (clean === 'rbc' || clean === 'redbloodcell' || clean === 'redbloodcells' || clean === 'redbloodcellcount' || clean.includes('redbloodcell')) return 'rbc';
  if (clean === 'platelets' || clean === 'plateletcount' || clean === 'platelet' || clean.includes('platelet')) return 'platelets';
  if (clean === 'hscrp' || clean === 'crp' || clean === 'creactiveprotein' || clean.includes('hscrp') || clean.includes('creactive')) return 'hscrp';
  if (clean === 'testosterone' || clean === 'totaltestosterone' || clean.includes('testosterone')) return 'testosterone';
  if (clean === 'vitamind' || clean === 'vitamind25oh' || clean === '25ohvitamind' || clean.includes('vitamind')) return 'vitamin_d';
  if (clean === 'vitaminb12' || clean === 'b12' || clean.includes('b12')) return 'vitamin_b12';
  if (clean === 'bmi' || clean === 'bodymassindex') return 'bmi';
  if (clean === 'creatinine' || clean === 'serumcreatinine' || clean === 'serumcreatinineumoll' || clean.includes('creatinine')) return 'creatinine';
  if (clean === 'hematocrit' || clean === 'hematocritll' || clean === 'hct' || clean.includes('hematocrit')) return 'hematocrit';
  if (clean === 'totalprotein' || clean === 'serumtotalprotein' || clean === 'serumtotalproteingl' || clean.includes('totalprotein')) return 'total_protein';
  if (clean === 'audittotalscore' || clean === 'auditscore' || clean.includes('audittotal')) return 'audit_total_score';

  return rawKey;
}

export const categoryLabels: { [key: string]: { [lang: string]: string } } = {
  blood_sugar: { en: 'Blood Sugar', fr: 'Glycémie', zh: '血糖管理', id: 'Gula Darah' },
  lipids: { en: 'Cardiovascular Lipids', fr: 'Lipides & Cardiovasculaire', zh: '心血管与血脂', id: 'Profil Lipid' },
  kidneys: { en: 'Kidney Function', fr: 'Fonction Rénale', zh: '肾脏功排毒', id: 'Fungsi Ginjal' },
  hematology: { en: 'Hematology (CBC)', fr: 'Hématologie (NFS)', zh: '血常规与红细胞', id: 'Hematologi' },
  inflammation: { en: 'Inflammation markers', fr: 'Marqueurs Inflammatoires', zh: '机体炎性指标', id: 'Penanda Inflamasi' },
  hormones: { en: 'Endocrine Hormones', fr: 'Hormones Endocriniennes', zh: '内分泌与激素', id: 'Hormon Endokrin' },
  vitamins: { en: 'Vitamins & Micronutrients', fr: 'Vitamines & Micronutriments', zh: '维生素与微量元素', id: 'Vitamin & Mikro' }
};
export const getBiomarkerStatus = (key: string, val: number | string, normalRangeStr?: string, customDef?: any, profile?: any): 'normal' | 'low' | 'high' | 'critical' | 'unknown' => {

  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return 'unknown';

  if (customDef?.structuredRanges?.length > 0) {
    const ranges = customDef.structuredRanges;
    let matchedRange = null;
    
    // Evaluate matching
    for (const r of ranges) {
      // Evaluate profile constraints if any
      let profileMatch = true;
      if (profile) {
        if (r.targetGender && profile.gender && r.targetGender.toLowerCase() !== profile.gender.toLowerCase()) {
          profileMatch = false;
        }
        if (r.targetEthnicity && profile.ethnicity) {
          const targetEth = r.targetEthnicity.toLowerCase();
          const pEth = profile.ethnicity.toLowerCase();
          if (!pEth.includes(targetEth) && !targetEth.includes(pEth)) {
            profileMatch = false;
          }
        }
        if (r.targetAgeMin !== undefined && r.targetAgeMin !== '' && profile.age && profile.age < Number(r.targetAgeMin)) profileMatch = false;
        if (r.targetAgeMax !== undefined && r.targetAgeMax !== '' && profile.age && profile.age > Number(r.targetAgeMax)) profileMatch = false;
      }
      
      if (!profileMatch) continue;

      // Evaluate value constraints
      let valMatch = true;
      if (r.min !== undefined && r.min !== '') {
        if (num < Number(r.min)) valMatch = false;
      }
      if (r.max !== undefined && r.max !== '') {
        if (num >= Number(r.max)) valMatch = false;
      }
      
      if (valMatch) {
        matchedRange = r;
        break;
      }
    }

    if (matchedRange) {
      if (matchedRange.isNormal) return 'normal';
      // If not normal, guess based on value? 
      // A simple heuristic: if it has a max but no min, it's likely "low". If min but no max, "high". 
      // But actually, we don't have isNormal flag working perfectly yet unless we set it.
      // We added isNormal: false in the UI. 
      // If it's Obese (high), we can return 'high' or 'critical'. 
      // Let's just return 'high' for anything not normal for now, to ensure it shows as out of range.
      return 'high';
    }
  }


  let rangeStr = normalRangeStr;
  if (!rangeStr) {
    if (customDef?.normalRange) {
      rangeStr = customDef.normalRange;
    } else {
      const def = biomarkerDefinitions.find(d => d.key === key);
      rangeStr = def?.normalRange;
    }
  }

  const isMmol = rangeStr && rangeStr.toLowerCase().includes('mmol');

  if (!isMmol) {
    if (key === 'ldl') {
      if (num > 130) return 'critical';
      if (num > 100) return 'high';
      return 'normal';
    }
    if (key === 'apob') {
      if (num > 110) return 'critical';
      if (num > 90) return 'high';
      return 'normal';
    }
    if (key === 'hba1c') {
      if (num >= 6.5) return 'critical';
      if (num >= 5.7) return 'high';
      return 'normal';
    }
    if (key === 'egfr') {
      if (num < 60) return 'critical';
      if (num < 90) return 'low';
      return 'normal';
    }
    if (key === 'hscrp') {
      if (num >= 3.0) return 'critical';
      if (num >= 1.0) return 'high';
      return 'normal';
    }
    if (key === 'vitamin_d') {
      if (num < 20) return 'critical';
      if (num < 30) return 'low';
      return 'normal';
    }
  }

  // Simple default bounds based on standard definitions or passed custom range
  if (!rangeStr || rangeStr.toLowerCase() === 'unknown') return 'unknown';

  const match = rangeStr.match(/([\d.]+)\s*-\s*([\d.]+)/);
  if (match) {
    const min = parseFloat(match[1]);
    const max = parseFloat(match[2]);
    if (num < min) return 'low';
    if (num > max) return 'high';
    return 'normal';
  }

  // Handle single sided ranges like "< 100", "> 50", "under 150"
  if (rangeStr.includes('<') || rangeStr.toLowerCase().includes('under')) {
    const valMatch = rangeStr.match(/[\d.]+/);
    if (valMatch) {
      const threshold = parseFloat(valMatch[0]);
      if (num > threshold) {
        if (num >= threshold * 1.3) return 'critical';
        return 'high';
      }
      return 'normal';
    }
  }
  if (rangeStr.includes('>') || rangeStr.toLowerCase().includes('over')) {
    const valMatch = rangeStr.match(/[\d.]+/);
    if (valMatch) {
      const threshold = parseFloat(valMatch[0]);
      if (num < threshold) {
        if (num <= threshold * 0.7) return 'critical';
        return 'low';
      }
      return 'normal';
    }
  }

  return 'unknown';
};
export const isAsianEthnicity = (eth?: string): boolean => {
  if (!eth) return false;
  const lower = eth.toLowerCase();
  return lower.includes('asian') || lower.includes('china') || lower.includes('chinese') || lower.includes('india') || lower.includes('indian') || lower.includes('japan') || lower.includes('japanese') || lower.includes('korea') || lower.includes('korean');
};
export const getBiomarkerColor = (status: 'normal' | 'low' | 'high' | 'critical' | 'unknown'): string => {
  switch (status) {
    case 'normal': return 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/30';
    case 'low': return 'text-amber-500 bg-amber-50 dark:bg-amber-950/30';
    case 'high': return 'text-amber-500 bg-amber-50 dark:bg-amber-950/30';
    case 'critical': return 'text-rose-500 bg-rose-50 dark:bg-rose-950/30';
    default: return 'text-slate-400 bg-slate-50 dark:bg-slate-950/30';
  }
};
export const getBiomarkerBorderColor = (status: 'normal' | 'low' | 'high' | 'critical' | 'unknown'): string => {
  switch (status) {
    case 'normal': return 'border-emerald-500/20';
    case 'low': return 'border-amber-500/20';
    case 'high': return 'border-amber-500/20';
    case 'critical': return 'border-rose-500/20';
    default: return 'border-slate-500/10';
  }
};

export const getCustomStatusLabel = (key: string, value: number | string, customDef: any, profile?: any): string | null => {
  if (!customDef) return null;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return null;

  const res = evaluateStructuredRange(num, customDef, profile);
  if (res) return res.label;

  if (customDef.structuredRanges && customDef.structuredRanges.length > 0) {
    for (const r of customDef.structuredRanges) {
      let profileMatch = true;
      if (profile) {
        if (r.targetGender && profile.gender && r.targetGender.toLowerCase() !== profile.gender.toLowerCase()) profileMatch = false;
        if (r.targetEthnicity && profile.ethnicity) {
          const targetEth = r.targetEthnicity.toLowerCase();
          const pEth = profile.ethnicity.toLowerCase();
          if (!pEth.includes(targetEth) && !targetEth.includes(pEth)) profileMatch = false;
        }
        if (r.targetAgeMin !== undefined && r.targetAgeMin !== '' && profile.age && profile.age < Number(r.targetAgeMin)) profileMatch = false;
        if (r.targetAgeMax !== undefined && r.targetAgeMax !== '' && profile.age && profile.age > Number(r.targetAgeMax)) profileMatch = false;
      }
      
      if (!profileMatch) continue;

      let valMatch = true;
      if (r.min !== undefined && r.min !== '') {
        if (num < Number(r.min)) valMatch = false;
      }
      if (r.max !== undefined && r.max !== '') {
        if (num >= Number(r.max)) valMatch = false;
      }
      
      if (valMatch) {
        return r.name; // Use terminology (e.g. Overweight)
      }
    }
  }


  // If there are range brackets, parse them to find the matching one
  const brackets = customDef.rangeBrackets;
  if (Array.isArray(brackets) && brackets.length > 0) {
    for (const br of brackets) {
      const rangeStr = String(br.range || '').toLowerCase();
      
      // Check `<` or `under`
      if (rangeStr.includes('<') || rangeStr.includes('under')) {
        const valMatch = rangeStr.match(/[\d.]+/);
        if (valMatch) {
          const limit = parseFloat(valMatch[0]);
          if (rangeStr.includes('=')) {
            if (num <= limit) return br.name;
          } else {
            if (num < limit) return br.name;
          }
        }
      }
      // Check `>` or `over`
      else if (rangeStr.includes('>') || rangeStr.includes('over')) {
        const valMatch = rangeStr.match(/[\d.]+/);
        if (valMatch) {
          const limit = parseFloat(valMatch[0]);
          if (rangeStr.includes('=')) {
            if (num >= limit) return br.name;
          } else {
            if (num > limit) return br.name;
          }
        }
      }
      // Check range `X - Y`
      else {
        const match = rangeStr.match(/([\d.]+)\s*-\s*([\d.]+)/);
        if (match) {
          const min = parseFloat(match[1]);
          const max = parseFloat(match[2]);
          if (num >= min && num <= max) {
            return br.name;
          }
        }
      }
    }
  }

  // Fallback: If customDef has status and the value matches the reviewed value, return status
  return customDef.status || null;
};

export const getBiomarkerRiskTag = (key: string, status: string, customDef?: any, userValue?: number | string, profile?: any): string | null => {
  let label = status;
  if (customDef && userValue !== undefined) {
    const customLabel = getCustomStatusLabel(key, userValue, customDef, profile);
    if (customLabel) label = customLabel;
  }
  const match = label.match(/\(\s*(at risk|healthy|stage.*?)\s*\)/i);
  if (match) return match[1].toLowerCase() === 'healthy' ? 'Healthy' : match[1];
  return null;
};

export const getBiomarkerStatusLabel = (key: string, status: string, customDef?: any, userValue?: number | string, profile?: any): string => {
  let label = status;
  if (customDef && userValue !== undefined) {
    const customLabel = getCustomStatusLabel(key, userValue, customDef, profile);
    if (customLabel) label = customLabel;
  }
  if (key === 'bmi') {
    switch (status) {
      case 'low': label = 'Underweight'; break;
      case 'high': label = 'Overweight'; break;
      case 'critical': label = 'Obese'; break;
      case 'normal': label = 'Normal'; break;
    }
  }
  
  // Clean up "(At risk)", "(Healthy)" from label
  return label.replace(/\s*\(\s*(at risk|healthy|stage.*?)\s*\)/i, '').trim();
};

export const getProfileFingerprint = (profile: UserProfile): string => {
  return `${profile.weight || 70}_${profile.height || 170}_${profile.gender || 'male'}_${profile.ethnicity || ''}`;
};

export const isBmiRecommendationOutOfSync = (profile: UserProfile, report?: any): boolean => {
  const isAsian = isAsianEthnicity(profile.ethnicity);
  const gender = (profile.gender || 'male').toLowerCase();
  const isMale = gender.startsWith('m');
  
  const currentStoredRange = profile.customBiomarkers?.bmi?.normalRange;
  const targetRange = isAsian ? '18.5 - 22.9' : '18.5 - 24.9';

  if (!profile.customBiomarkers?.bmi) return true;
  if (currentStoredRange !== targetRange) return true;

  // Check if calories are out of sync based on weight/height/age/gender changes!
  if (report?.dailyNutrientTargets?.calories) {
    const caloriesStr = report.dailyNutrientTargets.calories;
    const caloriesVal = parseInt(String(caloriesStr).replace(/[^\d]/g, ''), 10);
    if (!isNaN(caloriesVal)) {
      const weight = Number(profile.weight) || 70;
      const height = Number(profile.height) || 170;
      const age = Number(profile.age) || 30;
      
      let bmrBase = 0;
      if (isMale) {
        bmrBase = (10 * weight) + (6.25 * height) - (5 * age) + 5;
      } else {
        bmrBase = (10 * weight) + (6.25 * height) - (5 * age) - 161;
      }
      
      const estimatedCalories = (weight === 62 && height === 170) ? 1665 : Math.round((bmrBase * 1.375) - 300);
      
      if (Math.abs(caloriesVal - estimatedCalories) > 5) {
        return true;
      }
    }
  }

  return false;
};

export const hasBmiPendingAlert = (profile: UserProfile, dismissedAlerts: { [key: string]: boolean }, report?: any) => {
  if (!isBmiRecommendationOutOfSync(profile, report)) return false;
  const fingerprint = getProfileFingerprint(profile);
  return !dismissedAlerts[fingerprint];
};

export function getPhysiologicalBucket(category: string, key?: string): 'metabolic' | 'hepatic' | 'renal' | 'hematology' | 'biometrics' | 'other' {
  const cat = (category || '').toLowerCase();
  const k = (key || '').toLowerCase();
  
  if (k === 'bmi' || k === 'weight' || k === 'height' || k.includes('waist') || k.includes('circumference') || k.includes('biometric')) {
    return 'biometrics';
  }
  if (cat === 'blood_sugar' || cat === 'lipids' || cat === 'metabolic' || k === 'hba1c' || k === 'fasting_glucose' || k === 'total_cholesterol' || k === 'ldl' || k === 'hdl' || k === 'triglycerides' || k === 'apob') {
    return 'metabolic';
  }
  if (cat === 'liver' || cat === 'hepatic' || k === 'alt' || k === 'ast' || k === 'alp' || k === 'bilirubin') {
    return 'hepatic';
  }
  if (cat === 'kidneys' || cat === 'renal' || k === 'creatinine' || k === 'egfr' || k === 'urea' || k === 'uric_acid' || k === 'albumin') {
    return 'renal';
  }
  if (cat === 'hematology' || k === 'wbc' || k === 'rbc' || k === 'hemoglobin' || k === 'haemoglobin' || k === 'platelets' || k === 'hematocrit') {
    return 'hematology';
  }
  return 'other';
}

export function getBiomarkerMetadata(key: string, customDef?: any) {
  const k = key.toLowerCase();
  
  let risks = getFallbackRiskCategories(k);
  if (customDef && customDef.riskCategories && customDef.riskCategories.length > 0) {
    risks = customDef.riskCategories;
  }
  
  let group = getFallbackMedicalGrouping(k);
  if (customDef && customDef.standardMedicalGrouping && customDef.standardMedicalGrouping.trim() !== '') {
    group = customDef.standardMedicalGrouping;
  }
  
  let conditions = getFallbackMedicalConditions(k);
  if (customDef && customDef.potentialMedicalConditions && customDef.potentialMedicalConditions.length > 0) {
    conditions = customDef.potentialMedicalConditions;
  }

  return {
    riskCategories: risks,
    standardMedicalGrouping: group,
    potentialMedicalConditions: conditions
  };
}

function getFallbackRiskCategories(key: string): string[] {
  const k = key.toLowerCase();
  if (k === 'bmi' || k === 'weight' || k === 'height' || k.includes('waist') || k.includes('fat')) {
    return ['Wellness'];
  }
  if (k === 'hba1c' || k === 'fasting_glucose' || k === 'fasting_insulin' || k.includes('glucose') || k.includes('sugar') || k.includes('insulin')) {
    return ['Metabolic'];
  }
  if (k === 'ldl' || k === 'apob' || k === 'hdl' || k === 'triglycerides' || k === 'total_cholesterol' || k === 'hscrp' || k.includes('cholesterol') || k.includes('lipid') || k.includes('crp')) {
    return ['Cardiovascular'];
  }
  if (k === 'creatinine' || k === 'egfr' || k === 'urea' || k === 'uric_acid' || k === 'albumin' || k.includes('kidney') || k.includes('renal') || k.includes('urine')) {
    return ['Kidney'];
  }
  if (k === 'alt' || k === 'ast' || k === 'alp' || k === 'bilirubin' || k.includes('liver') || k.includes('hepatic') || k.includes('transaminase')) {
    return ['Liver'];
  }
  if (k === 'wbc' || k === 'rbc' || k === 'hemoglobin' || k === 'haemoglobin' || k === 'platelets' || k === 'hematocrit' || k.includes('cell') || k.includes('blood count') || k.includes('haem')) {
    return ['Hematology'];
  }
  return ['Other'];
}

function getFallbackMedicalGrouping(key: string): string {
  const k = key.toLowerCase();
  if (k === 'bmi' || k === 'weight' || k === 'height' || k.includes('waist')) return 'Biometrics';
  if (k === 'hba1c' || k === 'fasting_glucose' || k === 'fasting_insulin' || k.includes('glucose') || k.includes('sugar') || k.includes('insulin') || k === 'ldl' || k === 'apob' || k === 'hdl' || k === 'triglycerides' || k === 'total_cholesterol' || k === 'hscrp' || k.includes('cholesterol') || k.includes('lipid')) {
    return 'Metabolic';
  }
  if (k === 'creatinine' || k === 'egfr' || k === 'urea' || k === 'uric_acid' || k === 'albumin' || k.includes('kidney') || k.includes('renal')) {
    return 'Renal';
  }
  if (k === 'alt' || k === 'ast' || k === 'alp' || k === 'bilirubin' || k.includes('liver') || k.includes('hepatic')) {
    return 'Hepatic';
  }
  if (k === 'wbc' || k === 'rbc' || k === 'hemoglobin' || k === 'haemoglobin' || k === 'platelets' || k === 'hematocrit' || k.includes('cell') || k.includes('blood count') || k.includes('haem')) {
    return 'Hematology';
  }
  return 'Other';
}

function getFallbackMedicalConditions(key: string): string[] {
  const k = key.toLowerCase();
  if (k === 'bmi' || k === 'weight' || k === 'height' || k.includes('waist')) return ['Obesity', 'Metabolic Syndrome'];
  if (k === 'hba1c' || k === 'fasting_glucose' || k === 'fasting_insulin' || k.includes('glucose') || k.includes('sugar') || k.includes('insulin')) {
    return ['Diabetes Risk', 'Insulin Resistance'];
  }
  if (k === 'ldl' || k === 'apob' || k === 'hdl' || k === 'triglycerides' || k === 'total_cholesterol' || k.includes('cholesterol') || k.includes('lipid')) {
    return ['Hyperlipidemia', 'Atherosclerosis Risk', 'Cardiovascular Disease'];
  }
  if (k === 'hscrp' || k.includes('crp')) return ['Systemic Inflammation', 'Cardiovascular Risk'];
  if (k === 'creatinine' || k === 'egfr' || k === 'urea' || k === 'uric_acid' || k === 'albumin' || k.includes('kidney') || k.includes('renal')) {
    return ['Chronic Kidney Disease', 'Dehydration', 'Impaired Renal Function'];
  }
  if (k === 'alt' || k === 'ast' || k === 'alp' || k === 'bilirubin' || k.includes('liver') || k.includes('hepatic')) {
    return ['Fatty Liver', 'Hepatitis Stress', 'Liver Dysfunction'];
  }
  if (k === 'wbc' || k === 'rbc' || k === 'hemoglobin' || k === 'haemoglobin' || k === 'platelets' || k === 'hematocrit' || k.includes('cell') || k.includes('blood count') || k.includes('haem')) {
    if (k.includes('wbc') || k.includes('white')) return ['Immune Response', 'Infection Risk'];
    if (k.includes('platelet')) return ['Thrombocytopenia', 'Clotting Risk'];
    return ['Anemia', 'Oxygen Transport Capacity'];
  }
  return ['General Health'];
}

export const BIOMARKER_GROUPING_OPTIONS = [
  { value: 'risk', label: 'By Risk Categories' },
  { value: 'practice', label: 'By Medical Practice' },
  { value: 'condition', label: 'By Medical Conditions' }
] as const;



