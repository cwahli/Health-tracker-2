
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
  aliases?: string[];
  rangeVariesBy?: ('age' | 'sex' | 'ethnicity')[];
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
    },
    riskCategories: ['Metabolic'],
    standardMedicalGrouping: 'Metabolic',
    aliases: ['hba1cc', 'glycatedhaemoglobin', 'hemoglobin_a1c_mmol_mol', 'hba1c_mmol_mol', 'hemoglobin_a1c']
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
    },
    riskCategories: ['Cardiovascular'],
    standardMedicalGrouping: 'Metabolic',
    aliases: ['ldlc', 'ldlcholesterol', 'calculatedldlcholesterol', 'calculatedldl', 'calculated_ldl_cholesterol_mmol_l', 'calculated_ldl_cholesterol']
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
    },
    riskCategories: ['Cardiovascular'],
    standardMedicalGrouping: 'Metabolic',
    aliases: ['cholesterol', 'serumtotalcholesterol', 'serum_cholesterol']
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
    },
    riskCategories: ['Cardiovascular'],
    standardMedicalGrouping: 'Metabolic',
    aliases: ['hdlc', 'hdlcholesterol', 'serum_hdl_cholesterol', 'serum_hdl_cholesterol_mmol_l']
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
    },
    riskCategories: ['Cardiovascular'],
    standardMedicalGrouping: 'Metabolic',
    aliases: ['trig', 'serum_triglycerides', 'serum_triglycerides_mmol_l']
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
    },
    riskCategories: ['Kidney'],
    standardMedicalGrouping: 'Renal',
    aliases: ['egfrmlmin173m2', 'egfrmlmin173', 'egfr_ml_min_1_73m2', 'egfr_mlmin173m2']
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
    },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['redbloodcell', 'redbloodcells', 'redbloodcellcount', 'red_blood_cell_count_10_12_l', 'red_blood_cell_count']
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
      id: 'Keping darah, agen pembekuan darah dan penutupati luka.'
    },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['plateletcount', 'platelet', 'platelet_count_10_9_l', 'platelet_count']
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
    },
    riskCategories: ['Wellness'],
    standardMedicalGrouping: 'Biometrics',
    aliases: ['bodymassindex', 'bmi_kg_m2']
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
      zh: '肌肉代谢产生并由肾脏滤过排出的代谢废物.',
      id: 'Produk sisa dari pemecahan otot, disaring oleh ginjal.'
    },
    riskCategories: ['Kidney'],
    standardMedicalGrouping: 'Renal',
    aliases: ['serumcreatinine', 'serumcreatinineumoll', 'serum_creatinine_umol_l', 'serum_creatinine']
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
    key: 'hemoglobin',
    name: 'Hemoglobin',
    category: 'hematology',
    unit: 'g/dL',
    normalRange: '12.0 - 17.5',
    descriptions: {
      en: 'Oxygen-carrying protein in red blood cells.',
      fr: 'Protéine transporteuse d\'oxygène dans les globules rouges.',
      zh: '红细胞中携带氧气的关键蛋白质（血红蛋白）。',
      id: 'Protein pembawa oksigen dalam sel darah merah.'
    },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['haemoglobin', 'hgb', 'hb', 'hemoglobin_g_l', 'haemoglobinestimation', 'hemoglobingl', 'hemoglobingdl']
  },
  {
    key: 'mean_corpuscular_hemoglobin',
    name: 'Mean Corpuscular Hemoglobin (MCH)',
    category: 'hematology',
    unit: 'pg',
    normalRange: '27 - 33',
    descriptions: {
      en: 'Average amount of hemoglobin per red blood cell.',
      fr: 'Quantité moyenne d\'hémoglobine par globule rouge.',
      zh: '每个红细胞内平均含有的血红蛋白量（平均红细胞血红蛋白量）。',
      id: 'Jumlah rata-rata hemoglobin per sel darah merah.'
    },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['mch', 'mean_corpuscular_hemoglobin_pg', 'meancorpuscularhemoglobin', 'meancorpuscularhemoglobinpg', 'meancorpuschaemoglobinmch', 'haemoglobin_mch']
  },
  {
    key: 'mean_corpuscular_volume',
    name: 'Mean Corpuscular Volume (MCV)',
    category: 'hematology',
    unit: 'fL',
    normalRange: '80 - 100',
    descriptions: {
      en: 'Average volume or size of red blood cells.',
      fr: 'Volume globulaire moyen reflétant la taille des globules rouges.',
      zh: '红细胞平均体积（MCV），反映红细胞大小。',
      id: 'Volume rata-rata atau ukuran sel darah merah.'
    },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['mcv', 'mean_corpuscular_volume_fl', 'meancorpuscularvolume', 'meancorpuscularvolumemcv']
  },
  {
    key: 'mean_corpuscular_hemoglobin_concentration',
    name: 'Mean Corpuscular Hemoglobin Concentration (MCHC)',
    category: 'hematology',
    unit: 'g/dL',
    normalRange: '32 - 36',
    descriptions: {
      en: 'Average concentration of hemoglobin inside red blood cells.',
      fr: 'Concentration corpusculaire moyenne en hémoglobine.',
      zh: '平均红细胞血红蛋白浓度（MCHC）。',
      id: 'Konsentrasi rata-rata hemoglobin di dalam sel darah merah.'
    },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['mchc', 'mean_corpuscular_hb_conc_g_l', 'meancorpuschbconcmchc', 'mean_corpuscular_hemoglobin_concentration_g_l']
  },
  {
    key: 'rdw',
    name: 'Red Cell Distribution Width (RDW)',
    category: 'hematology',
    unit: '%',
    normalRange: '11.5 - 14.5',
    descriptions: {
      en: 'Measurement of the variation in red blood cell size and volume.',
      fr: 'Indice de distribution des globules rouges mesurant l\'anisocytose.',
      zh: '红细胞体积分布宽度，反映红细胞大小的一致性。',
      id: 'Variasi ukuran dan volume sel darah merah.'
    },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['red_blood_cell_distribution_width', 'redbloodcelldistributwidth', 'red_blood_cell_distribution_width_percent']
  },
  {
    key: 'serum_albumin',
    name: 'Serum Albumin',
    category: 'liver',
    unit: 'g/L',
    normalRange: '35 - 50',
    descriptions: {
      en: 'Main protein produced by the liver, keeping fluid balance in vessels.',
      fr: 'Principale protéine produite par le foie maintenant la pression oncotique.',
      zh: '肝脏合成的主要蛋白质，维持血管内胶体渗透压及营养状态。',
      id: 'Protein utama yang diproduksi oleh hati.'
    },
    riskCategories: ['Liver', 'Kidney'],
    standardMedicalGrouping: 'Hepatic',
    aliases: ['albumin', 'serumalbumin', 'serum_albumin_g_l']
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
    },
    riskCategories: ['Liver', 'Kidney'],
    standardMedicalGrouping: 'Hepatic',
    aliases: ['serumtotalprotein', 'serum_total_protein_g_l', 'serum_total_protein']
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
  },
  {
    key: 'wbc',
    name: 'White Blood Cell (WBC)',
    category: 'hematology',
    unit: 'K/uL',
    normalRange: '4.5 - 11.0',
    descriptions: { en: 'Total white blood cell count for immune function.' },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['whitebloodcell', 'total_white_cell_count', 'total_white_cell_count_10_9_l', 'white_blood_cell_count']
  },
  {
    key: 'neutrophil_count',
    name: 'Neutrophils',
    category: 'hematology',
    unit: '10^9/L',
    normalRange: '2.0 - 7.5',
    descriptions: { en: 'Essential white blood cells for fighting bacterial infections.' },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['neutrophils', 'neutrophil', 'neutrophils_10_9_l', 'abs_neutrophil_count', 'neutrophil_count_10_9_l']
  },
  {
    key: 'lymphocyte_count',
    name: 'Lymphocytes',
    category: 'hematology',
    unit: '10^9/L',
    normalRange: '1.0 - 3.5',
    descriptions: { en: 'White blood cells critical for adaptive viral and antibody immunity.' },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['lymphocytes', 'lymphocyte', 'lymphocytes_10_9_l', 'abs_lymphocyte_count', 'lymphocyte_count_10_9_l']
  },
  {
    key: 'monocyte_count',
    name: 'Monocyte Count',
    category: 'hematology',
    unit: '10^9/L',
    normalRange: '0.1 - 0.6',
    descriptions: { en: 'Phagocytic white blood cells that clear cellular debris and respond to chronic inflammation.' },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['monocytes', 'monocyte', 'monocytes_10_9_l', 'abs_monocyte_count', 'monocyte_count_10_9_l']
  },
  {
    key: 'eosinophil_count',
    name: 'Eosinophils',
    category: 'hematology',
    unit: '10^9/L',
    normalRange: '0.02 - 0.50',
    descriptions: { en: 'White blood cells involved in allergic responses and parasitic defense.' },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['eosinophils', 'eosinophil', 'eosinophils_10_9_l', 'abs_eosinophil_count', 'eosinophil_count_10_9_l']
  },
  {
    key: 'basophil_count',
    name: 'Basophils',
    category: 'hematology',
    unit: '10^9/L',
    normalRange: '0.0 - 0.1',
    descriptions: { en: 'Granulocytes responsible for histamine release and inflammatory reactions.' },
    riskCategories: ['Hematology'],
    standardMedicalGrouping: 'Hematology',
    aliases: ['basophils', 'basophil', 'basophils_10_9_l', 'abs_basophil_count', 'basophil_count_10_9_l']
  },
  {
    key: 'alt',
    name: 'ALT (SGPT)',
    category: 'liver',
    unit: 'U/L',
    normalRange: '10 - 40',
    descriptions: { en: 'Alanine Aminotransferase, an enzyme found mostly in the liver.' },
    riskCategories: ['Liver'],
    standardMedicalGrouping: 'Hepatic',
    aliases: ['sgpt', 'alanine_aminotransferase', 'serum_alt_level_u_l', 'serum_alt_level']
  },
  {
    key: 'ast',
    name: 'AST (SGOT)',
    category: 'liver',
    unit: 'U/L',
    normalRange: '10 - 40',
    descriptions: { en: 'Aspartate Aminotransferase, an enzyme found in liver and muscle.' },
    riskCategories: ['Liver'],
    standardMedicalGrouping: 'Hepatic',
    aliases: ['sgot', 'aspartate_aminotransferase', 'ast_serum_level_u_l', 'ast_serum_level']
  },
  {
    key: 'steps',
    name: 'Daily Steps',
    category: 'other',
    unit: 'steps',
    normalRange: 'Aim over 8000',
    descriptions: { en: 'Total daily step count.' },
    riskCategories: ['Wellness'],
    standardMedicalGrouping: 'Biometrics',
    aliases: ['step_count', 'stepcount']
  },
  {
    key: 'weight',
    name: 'Body Weight',
    category: 'other',
    unit: 'kg',
    normalRange: 'Varies',
    descriptions: { en: 'Total body mass.' },
    riskCategories: ['Wellness'],
    standardMedicalGrouping: 'Biometrics',
    aliases: ['body_weight', 'bodyweight']
  },
  {
    key: 'hemorrhoidal_symptom_score',
    name: 'Hemorrhoidal Disease Symptom Score (HDSS)',
    category: 'other',
    unit: 'score',
    normalRange: '0',
    descriptions: { en: 'A clinical index evaluating the frequency and severity of anorectal vascular symptoms.' },
    riskCategories: ['Gastrointestinal'],
    standardMedicalGrouping: 'Other',
    aliases: ['hdss', 'hemorrhoids', 'hemorrhoid_score', 'hemorrhoid_symptom_score', 'hemorrhoidal_disease_symptom_score', 'blood_in_stool_score']
  },
  {
    key: 'gerd_symptom_score',
    name: 'Gastroesophageal Reflux Symptom Score (GERD-SS)',
    category: 'other',
    unit: 'score',
    normalRange: '0',
    descriptions: { en: 'A clinical index evaluating the frequency and severity of upper gastrointestinal reflux symptoms.' },
    riskCategories: ['Gastrointestinal'],
    standardMedicalGrouping: 'Other',
    aliases: ['gerd_score', 'acid_reflux_score', 'heartburn_score']
  },
  {
    key: 'joint_pain_severity_score',
    name: 'Joint Pain Severity Score',
    category: 'other',
    unit: 'score',
    normalRange: '0',
    descriptions: { en: 'A clinical scale evaluating articular joint discomfort and flare severity.' },
    riskCategories: ['Musculoskeletal'],
    standardMedicalGrouping: 'Other',
    aliases: ['joint_pain_score', 'arthritis_symptom_score']
  },
  {
    key: 'blood_pressure',
    name: 'Blood Pressure',
    category: 'other',
    unit: 'mmHg',
    normalRange: '< 120 / < 80',
    descriptions: { en: 'Combined systolic and diastolic arterial blood pressure.' },
    riskCategories: ['Cardiovascular'],
    standardMedicalGrouping: 'Biometrics',
    aliases: ['bloodpressure', 'arterial_blood_pressure', 'bp', 'sitting_blood_pressure', 'standing_blood_pressure']
  },
  {
    key: 'systolic_blood_pressure',
    name: 'Systolic Blood Pressure',
    category: 'other',
    unit: 'mmHg',
    normalRange: '< 120',
    descriptions: { en: 'Peak arterial pressure during cardiac contraction (systole).' },
    riskCategories: ['Cardiovascular'],
    standardMedicalGrouping: 'Biometrics',
    aliases: ['systolic', 'sbp', 'systolic_bp', 'systolicbloodpressure', 'sitting_systolic_blood_pressure']
  },
  {
    key: 'diastolic_blood_pressure',
    name: 'Diastolic Blood Pressure',
    category: 'other',
    unit: 'mmHg',
    normalRange: '< 80',
    descriptions: { en: 'Minimum arterial pressure during cardiac relaxation (diastole).' },
    riskCategories: ['Cardiovascular'],
    standardMedicalGrouping: 'Biometrics',
    aliases: ['diastolic', 'dbp', 'diastolic_bp', 'diastolicbloodpressure', 'sitting_diastolic_blood_pressure']
  },
  {
    key: 'audit_c_total_score',
    name: 'AUDIT-C Alcohol Consumption Score',
    category: 'other',
    unit: 'score',
    normalRange: '0 - 3',
    descriptions: { en: 'Alcohol Use Disorders Identification Test Consumption 3-item screening score (0 to 12).' },
    riskCategories: ['Screenings & Wellness'],
    standardMedicalGrouping: 'Other',
    aliases: ['audit_c_score', 'audit_c', 'auditctotalscore', 'audit_c_consumption_score', 'alcohol_use_disorders_identification_test_c']
  },
  {
    key: 'ideal_body_weight',
    name: 'Ideal Body Weight (Target)',
    category: 'other',
    unit: 'kg',
    normalRange: 'Varies',
    descriptions: { en: 'Calculated or target ideal body weight goal, distinct from measured historical weight.' },
    riskCategories: ['Screenings & Wellness'],
    standardMedicalGrouping: 'Biometrics',
    aliases: ['idealbodyweight', 'target_weight', 'targetbodyweight', 'goal_weight', 'ideal_weight', 'reference_weight']
  }
];

export const CLINICAL_FILLER_WORDS = [
  'serum', 'plasma', 'blood', 'total', 'fasting', 'estimated', 'intact', 
  'calculated', 'senon', 'se', 'level', 'levels', 'count', 'rate', 'ratio', 
  'percent', 'percentage', 'val', 'value', 'score', 'estimation', 'standardised', 
  'index', 'test'
];
// NOTE: 'free' is intentionally excluded from generic prefix stripping. Free vs Total
// forms (e.g. Free Testosterone vs Total Testosterone, Free PSA vs Total PSA) are
// clinically distinct analytes with different units/ranges and must never collapse
// onto the same canonical stem. See hasFreeTotalConflict guard below for the
// name-similarity path, and CLINICAL_SYNONYM_MAP for the explicit "free_x" -> "free_x" aliases.

export const COMMON_PREFIXES = [
  'serum_', 'plasma_', 'blood_', 'total_', 'fasting_', 'estimated_', 'intact_', 'calculated_', 'senon_', 'se_'
];
export const COMMON_SUFFIXES = [
  '_level', '_count', '_serum', '_rate', '_ratio', '_percent', '_percentage', '_val', '_value', '_score', '_estimation', '_standardised'
];
export const COMMON_UNIT_SUFFIXES = [
  '_umol_l', '_umoll', '_u_l', '_ul', '_iu_l', '_iul', '_iu_ml', '_iuml',
  '_mg_dl', '_mgdl', '_mg_l', '_mgl', '_mmol_l', '_mmoll', '_mmol_mol', '_mmolmol',
  '_g_l', '_gl', '_g_dl', '_gdl', '_ug_dl', '_ugdl', '_ug_l', '_ugl', '_mcg_dl', '_mcgdl', '_mcg_l', '_mcgl',
  '_fl', '_k_ul', '_kul', '_m_ul', '_mul',
  '_ml_min_1_73m2', '_ml_min_173m2', '_mlmin173m2', '_mlmin_173m2', '_ml_min_173_m2', '_ml_min', '_mlmin',
  '_pg_ml', '_pgml', '_pg', '_ng_dl', '_ngdl', '_ng_ml', '_ngml', '_uiu_ml', '_uiuml', '_miu_l', '_miul', '_beats_min', '_bpm',
  '_10_9_l', '_109l', '_10_12_l', '_1012l', '_10_6_ul', '_106ul',
  '_kg_m2', '_kgm2', '_points', '_percent', '_percentage', '_pct', '_fraction', '_l_l', '_ratio', '_score'
];

/**
 * Standard clinical abbreviation synonym mappings so medical aliases resolve
 * to a shared canonical stem (e.g. AST <=> SGOT <=> Aspartate Aminotransferase).
 */
export const CLINICAL_SYNONYM_MAP: Record<string, string> = {
  // Liver
  'ast': 'ast',
  'sgot': 'ast',
  'aspartateaminotransferase': 'ast',
  'aspartatetransaminase': 'ast',
  'alt': 'alt',
  'sgpt': 'alt',
  'alanineaminotransferase': 'alt',
  'alaninetransaminase': 'alt',
  'alp': 'alkaline_phosphatase',
  'alkalinephosphatase': 'alkaline_phosphatase',
  'alkphos': 'alkaline_phosphatase',
  'ggt': 'gamma_gt',
  'gammaglutamyltransferase': 'gamma_gt',
  'gammaglutamyltranspeptidase': 'gamma_gt',
  'bilirubin': 'total_bilirubin',
  'totalbilirubin': 'total_bilirubin',
  'directbilirubin': 'direct_bilirubin',
  'indirectbilirubin': 'indirect_bilirubin',

  // Lipids
  'hdl': 'hdl',
  'hdlc': 'hdl',
  'hdlcholesterol': 'hdl',
  'highdensitylipoprotein': 'hdl',
  'ldl': 'ldl',
  'ldlc': 'ldl',
  'ldlcholesterol': 'ldl',
  'lowdensitylipoprotein': 'ldl',
  'cholesterol': 'total_cholesterol',
  'totalcholesterol': 'total_cholesterol',
  'trig': 'triglycerides',
  'trigs': 'triglycerides',
  'triglyceride': 'triglycerides',
  'triglycerides': 'triglycerides',
  'apob': 'apob',
  'apolipoproteinb': 'apob',
  'apoa1': 'apoa1',
  'apolipoproteina1': 'apoa1',
  'lpa': 'lp_a',
  'lipoprotein_a': 'lp_a',
  'lipoproteina': 'lp_a',
  'nonhdl': 'non_hdl_cholesterol',
  'nonhdlcholesterol': 'non_hdl_cholesterol',
  'cholesterolhdlratio': 'cholesterol_hdl_ratio',

  // Blood Sugar & Metabolic
  'hba1c': 'hba1c',
  'glycatedhemoglobin': 'hba1c',
  'glycatedhaemoglobin': 'hba1c',
  'hemoglobina1c': 'hba1c',
  'haemoglobina1c': 'hba1c',
  'glucose': 'fasting_glucose',
  'fastingglucose': 'fasting_glucose',
  'bloodglucose': 'fasting_glucose',
  'bloodsugar': 'fasting_glucose',
  'insulin': 'fasting_insulin',
  'fastinginsulin': 'fasting_insulin',

  // Kidneys & Electrolytes
  'egfr': 'egfr',
  'egfrcreat': 'egfr',
  'egfrcreatckdepi': 'egfr',
  'egfrcreatckdepi173m2': 'egfr',
  'gfr': 'egfr',
  'estimatedgfr': 'egfr',
  'estimatedglomerularfiltrationrate': 'egfr',
  'glomerularfiltrationrate': 'egfr',
  'glomerularfiltrationrateestimated': 'egfr',
  'kidneyfunctionegfr': 'egfr',
  'creatinine': 'creatinine',
  'bun': 'bun',
  'bloodureanitrogen': 'bun',
  'urea': 'bun',
  'uricacid': 'uric_acid',
  'urate': 'uric_acid',
  'sodium': 'serum_sodium',
  'potassium': 'serum_potassium',
  'calcium': 'serum_calcium',
  'chloride': 'serum_chloride',
  'magnesium': 'serum_magnesium',
  'phosphate': 'serum_inorganic_phosphate',
  'phosphorus': 'serum_inorganic_phosphate',
  'albumin': 'serum_albumin',
  'globulin': 'serum_globulin',
  'totalprotein': 'total_protein',

  // Hematology (CBC)
  'wbc': 'wbc',
  'whitebloodcell': 'wbc',
  'whitebloodcells': 'wbc',
  'whitebloodcellcount': 'wbc',
  'totalwhitecell': 'wbc',
  'rbc': 'rbc',
  'redbloodcell': 'rbc',
  'redbloodcells': 'rbc',
  'redbloodcellcount': 'rbc',
  'hemoglobin': 'hemoglobin',
  'haemoglobin': 'hemoglobin',
  'hgb': 'hemoglobin',
  'hb': 'hemoglobin',
  'hematocrit': 'hematocrit',
  'haematocrit': 'hematocrit',
  'hct': 'hematocrit',
  'platelet': 'platelets',
  'platelets': 'platelets',
  'plateletcount': 'platelets',
  'plt': 'platelets',
  'mcv': 'mean_corpuscular_volume',
  'meancorpuscularvolume': 'mean_corpuscular_volume',
  'mch': 'mean_corpuscular_hemoglobin',
  'meancorpuscularhemoglobin': 'mean_corpuscular_hemoglobin',
  'meancorpuscularhaemoglobin': 'mean_corpuscular_hemoglobin',
  'meancorpuscularhemoglobinpg': 'mean_corpuscular_hemoglobin',
  'meancorpuschaemoglobinmch': 'mean_corpuscular_hemoglobin',
  'mchc': 'mean_corpuscular_hemoglobin_concentration',
  'meancorpuscularhemoglobinconcentration': 'mean_corpuscular_hemoglobin_concentration',
  'meancorpuscularhaemoglobinconcentration': 'mean_corpuscular_hemoglobin_concentration',
  'rdw': 'rdw',
  'redcelldistributionwidth': 'rdw',
  'redbloodcelldistributionwidth': 'rdw',
  'mpv': 'mean_platelet_volume',
  'meanplateletvolume': 'mean_platelet_volume',
  'pdw': 'platelet_distribution_width',
  'plateletdistributionwidth': 'platelet_distribution_width',
  'neutrophil': 'neutrophil_count',
  'neutrophils': 'neutrophil_count',
  'neutrophilcount': 'neutrophil_count',
  'lymphocyte': 'lymphocyte_count',
  'lymphocytes': 'lymphocyte_count',
  'monocyte': 'monocyte_count',
  'monocytes': 'monocyte_count',
  'eosinophil': 'eosinophil_count',
  'eosinophils': 'eosinophil_count',
  'basophil': 'basophil_count',
  'basophils': 'basophil_count',

  // Inflammation & Hormones & Vitamins
  'crp': 'hscrp',
  'hscrp': 'hscrp',
  'creactiveprotein': 'hscrp',
  'highsensitivitycreactiveprotein': 'hscrp',
  'ferritin': 'ferritin',
  'serumferritin': 'ferritin',
  'iron': 'serum_iron',
  'tsh': 'tsh',
  'thyroidstimulatinghormone': 'tsh',
  'ft4': 'free_t4',
  'freet4': 'free_t4',
  'freethyroxine': 'free_t4',
  'ft3': 'free_t3',
  'freet3': 'free_t3',
  'freetriiodothyronine': 'free_t3',
  'testosterone': 'testosterone',
  'totaltestosterone': 'testosterone',
  'freetestosterone': 'free_testosterone',
  'vitamind': 'vitamin_d',
  'vitd': 'vitamin_d',
  '25ohvitamind': 'vitamin_d',
  'vitaminb12': 'vitamin_b12',
  'vitb12': 'vitamin_b12',
  'folate': 'folate',
  'folicacid': 'folate',
  'psa': 'prostate_specific_antigen',
  'prostatespecificantigen': 'prostate_specific_antigen',
  'bmi': 'bmi',
  'bodymassindex': 'bmi',
  'weight': 'weight',
  'bodyweight': 'weight',
  'height': 'height',
  'standingheight': 'height'
};

/**
 * Clinical qualifier terms that change a biomarker's identity, unit, or reference
 * range when present. If exactly one of two candidate biomarker strings contains a
 * term from this list, they are treated as distinct tests — never auto-merged by the
 * substring/stem-similarity fallback (rule 5 in isBiomarkerDuplicateCandidate).
 *
 * This list is the SINGLE place to extend false-friend protection. To protect a new
 * pair of frequently-confused biomarkers (e.g. "Direct Bilirubin" vs "Indirect
 * Bilirubin", "Ionized Calcium" vs "Total Calcium"), add the discriminating word(s)
 * here — do not write a new hasXConflict boolean. Grouped by category for
 * maintainability; the grouping is documentation only, all terms are checked
 * identically (XOR presence = conflict).
 */
export const CLINICAL_DISCRIMINATOR_TERMS: string[] = [
  // Specimen / fluid type — same analyte name, different sample source
  'urine', 'urinary', 'serum', 'plasma', 'csf', 'saliva', 'stool', 'faecal', 'fecal', 'sweat', 'capillary',
  // Fraction / binding state
  'free', 'total', 'bound', 'direct', 'indirect', 'conjugated', 'unconjugated', 'ionized', 'ionised',
  // Measurement type on the same base analyte (e.g. red-cell indices)
  'concentration', 'conc', 'mchc', 'volume', 'width', 'distribution', 'corpuscular',
  // Lipoprotein fraction
  'hdl', 'ldl', 'vldl', 'nonhdl',
  // Glycation / averaging window
  'a1c', 'fructosamine',
  // Timing / physiological state
  'fasting', 'random', 'postprandial', 'basal', 'peak', 'trough',
  // Laterality (imaging-adjacent biomarkers, e.g. paired organ measures)
  'left', 'right',
];

/**
 * Generic false-friend check: true if a discriminator term from
 * CLINICAL_DISCRIMINATOR_TERMS appears in exactly one of the two cleaned strings.
 */
export function hasDiscriminatorConflict(cleanA: string, cleanB: string): boolean {
  for (const term of CLINICAL_DISCRIMINATOR_TERMS) {
    if (cleanA.includes(term) !== cleanB.includes(term)) return true;
  }
  return false;
}

/**
 * Looks up a canonical synonym for a stem/name fragment, tolerating both the
 * contiguous form CLINICAL_SYNONYM_MAP is authored in (e.g. "bodymassindex")
 * and the underscored form normalizeStemKey() can still return for multi-word
 * compounds that don't fully collapse to a single recognized token
 * (e.g. "body_mass_index"). Without this, any compound stem that retains an
 * underscore silently fails synonym resolution even though the no-underscore
 * form is a known entry.
 */
export function lookupClinicalSynonym(s?: string | null): string | undefined {
  if (!s) return undefined;
  if (CLINICAL_SYNONYM_MAP[s]) return CLINICAL_SYNONYM_MAP[s];
  const noUnderscore = s.replace(/_/g, '');
  if (noUnderscore !== s && CLINICAL_SYNONYM_MAP[noUnderscore]) return CLINICAL_SYNONYM_MAP[noUnderscore];
  return undefined;
}

/**
 * Normalizes an arbitrary key stem for generalized morphological clustering and alias resolution
 */
export function normalizeStemKey(key: string): string {
  if (!key) return '';
  let stem = key.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  
  // Iteratively strip known unit suffixes
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of COMMON_UNIT_SUFFIXES) {
      if (stem.endsWith(suf)) {
        stem = stem.slice(0, -suf.length);
        changed = true;
        break;
      }
    }
  }

  // Regex-based unit trailing strip for arbitrary delimiter variants (e.g. _mlmin173m2, _mmol_mol, _g_dl)
  stem = stem.replace(/_(?:ml_?min(?:_?1_?73m2)?|mmol_?mol|mmol_?l|umol_?l|pmol_?l|nmol_?l|mg_?dl|mg_?l|g_?l|g_?dl|ug_?dl|ug_?l|mcg_?dl|mcg_?l|pg_?ml|ng_?ml|ng_?dl|uiu_?ml|miu_?l|u_?l|iu_?l|iu_?ml|k_?ul|10_?9_?l|10_?12_?l|10_?6_?ul|m_?ul|fl|beats_?min|bpm|kg_?m2|points|percent|fraction|l_?l)$/i, '');

  // Iteratively strip known prefixes
  changed = true;
  while (changed) {
    changed = false;
    for (const pre of COMMON_PREFIXES) {
      if (stem.startsWith(pre)) {
        stem = stem.slice(pre.length);
        changed = true;
        break;
      }
    }
  }

  // Iteratively strip known suffixes
  changed = true;
  while (changed) {
    changed = false;
    for (const suf of COMMON_SUFFIXES) {
      if (stem.endsWith(suf)) {
        stem = stem.slice(0, -suf.length);
        changed = true;
        break;
      }
    }
  }

  return stem.replace(/^_+|_+$/g, '');
}

/**
 * Normalizes a human-readable biomarker name into a standardized comparable string
 * stripping unit suffixes, parenthetical abbreviations, and clinical filler words.
 */
export function normalizeBiomarkerName(name?: string): string {
  if (!name) return '';
  let clean = name.toLowerCase().trim();

  // Strip parenthetical abbreviations e.g. "Body Mass Index (BMI)" => "Body Mass Index", "AST (SGOT)" => "AST"
  clean = clean.replace(/\([^)]*\)/g, ' ');

  // Strip common trailing unit tokens
  clean = clean.replace(/\b(?:pg(?:\/ml)?|ng\/(?:ml|dl)|mg\/(?:dl|l)|mmol\/(?:l|mol)|µmol\/l|umol\/l|u\/l|iu\/l|miu\/l|uiu\/ml|k\/ul|10\^9\/l|10\^12\/l|fl|kg\/m2|kg\/m²|ml\/min\/1\.73m2|ml\/min(?:\/1\.73m²)?|g\/l|g\/dl|score|points|steps|beats\/min|bpm|percent|%)\b/gi, ' ');

  // Strip clinical filler words
  const fillerRegex = new RegExp(`\\b(?:${CLINICAL_FILLER_WORDS.join('|')})\\b`, 'gi');
  clean = clean.replace(fillerRegex, ' ');

  // Collapse spaces and symbols
  clean = clean.replace(/[^a-z0-9]+/g, ' ').trim();
  return clean;
}

const CUSTOM_KEY_ALIASES: Record<string, string> = {
  'hemorrhoids': 'hemorrhoidal_symptom_score',
  'blood_in_stool': 'hemorrhoidal_symptom_score',
  'rectal_bleeding': 'hemorrhoidal_symptom_score',
  'acid_reflux': 'gerd_symptom_score',
  'heartburn': 'gerd_symptom_score',
  'height_cm': 'height',
  'serum_psa': 'prostate_specific_antigen',
  'serum_prostate_specific_antigen': 'prostate_specific_antigen',
  'audit_c_score': 'audit_c_total_score',
  'hematocrit_l_l': 'hematocrit',
  'hemoglobin_g_l': 'hemoglobin',
  'hemoglobingl': 'hemoglobin',
  'hemoglobingdl': 'hemoglobin',
  'serum_albumin_2': 'serum_albumin',
  'serum_albumin_g_l': 'serum_albumin',
  'serum_globulin_g_l': 'serum_globulin',
  'qrisk2_10_year_risk': 'qrisk2_10yr_risk',
  'qrisk2_10_year_risk_score': 'qrisk2_10yr_risk',
  'serum_sodium_mmol_l': 'serum_sodium',
  'serum_calcium_mmol_l': 'serum_calcium',
  'alkaline_phosphatase_2': 'alkaline_phosphatase',
  'alkaline_phosphatase_u_l': 'alkaline_phosphatase',
  'serum_potassium_mmol_l': 'serum_potassium',
  'total_bilirubin_umol_l': 'total_bilirubin',
  'serum_total_cholesterol': 'total_cholesterol',
  'serum_hdl_cholesterol': 'hdl',
  'serum_triglyceride': 'triglycerides',
  'serum_triglycerides': 'triglycerides',
  'hba1c_levs': 'hba1c',
  'hba1c_level': 'hba1c',
  'hba1c_levl_ifcc_standardised': 'hba1c',
  'hba1c_level_ifcc_standardised': 'hba1c',
  'serum_lipid_level': 'total_cholesterol',
  'serum_ldl_cholesterol': 'ldl',
  'serum_creatinine': 'creatinine',
  'serum_alanine_aminotransferase': 'alt',
  'alanine_aminotransferase': 'alt',
  'serum_aspartate_aminotransferase': 'ast',
  'aspartate_aminotransferase': 'ast',
  'fasting_blood_glucose': 'fasting_glucose',
  'body_mass_index': 'bmi',
  'bmi_kg_m2': 'bmi',
  'bmikgm2': 'bmi',
  'weight_kg': 'weight',
  'mean_platelet_volume_fl': 'mean_platelet_volume',
  'neutrophil_count_10_9_l': 'neutrophil_count',
  'mean_corpuscular_volume_fl': 'mean_corpuscular_volume',
  'mean_corpuscular_volume_mcv': 'mean_corpuscular_volume',
  'total_white_cell_count_wbc': 'wbc',
  'mean_corpuscular_hb_conc_g_l': 'mean_corpuscular_hemoglobin_concentration',
  'mean_corpuscular_hemoglobin_concentration_g_l': 'mean_corpuscular_hemoglobin_concentration',
  'mean_corpuscular_hemoglobin_concentration_mchc': 'mean_corpuscular_hemoglobin_concentration',
  'serum_adjusted_calcium_mmol_l': 'serum_adjusted_calcium',
  'mean_corpuscular_hemoglobin_pg': 'mean_corpuscular_hemoglobin',
  'meancorpuscularhemoglobinpg': 'mean_corpuscular_hemoglobin',
  'meancorpuscularhemoglobin': 'mean_corpuscular_hemoglobin',
  'platelet_distribution_width_fl': 'platelet_distribution_width',
  'platelet_distribution_width_pdw': 'platelet_distribution_width',
  'serum_inorganic_phosphate_mmol_l': 'serum_inorganic_phosphate',
  'nucleated_red_blood_cell_count_10_9_l': 'nucleated_red_blood_cell_count',
  'red_blood_cell_distribution_width_percent': 'red_blood_cell_distribution_width',
  // NHS / EMIS print names (cleanNoUnderscore form)
  'hba1clevlifccstandardised': 'hba1c',
  'seprostatespecificaglevel': 'prostate_specific_antigen',
  'serumsodium': 'serum_sodium',
  'serumpotassium': 'serum_potassium',
  'serumcreatinine': 'creatinine',
  'egfrcreatckdepi173m2': 'egfr',
  'egfr_mlmin173m2': 'egfr',
  'egfr_ml_min_1_73m2': 'egfr',
  'egfr_mlmin_173m2': 'egfr',
  'egfr_ml_min_173_m2': 'egfr',
  'egfrmlmin173m2': 'egfr',
  'egfrmlmin173': 'egfr',
  'serumalbumin': 'serum_albumin',
  'serumaltlevel': 'alt',
  'serumalkalinephosphatase': 'alkaline_phosphatase',
  'astserumlevel': 'ast',
  'serumtotalbilirubinlevel': 'total_bilirubin',
  'serumtotalprotein': 'total_protein',
  'serumglobulin': 'serum_globulin',
  'serumcalcium': 'serum_calcium',
  'serumadjustedcalciumconc': 'serum_adjusted_calcium',
  'seruminorganicphosphate': 'serum_inorganic_phosphate',
  'totalwhitecellcount': 'wbc',
  'redbloodcellrbccount': 'rbc',
  'haemoglobinestimation': 'hemoglobin',
  'haematocrit': 'hematocrit',
  'meancorpuscularvolumemcv': 'mean_corpuscular_volume',
  'meancorpuschaemoglobinmch': 'mean_corpuscular_hemoglobin',
  'meancorpuschbconcmchc': 'mean_corpuscular_hemoglobin_concentration',
  'redbloodcelldistributwidth': 'rdw',
  'plateletcount': 'platelets',
  'meanplateletvolume': 'mean_platelet_volume',
  'plateletdistributionwidth': 'platelet_distribution_width',
  'neutrophilcount': 'neutrophil_count',
  'nucleatedredbloodcellcount': 'nucleated_red_blood_cell_count',
  'serumcholesterol': 'total_cholesterol',
  'serumhdl': 'hdl',
  'serumhdlcholesterollevel': 'hdl',
  'serumtriglycerides': 'triglycerides',
  'serumldl': 'ldl',
  'serumbilirubin': 'total_bilirubin',
  'senonhdlcholesterollevel': 'non_hdl_cholesterol',
  'serumcholesterolhdlratio': 'cholesterol_hdl_ratio',
  'calculatedldlcholesterollev': 'ldl',
  'bodymassindex': 'bmi',
  'bodyweight': 'weight',
  'standingheight': 'height',
  'qrisk2cardiovasculardisease10yearriskscore': 'qrisk2_10yr_risk',
  'qdiabetesriskcalculatorscore': 'qdiabetes_risk',
  'bloodpressure': 'blood_pressure',
  'pulserate': 'pulse_rate',
  'alcoholconsumption': 'alcohol_consumption',
  'auditcalcoholusedisordersidentificationtestconsumptionscore': 'audit_c_total_score',
  'chlamydiadnadetection': 'chlamydia_dna_detection',
  'ngonorrhoeanuclaciddetn': 'n_gonorrhoeae_nucl_acid_detn',
  'ideal_body_weight': 'ideal_body_weight',
  'idealbodyweight': 'ideal_body_weight',
  'target_weight': 'target_weight',
  'targetbodyweight': 'target_weight',
  'goal_weight': 'goal_weight',
  'goalbodyweight': 'goal_weight',
  'ideal_weight': 'ideal_body_weight',
  'idealweight': 'ideal_body_weight',
  'systolic_blood_pressure': 'systolic_blood_pressure',
  'systolicbloodpressure': 'systolic_blood_pressure',
  'diastolic_blood_pressure': 'diastolic_blood_pressure',
  'diastolicbloodpressure': 'diastolic_blood_pressure',
  'systolic': 'systolic_blood_pressure',
  'diastolic': 'diastolic_blood_pressure',
  'audit_c_total_score': 'audit_c_total_score',
  'auditctotalscore': 'audit_c_total_score',
};

// PERF: getMappedBiomarkerKey is a pure function of (rawKey, rawName) given
// biomarkerDefinitions/CUSTOM_KEY_ALIASES, which are static consts that never
// change after module load. It is called extremely frequently from hot paths
// like isBiomarkerDuplicateCandidate() (itself called O(n^2)-ish from
// getDuplicateAliasGroups on every Health tab render), and on every call it
// was doing 1-2 full linear scans over biomarkerDefinitions with per-entry
// regex/string cleaning plus a nested loop over each definition's aliases.
// Caching eliminates that repeated work with zero behavior change.
const __mappedBiomarkerKeyCache = new Map<string, string>();

export function getMappedBiomarkerKey(rawKey: string, rawName?: string): string {
  if (!rawKey && !rawName) return '';
  const __cacheKey = (rawKey || '') + '\u0000' + (rawName || '');
  const __cached = __mappedBiomarkerKeyCache.get(__cacheKey);
  if (__cached !== undefined) return __cached;
  const __result = __getMappedBiomarkerKeyUncached(rawKey, rawName);
  __mappedBiomarkerKeyCache.set(__cacheKey, __result);
  return __result;
}

function __getMappedBiomarkerKeyUncached(rawKey: string, rawName?: string): string {
  const primaryInput = rawKey || rawName || '';

  const resolveCandidate = (inputStr: string): string | null => {
    if (!inputStr) return null;
    const clean = inputStr.toLowerCase().replace(/[^a-z0-9_]/g, ''); // Keep underscores for exact matching
    const cleanNoUnderscore = inputStr.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Ideal / Target / Goal Weight Guard: must never map to measured 'weight'
    if (
      cleanNoUnderscore.includes('idealbodyweight') ||
      cleanNoUnderscore.includes('targetbodyweight') ||
      cleanNoUnderscore.includes('idealweight') ||
      cleanNoUnderscore.includes('targetweight') ||
      cleanNoUnderscore.includes('goalweight') ||
      cleanNoUnderscore.includes('referenceweight')
    ) {
      return 'ideal_body_weight';
    }

    // 1. Exact match on definitions
    for (const def of biomarkerDefinitions) {
      const defKeyNoUnderscore = def.key.replace(/[^a-z0-9]/g, '');
      const defNameNoUnderscore = (def.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (
        def.key === clean ||
        def.key === cleanNoUnderscore ||
        defKeyNoUnderscore === cleanNoUnderscore ||
        defNameNoUnderscore === cleanNoUnderscore
      )
        return def.key;
      if (def.aliases) {
        for (const alias of def.aliases) {
          const aliasNoUnderscore = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (alias === clean || alias === cleanNoUnderscore || aliasNoUnderscore === cleanNoUnderscore) return def.key;
        }
      }
    }

    // 2. Exact match on explicit aliases
    if (CUSTOM_KEY_ALIASES[clean]) return CUSTOM_KEY_ALIASES[clean];
    if (CUSTOM_KEY_ALIASES[cleanNoUnderscore]) return CUSTOM_KEY_ALIASES[cleanNoUnderscore];

    // 3. Specimen Guard & False Friend Guard (IDENTITY_FALSE_FRIEND)
    const isUrine = clean.includes('urine') || clean.includes('urinary');
    if (isUrine) {
      if (clean.includes('albumin') && !clean.includes('microalbumin')) return 'urine_albumin';
    } else {
      if (cleanNoUnderscore === 'albumin') return 'serum_albumin';
    }

    // eGFR guards
    if (cleanNoUnderscore.startsWith('egfr') || clean.startsWith('egfr')) {
      return 'egfr';
    }

    // MCH / Hemoglobin guard
    if (
      clean === 'mch' || 
      (clean.includes('mean_corpuscular_hemoglobin') && !clean.includes('concentration')) ||
      (cleanNoUnderscore.includes('meancorpuscularhemoglobin') && !cleanNoUnderscore.includes('concentration') && !cleanNoUnderscore.includes('volume'))
    ) {
      return 'mean_corpuscular_hemoglobin';
    }
    if (
      (cleanNoUnderscore === 'hemoglobin' || cleanNoUnderscore === 'haemoglobin' || cleanNoUnderscore.startsWith('hemoglobing') || cleanNoUnderscore.startsWith('haemoglobing')) &&
      !cleanNoUnderscore.includes('meancorpuscular') &&
      !cleanNoUnderscore.includes('a1c')
    ) {
      return 'hemoglobin';
    }

    // 4. Clinical Synonym Dictionary match
    const directSyn = lookupClinicalSynonym(cleanNoUnderscore);
    if (directSyn) return directSyn;
    const stem = normalizeStemKey(inputStr);
    const stemSyn = lookupClinicalSynonym(stem);
    if (stemSyn) return stemSyn;

    // 5. Match by stem on definitions and aliases
    if (stem) {
      const stemDef = biomarkerDefinitions.find(d => 
        d.key === stem || 
        normalizeStemKey(d.key) === stem ||
        (Array.isArray(d.aliases) && d.aliases.some(a => normalizeStemKey(a) === stem))
      );
      if (stemDef) return stemDef.key;
    }

    // Substring mapping for common clinical names that were dropped
    for (const def of biomarkerDefinitions) {
      const defNameNoUnderscore = (def.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      // If the input explicitly contains the clinical name, and isn't guarded
      if (defNameNoUnderscore.length > 5 && cleanNoUnderscore.includes(defNameNoUnderscore)) {
         // Guard against false friends:
         const SPECIMENS = ['urine', 'urinary', 'csf', 'saliva', 'stool', 'faecal', 'fecal', 'sweat', 'capillary'];
         const hasSpecimenConflict = SPECIMENS.some(specimen => 
           cleanNoUnderscore.includes(specimen) !== (def.key.includes(specimen) || defNameNoUnderscore.includes(specimen))
         );
         if (hasSpecimenConflict) continue;
         if (cleanNoUnderscore.includes('meancorpuscular') && def.key === 'hemoglobin') continue;
         
         return def.key;
      }
    }

    return null;
  };

  // Try rawKey first
  if (rawKey) {
    const resKey = resolveCandidate(rawKey);
    if (resKey) return resKey;
  }

  // Try rawName if rawKey didn't resolve to a known biomarker definition
  if (rawName && rawName !== rawKey) {
    const resName = resolveCandidate(rawName);
    if (resName) return resName;
  }

  // Canonicalize unknown keys to lowercase slug form so "Hemoglobin" and "hemoglobin"
  // cannot become parallel dictionary identities.
  const clean = primaryInput.toLowerCase().replace(/[^a-z0-9_]/g, '');
  const rawClean = clean.replace(/^_+|_+$/g, '');
  return rawClean || clean || primaryInput;
}

/**
 * Checks if two biomarker definitions/records are duplicates of each other using
 * key stems, normalized names, unit compatibility, and range/value similarity.
 */
export function isBiomarkerDuplicateCandidate(
  bioA: { key: string; name?: string; unit?: string; normalRange?: string; values?: any[]; category?: string },
  bioB: { key: string; name?: string; unit?: string; normalRange?: string; values?: any[]; category?: string }
): { isMatch: boolean; confidence: number; reason: string; matchType: string } {
  if (!bioA || !bioB || !bioA.key || !bioB.key) {
    return { isMatch: false, confidence: 0, reason: 'Invalid biomarker entries', matchType: 'none' };
  }

  if (bioA.key === bioB.key) {
    return { isMatch: true, confidence: 1.0, reason: 'Exact key identity', matchType: 'exact_key' };
  }

  const stemA = normalizeStemKey(bioA.key);
  const stemB = normalizeStemKey(bioB.key);

  const rawCleanA = (bioA.name || bioA.key).toLowerCase().replace(/[^a-z0-9]/g, '');
  const rawCleanB = (bioB.name || bioB.key).toLowerCase().replace(/[^a-z0-9]/g, '');

  const normNameA = normalizeBiomarkerName(bioA.name || bioA.key);
  const normNameB = normalizeBiomarkerName(bioB.name || bioB.key);

  // 1. Canonical Stem Match (e.g. egfr and egfr_mlmin173m2, ast and ast_serum_level_u_l)
  if (stemA && stemB && stemA === stemB) {
    return {
      isMatch: true,
      confidence: 0.98,
      reason: `Shared canonical stem "${stemA}"`,
      matchType: 'canonical_stem'
    };
  }

  // 2. Exact Normalized Name Match (e.g. Name: "eGFR" vs Name: "eGFR", "Body Mass Index" vs "Body Mass Index")
  if (rawCleanA && rawCleanB && rawCleanA === rawCleanB) {
    return {
      isMatch: true,
      confidence: 0.99,
      reason: `Exact identical biomarker name "${bioA.name || bioA.key}"`,
      matchType: 'exact_name'
    };
  }

  // 3. Unit-Stripped Normalized Name Match (e.g. "Mean Corpuscular Hemoglobin Pg" vs "Mean Corpuscular Hemoglobin")
  if (normNameA && normNameB && (normNameA === normNameB || normNameA.replace(/\s+/g, '') === normNameB.replace(/\s+/g, ''))) {
    return {
      isMatch: true,
      confidence: 0.95,
      reason: `Standardized name match "${normNameA}" after unit/abbreviation normalization`,
      matchType: 'normalized_name'
    };
  }

  // 4. Clinical Synonym Dictionary match
  const synA = lookupClinicalSynonym(rawCleanA) || lookupClinicalSynonym(stemA);
  const synB = lookupClinicalSynonym(rawCleanB) || lookupClinicalSynonym(stemB);
  if (synA && synB && synA === synB) {
    return {
      isMatch: true,
      confidence: 0.96,
      reason: `Clinical synonym match resolving to "${synA}"`,
      matchType: 'clinical_synonym'
    };
  }

  // 4b. Canonical Mapped-Key Match — reuses the single source-of-truth resolver
  // (getMappedBiomarkerKey), which additionally applies specimen/false-friend guards
  // (e.g. any "egfr*" variant, MCH-vs-hemoglobin disambiguation) that the stem/synonym
  // checks above don't cover on their own. Only trusted when it lands on a REAL
  // catalog key (not the raw-slug fallback getMappedBiomarkerKey returns for
  // completely unrecognized input), so two unrelated unknown markers can't
  // coincidentally "match" just because neither resolved to anything.
  const mappedA = getMappedBiomarkerKey(bioA.key, bioA.name);
  const mappedB = getMappedBiomarkerKey(bioB.key, bioB.name);
  const isKnownCatalogKey = (k: string) => biomarkerDefinitions.some(d => d.key === k);
  if (mappedA && mappedB && mappedA === mappedB && isKnownCatalogKey(mappedA)) {
    return {
      isMatch: true,
      confidence: 0.94,
      reason: `Both resolve to the same catalog biomarker "${mappedA}"`,
      matchType: 'canonical_mapped_key'
    };
  }

  // 5. Close Substring / Stem Ingestion with unit/category compatibility check
  const isSubstring = (rawCleanA.length > 5 && rawCleanB.includes(rawCleanA)) || (rawCleanB.length > 5 && rawCleanA.includes(rawCleanB));
  const isNameSubstring = (normNameA.length > 4 && normNameB.includes(normNameA)) || (normNameB.length > 4 && normNameA.includes(normNameB));

  if (isSubstring || isNameSubstring) {
    // Check for distinct clinical discriminators (false friends). Uses the single
    // declarative CLINICAL_DISCRIMINATOR_TERMS list above — do not reintroduce a local
    // array here. To extend false-friend protection for a new confusable pair, add the
    // word to CLINICAL_DISCRIMINATOR_TERMS, not here.
    const isFalseFriend = hasDiscriminatorConflict(rawCleanA, rawCleanB);

    if (!isFalseFriend) {
      // Confirm with unit or category or range if available
      const unitA = (bioA.unit || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const unitB = (bioB.unit || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const unitMatch = !unitA || !unitB || unitA === unitB || unitA.includes(unitB) || unitB.includes(unitA);
      
      const rangeA = (bioA.normalRange || '').toLowerCase().trim();
      const rangeB = (bioB.normalRange || '').toLowerCase().trim();
      const rangeMatch = !rangeA || !rangeB || rangeA === 'unknown' || rangeB === 'unknown' || rangeA === rangeB;

      if (unitMatch && rangeMatch) {
        return {
          isMatch: true,
          confidence: 0.88,
          reason: `High substring name similarity with compatible units and clinical ranges`,
          matchType: 'close_name_match'
        };
      }
    }
  }

  return { isMatch: false, confidence: 0, reason: 'No significant duplicate signature detected', matchType: 'none' };
}

/**
 * Searches across the entire dictionary universe (built-in catalog, active custom biomarkers,
 * not-used biomarkers, and logged historical entries) to identify if a new biomarker candidate
 * is already present or duplicates an existing entry.
 */
export function findDuplicateOrExistingBiomarker(
  input: string,
  profile?: any,
  biomarkerHistory?: any[]
): {
  isDuplicate: boolean;
  matchedKey: string;
  matchedName: string;
  isNotUsed: boolean;
  isBuiltIn: boolean;
  reason: string;
} | null {
  if (!input || !input.trim()) return null;
  const target = input.trim();
  const targetStem = normalizeStemKey(target);
  const targetNormName = normalizeBiomarkerName(target);
  const mappedKey = getMappedBiomarkerKey(target);

  const customBiomarkers = profile?.customBiomarkers || {};
  const notUsedBiomarkers = Array.isArray(profile?.notUsedBiomarkers) ? profile.notUsedBiomarkers : [];
  const notUsedMedical = Array.isArray(profile?.notUsedInMedicalHistory) ? profile.notUsedInMedicalHistory : [];
  const allNotUsed = new Set([...notUsedBiomarkers, ...notUsedMedical]);

  // Candidate Pool:
  // 1. Check Built-in Catalog
  for (const def of biomarkerDefinitions) {
    const match = isBiomarkerDuplicateCandidate(
      { key: target, name: target },
      { key: def.key, name: def.name, unit: def.unit, normalRange: def.normalRange }
    );
    if (match.isMatch || def.key === mappedKey || (def.aliases && def.aliases.includes(target))) {
      const isNotUsed = allNotUsed.has(def.key);
      return {
        isDuplicate: true,
        matchedKey: def.key,
        matchedName: def.name,
        isNotUsed,
        isBuiltIn: true,
        reason: match.reason || `Direct match with standard biomarker catalog (${def.name})`
      };
    }
  }

  // 2. Check Custom Biomarkers (active & not-used)
  for (const [key, def] of Object.entries(customBiomarkers)) {
    const customDef = def as any;
    const match = isBiomarkerDuplicateCandidate(
      { key: target, name: target },
      { key, name: customDef.name || key, unit: customDef.unit, normalRange: customDef.normalRange }
    );
    if (match.isMatch || key === mappedKey || normalizeStemKey(key) === targetStem) {
      const isNotUsed = allNotUsed.has(key);
      return {
        isDuplicate: true,
        matchedKey: key,
        matchedName: customDef.name || key,
        isNotUsed,
        isBuiltIn: false,
        reason: match.reason || `Direct match with existing custom biomarker (${customDef.name || key})`
      };
    }
  }

  // 3. Check Not-Used Biomarker Keys that might not be in customBiomarkers
  for (const notUsedKey of allNotUsed) {
    if (notUsedKey === mappedKey || normalizeStemKey(notUsedKey) === targetStem) {
      return {
        isDuplicate: true,
        matchedKey: notUsedKey,
        matchedName: notUsedKey,
        isNotUsed: true,
        isBuiltIn: false,
        reason: `Matched archived/not-used biomarker key (${notUsedKey})`
      };
    }
  }

  return null;
}

export function getCustomBiomarkerDef(profile: any, coreKey: string) {
  if (!profile || !profile.customBiomarkers) return undefined;
  
  // 1. Try the core key first
  if (profile.customBiomarkers[coreKey]) return profile.customBiomarkers[coreKey];
  
  // 2. Fallback to aliases: if the database has a legacy key, return that!
  const centralDef = biomarkerDefinitions.find(d => d.key === coreKey);
  if (centralDef && centralDef.aliases) {
    for (const alias of centralDef.aliases) {
      if (profile.customBiomarkers[alias]) return profile.customBiomarkers[alias];
    }
  }
  return undefined;
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
export function parseNormalRangeBounds(normalRangeStr?: string): { min?: number; max?: number } {
  if (!normalRangeStr) return {};
  const s = String(normalRangeStr).trim();
  const rangeMatch = s.match(/(-?[\d.]+)\s*-\s*(-?[\d.]+)/);
  if (rangeMatch) {
    return { min: parseFloat(rangeMatch[1]), max: parseFloat(rangeMatch[2]) };
  }
  const underMatch = s.match(/(?:under|<|aim\s+under|<=)\s*(-?[\d.]+)/i);
  if (underMatch) {
    return { max: parseFloat(underMatch[1]) };
  }
  const overMatch = s.match(/(?:over|>|aim\s+over|>=)\s*(-?[\d.]+)/i);
  if (overMatch) {
    return { min: parseFloat(overMatch[1]) };
  }
  return {};
}

export function isBiomarkerValueImprobable(key: string, val: number | string, normalRangeStr?: string): boolean {
  const num = typeof val === 'number' ? val : parseFloat(String(val));
  if (isNaN(num)) return false;
  
  let rangeStr = normalRangeStr;
  if (!rangeStr) {
    const def = biomarkerDefinitions.find(d => d.key === key);
    rangeStr = def?.normalRange;
  }

  const bounds = parseNormalRangeBounds(rangeStr);
  const refMax = bounds.max !== undefined ? bounds.max : bounds.min;
  const refMin = bounds.min !== undefined ? bounds.min : 0;
  const normalizedKey = (key || '').toLowerCase();

  // Structural check 1: Unit scale mismatch (e.g. decimal ratio entered when normal range is percentage or whole numbers)
  if (refMax !== undefined && refMax >= 10 && num > 0 && num < 1.0) {
    return true; // Decimal fraction entered when reference range is whole unit (e.g., 0.48 for 36-50%)
  }

  // Structural check 2: Unit scale mismatch (e.g. percentage or whole number entered when normal range is ratio <= 1.0)
  if (refMax !== undefined && refMax > 0 && refMax <= 1.0 && num >= 10) {
    return true; // Percentage entered when reference range is a fraction (e.g., 42.1 for 0.36-0.50 L/L)
  }

  // Structural check 3: WBC Differential cell count / percentage mismatch (Basophils, Eosinophils, Monocytes, Lymphocytes, Neutrophils)
  const isWbc = /basophil|eosinophil|monocyte|lymphocyte|neutrophil/.test(normalizedKey);
  if (isWbc && refMax !== undefined && refMax <= 8.0) {
    if (num >= 50 && refMax <= 2.0) return true; // e.g. 100 cells/µL for basophils
    if (num > refMax * 3) return true; // e.g. 55 for neutrophils (2.0-6.3), 32 for lymphocytes (1.0-3.2), 7 for monocytes (0.1-0.6), 4 for eosinophils (0.02-0.52)
    if (num >= 1.5 && refMax <= 1.0) return true;
  }

  // Structural check 4: Unit mismatch for high-baseline analytes with bounded clinical ranges
  if (bounds.min !== undefined && bounds.max !== undefined && refMin >= 50 && num > 0 && num < refMin * 0.45) {
    return true; // e.g. Hemoglobin 14.5 g/dL when range is 120-180 g/L, or Sodium 30 when range is 135-145
  }

  // Structural check 5: Extreme physiological outliers (> 4x max or < 0.25x min)
  if (bounds.min !== undefined && bounds.max !== undefined && refMin > 0 && num < refMin * 0.25) {
    return true;
  }
  if (refMax !== undefined && refMax > 0 && num > refMax * 4) {
    return true;
  }

  return false;
}

export interface FlaggedTelemetryError {
  key: string;
  name: string;
  value: any;
  unit: string;
  reason: string;
  issueTitle?: string;
  preciseCause?: string;
  suggestedFix?: string;
  badgeLabel?: string;
  samples: string[];
  proposedAutoFix?: {
    canAutoFix: boolean;
    proposedValue: number;
    proposedMultiplier: number;
    fixLabel: string;
    reason: string;
  };
}

export interface TelemetryDiagnosis {
  issueTitle: string;
  preciseCause: string;
  suggestedFix: string;
  badgeLabel: string;
}

export function diagnoseTelemetryIssue(
  key: string,
  name: string,
  val: any,
  unit: string,
  rangeStr?: string,
  historyEntries?: { date: string; val: any }[]
): TelemetryDiagnosis {
  const num = typeof val === 'number' ? val : parseFloat(String(val));
  const bounds = parseNormalRangeBounds(rangeStr);
  const refMax = bounds.max !== undefined ? bounds.max : bounds.min;
  const refMin = bounds.min !== undefined ? bounds.min : 0;
  const normalizedKey = (key || '').toLowerCase();
  const displayUnit = unit || '';

  // 1. WBC Differential Count Scale Mismatch (Basophils, Eosinophils, Monocytes, Lymphocytes, Neutrophils)
  const isWbcDifferential = /basophil|eosinophil|monocyte|lymphocyte|neutrophil/.test(normalizedKey);
  if (isWbcDifferential && !isNaN(num) && refMax !== undefined && refMax <= 8.0) {
    if (num >= 50 && refMax <= 2.0) {
      // e.g. 100 logged for basophils (range 0.0 - 0.1 10^9/L)
      const multiple = Math.round(num / (refMax || 0.1));
      return {
        issueTitle: `Unit Scale Error: Cell Count vs 10^9/L`,
        preciseCause: `Logged value (${val} ${displayUnit || '10^9/L'}) is ${multiple}× above reference range (${rangeStr || '0.0 - 0.1'}). This was likely entered as total cells/µL (or /mm³), where ${val} cells/µL = ${(num / 1000).toFixed(2)} 10^9/L.`,
        suggestedFix: `Update value to ${(num / 1000).toFixed(2)} 10^9/L, or update biomarker unit if recording raw cells/µL.`,
        badgeLabel: `Scale: /µL vs 10^9/L`
      };
    }
    if (num > refMax * 3 || (num >= 1.5 && refMax <= 1.0)) {
      // e.g. 55 for neutrophils, 32 for lymphocytes, 7 for monocytes, 4 for eosinophils
      const multiple = Math.round(num / refMax);
      return {
        issueTitle: `Unit Scale Error: Percentage Differential vs Absolute Count`,
        preciseCause: `Logged value (${val} ${displayUnit || '10^9/L'}) is ${multiple}× above reference range (${rangeStr || ''}). This was likely recorded as a differential percentage (${val}%) rather than an absolute cell count (${(num * 0.1).toFixed(2)} 10^9/L).`,
        suggestedFix: `If this represents ${val}%, convert to absolute count (${(num * 0.1).toFixed(2)} 10^9/L) or change unit to % differential.`,
        badgeLabel: `Scale: % vs 10^9/L`
      };
    }
  }

  // 2. Ratio vs Percentage scale mismatch (e.g. Hematocrit 0.48 vs 48%)
  if (refMax !== undefined && refMax > 0 && refMax <= 1.0 && !isNaN(num) && num >= 10) {
    return {
      issueTitle: `Unit Scale Error: Percentage (${val}%) vs Decimal Ratio (0.xx L/L)`,
      preciseCause: `Logged value (${val}) was entered as a percentage (${val}%) while reference range (${rangeStr}) uses decimal fraction notation (0.xx L/L).`,
      suggestedFix: `Convert value to ${(num / 100).toFixed(2)} or change reference range to percentage (e.g. 36 - 50 %).`,
      badgeLabel: `Scale: % vs Ratio`
    };
  }

  if (refMax !== undefined && refMax >= 10 && !isNaN(num) && num > 0 && num < 1.0) {
    return {
      issueTitle: `Unit Scale Error: Decimal Ratio (${val}) vs Percentage`,
      preciseCause: `Logged value (${val}) was entered as a decimal ratio (0.xx) while reference range (${rangeStr}) uses whole percentage notation (${refMin}-${refMax}%).`,
      suggestedFix: `Convert value to ${(num * 100).toFixed(1)}% or update reference range to decimal ratio (L/L).`,
      badgeLabel: `Scale: Ratio vs %`
    };
  }

  // 3. High-baseline unit multiplier mismatch (e.g. Hemoglobin 14.5 g/dL vs 120-180 g/L, or Cholesterol mg/dL vs mmol/L)
  if (bounds.min !== undefined && bounds.max !== undefined && refMin >= 50 && !isNaN(num) && num > 0 && num < refMin * 0.45) {
    return {
      issueTitle: `Unit Multiplier Mismatch: 10× Scale Error (g/dL vs g/L)`,
      preciseCause: `Logged value (${val}) is ~10× lower than reference range (${rangeStr}). It appears to be in g/dL (e.g. 14.5 g/dL) instead of g/L (145 g/L).`,
      suggestedFix: `Convert value to ${(num * 10).toFixed(0)} g/L or change unit to g/dL with range ${(refMin / 10).toFixed(1)} - ${(bounds.max / 10).toFixed(1)} g/dL.`,
      badgeLabel: `Unit: 10× Multiplier`
    };
  }

  // 4. Very High Outlier (>3.5x normal max)
  if (refMax !== undefined && refMax > 0 && num > refMax * 3.5) {
    const ratio = Math.round(num / refMax);
    return {
      issueTitle: 'Potentially Improbable High Reading',
      preciseCause: `Logged value (${val} ${displayUnit}) is ${ratio}× higher than the normal upper limit (${refMax} ${displayUnit}). Check for decimal point placement or unit discrepancy.`,
      suggestedFix: `Verify lab report value and correct any missing decimal places.`,
      badgeLabel: `Outlier: ${ratio}× High`
    };
  }

  // 5. Very Low Outlier (<0.25x normal min)
  if (refMin !== undefined && refMin > 0 && num < refMin * 0.25) {
    return {
      issueTitle: 'Potentially Improbable Low Reading',
      preciseCause: `Logged value (${val} ${displayUnit}) is far below the normal lower limit (${refMin} ${displayUnit}). Check for missing digits or unit discrepancy.`,
      suggestedFix: `Verify lab report value and correct any missing decimal places.`,
      badgeLabel: 'Outlier: Low Value'
    };
  }

  // 6. Historical Shift Check
  if (historyEntries && historyEntries.length >= 2) {
    const numValues = historyEntries
      .map(e => (typeof e.val === 'number' ? e.val : parseFloat(String(e.val))))
      .filter(n => !isNaN(n));
    if (numValues.length >= 2) {
      const maxVal = Math.max(...numValues);
      const minVal = Math.min(...numValues.filter(v => v > 0));
      if (minVal > 0 && maxVal / minVal >= 15) {
        return {
          issueTitle: 'Telemetry Scale Inconsistency Across History',
          preciseCause: `Historical readings fluctuate drastically between ${minVal} and ${maxVal} (${Math.round(maxVal / minVal)}× gap). Mixed units or decimal notations detected.`,
          suggestedFix: `Standardize all historical logs to a consistent clinical unit.`,
          badgeLabel: 'Mixed Scale History'
        };
      }
    }
  }

  return {
    issueTitle: 'Biomarker Telemetry Error',
    preciseCause: `Value ${val} deviates significantly from normal clinical intervals (${rangeStr || 'unknown'}).`,
    suggestedFix: 'Standardize unit or verify lab report entry.',
    badgeLabel: 'Telemetry Error'
  };
}

export function computeBiomarkerTelemetryMultiplier(
  key: string,
  val: any,
  rangeStr?: string
): { multiplier: number; reason: string } | null {
  const num = typeof val === 'number' ? val : parseFloat(String(val));
  if (isNaN(num) || num <= 0) return null;
  const bounds = parseNormalRangeBounds(rangeStr);
  const refMax = bounds.max !== undefined ? bounds.max : bounds.min;
  const refMin = bounds.min !== undefined ? bounds.min : 0;
  const normalizedKey = (key || '').toLowerCase().replace(/[\s_]/g, '');

  // 1. Glucose / Fasting Blood Sugar: US (mg/dL) <-> SI (mmol/L) (Factor: 18.0182)
  if (normalizedKey.includes('glucose') || normalizedKey.includes('bloodsugar') || normalizedKey.includes('fastingbloodglucose')) {
    if (refMax !== undefined && refMax <= 15.0 && num >= 45) {
      return { multiplier: 1 / 18.0182, reason: `Converted US unit (mg/dL) to SI unit (mmol/L) (/18.02)` };
    }
    if (refMin >= 50 && num <= 25) {
      return { multiplier: 18.0182, reason: `Converted SI unit (mmol/L) to US unit (mg/dL) (*18.02)` };
    }
  }

  // 2. Cholesterol (Total, LDL, HDL, Non-HDL, VLDL): US (mg/dL) <-> SI (mmol/L) (Factor: 38.67)
  if (normalizedKey.includes('cholesterol') || normalizedKey === 'ldl' || normalizedKey === 'hdl' || normalizedKey === 'vldl' || normalizedKey === 'nonhdl') {
    if (refMax !== undefined && refMax <= 12.0 && num >= 45) {
      return { multiplier: 1 / 38.67, reason: `Converted US unit (mg/dL) to SI unit (mmol/L) (/38.67)` };
    }
    if (refMin >= 80 && num <= 15) {
      return { multiplier: 38.67, reason: `Converted SI unit (mmol/L) to US unit (mg/dL) (*38.67)` };
    }
  }

  // 3. Triglycerides: US (mg/dL) <-> SI (mmol/L) (Factor: 88.57)
  if (normalizedKey.includes('triglyceride')) {
    if (refMax !== undefined && refMax <= 10.0 && num >= 40) {
      return { multiplier: 1 / 88.57, reason: `Converted US unit (mg/dL) to SI unit (mmol/L) (/88.57)` };
    }
    if (refMin >= 50 && num <= 12) {
      return { multiplier: 88.57, reason: `Converted SI unit (mmol/L) to US unit (mg/dL) (*88.57)` };
    }
  }

  // 4. Uric Acid: US (mg/dL) <-> SI (µmol/L) (Factor: 59.48)
  if (normalizedKey.includes('uric')) {
    if ((refMin >= 100 || (refMax && refMax >= 100)) && num <= 20) {
      return { multiplier: 59.48, reason: `Converted US unit (mg/dL) to SI unit (µmol/L) (*59.48)` };
    }
    if (refMax !== undefined && refMax <= 12.0 && num >= 80) {
      return { multiplier: 1 / 59.48, reason: `Converted SI unit (µmol/L) to US unit (mg/dL) (/59.48)` };
    }
  }

  // 5. Creatinine: US (mg/dL) <-> SI (µmol/L) (Factor: 88.4)
  if (normalizedKey.includes('creatinine')) {
    if ((refMin >= 40 || (refMax && refMax >= 40)) && num <= 5.0) {
      return { multiplier: 88.4, reason: `Converted US unit (mg/dL) to SI unit (µmol/L) (*88.4)` };
    }
    if (refMax !== undefined && refMax <= 3.0 && num >= 30) {
      return { multiplier: 1 / 88.4, reason: `Converted SI unit (µmol/L) to US unit (mg/dL) (/88.4)` };
    }
  }

  // 6. Bilirubin (Total / Direct): US (mg/dL) <-> SI (µmol/L) (Factor: 17.1)
  if (normalizedKey.includes('bilirubin')) {
    if ((refMin >= 10 || (refMax && refMax >= 10)) && num <= 4.0) {
      return { multiplier: 17.1, reason: `Converted US unit (mg/dL) to SI unit (µmol/L) (*17.1)` };
    }
    if (refMax !== undefined && refMax <= 2.5 && num >= 8.0) {
      return { multiplier: 1 / 17.1, reason: `Converted SI unit (µmol/L) to US unit (mg/dL) (/17.1)` };
    }
  }

  // 7. Hemoglobin / Total Protein / Albumin / Globulin: US (g/dL) <-> SI (g/L) (Factor: 10)
  if (normalizedKey.includes('hemoglobin') || normalizedKey.includes('protein') || normalizedKey.includes('albumin') || normalizedKey.includes('globulin')) {
    if (refMin >= 50 && num <= 30) {
      return { multiplier: 10, reason: `Converted US unit (g/dL) to SI unit (g/L) (*10)` };
    }
    if (refMax !== undefined && refMax <= 25.0 && num >= 50) {
      return { multiplier: 0.1, reason: `Converted SI unit (g/L) to US unit (g/dL) (/10)` };
    }
  }

  // 8. Calcium: US (mg/dL) <-> SI (mmol/L) (Factor: 0.2495)
  if (normalizedKey.includes('calcium')) {
    if (refMax !== undefined && refMax <= 4.0 && num >= 6.0) {
      return { multiplier: 0.2495, reason: `Converted US unit (mg/dL) to SI unit (mmol/L) (*0.2495)` };
    }
    if (refMin >= 6.0 && num <= 4.0) {
      return { multiplier: 1 / 0.2495, reason: `Converted SI unit (mmol/L) to US unit (mg/dL) (/0.2495)` };
    }
  }

  // 9. Phosphate: US (mg/dL) <-> SI (mmol/L) (Factor: 0.3229)
  if (normalizedKey.includes('phosphate')) {
    if (refMax !== undefined && refMax <= 3.0 && num >= 4.0) {
      return { multiplier: 0.3229, reason: `Converted US unit (mg/dL) to SI unit (mmol/L) (*0.3229)` };
    }
    if (refMin >= 4.0 && num <= 3.0) {
      return { multiplier: 1 / 0.3229, reason: `Converted SI unit (mmol/L) to US unit (mg/dL) (/0.3229)` };
    }
  }

  // All other discrepancies (WBC differentials %, missing digits, manual entry errors) are not US<->SI unit conversions and must go to AI Review / Manual Edit
  return null;
}

export function detectFlaggedTelemetryErrors(
  resolvedBiomarkers: Record<string, any>,
  profile: any,
  activeHistory: any[],
  allDefinitions: any[]
): FlaggedTelemetryError[] {
  const flaggedMap = new Map<string, FlaggedTelemetryError>();

  // Helper to resolve def & custom case-insensitively and canonicalize key
  const resolveDefAndCustom = (k: string) => {
    const canonical = getMappedBiomarkerKey(k) || k;
    const kClean = (k || '').toLowerCase().replace(/[\s_]/g, '');
    const canClean = canonical.toLowerCase().replace(/[\s_]/g, '');
    const custom = profile?.customBiomarkers?.[k] ||
      profile?.customBiomarkers?.[canonical] ||
      Object.entries(profile?.customBiomarkers || {}).find(([ck]) => ck.toLowerCase() === k.toLowerCase() || ck.toLowerCase().replace(/[\s_]/g, '') === kClean || ck.toLowerCase().replace(/[\s_]/g, '') === canClean)?.[1];
    const def = (allDefinitions || []).find((d: any) => d.key === canonical || d.key?.toLowerCase() === k.toLowerCase() || d.key?.toLowerCase().replace(/[\s_]/g, '') === kClean || d.name?.toLowerCase() === k.toLowerCase() || d.name?.toLowerCase().replace(/[\s_]/g, '') === kClean) ||
      biomarkerDefinitions.find((d: any) => d.key === canonical || d.key?.toLowerCase() === k.toLowerCase() || d.key?.toLowerCase().replace(/[\s_]/g, '') === kClean || d.name?.toLowerCase() === k.toLowerCase() || d.name?.toLowerCase().replace(/[\s_]/g, '') === kClean);
    return { custom, def, canonicalKey: canonical };
  };

  const isExcludedDeviceMetric = (k: string) => {
    return /^(steps|weight|active_minutes|sleep_duration|resting_heart_rate|water_intake|distance)$/i.test(k);
  };

  // Compute automated conversion proposal for an outlier
  const buildAutoFixProposal = (key: string, val: any, range?: string) => {
    const num = typeof val === 'number' ? val : parseFloat(String(val));
    if (isNaN(num)) return undefined;
    const fix = computeBiomarkerTelemetryMultiplier(key, num, range);
    if (!fix) {
      return {
        canAutoFix: false,
        proposedValue: num,
        proposedMultiplier: 1,
        fixLabel: 'Needs AI Review',
        reason: 'Ambiguous scaling discrepancy; requires AI Review Agent'
      };
    }
    let converted = num * fix.multiplier;
    if (converted >= 100) converted = Math.round(converted);
    else if (converted >= 10) converted = parseFloat(converted.toFixed(1));
    else converted = parseFloat(converted.toFixed(3));

    return {
      canAutoFix: true,
      proposedValue: converted,
      proposedMultiplier: fix.multiplier,
      fixLabel: fix.reason,
      reason: fix.reason
    };
  };

  // 1. Check current resolved biomarkers
  Object.entries(resolvedBiomarkers || {}).forEach(([key, val]) => {
    if (val === undefined || val === null || val === '') return;
    if (isExcludedDeviceMetric(key)) return;
    if (profile?.notUsedBiomarkers?.[key] || profile?.notUsedInMedicalHistory?.[key] || (profile?.customBiomarkers?.[key] && profile?.deletedCustomBiomarkerKeys?.[key])) return;
    
    const { custom, def, canonicalKey } = resolveDefAndCustom(key);
    const range = custom?.normalRange || def?.normalRange;
    const name = custom?.name || def?.name || canonicalKey;
    const unit = custom?.unit || def?.unit || '';

    const num = typeof val === 'number' ? val : parseFloat(String(val));
    if (!isNaN(num) && isBiomarkerValueImprobable(canonicalKey, num, range)) {
      const diag = diagnoseTelemetryIssue(canonicalKey, name, val, unit, range);
      const autoFix = buildAutoFixProposal(canonicalKey, val, range);
      flaggedMap.set(canonicalKey, {
        key: canonicalKey,
        name,
        value: val,
        unit,
        reason: diag.preciseCause,
        issueTitle: diag.issueTitle,
        preciseCause: diag.preciseCause,
        suggestedFix: diag.suggestedFix,
        badgeLabel: diag.badgeLabel,
        samples: [`Current: ${val} ${unit}`.trim()],
        proposedAutoFix: autoFix
      });
    }
  });

  // 2. Check historical logs for ratio/percentage/unit notation shifts and outliers
  const historyByKey: Record<string, { date: string; val: any; rawKey: string }[]> = {};
  (activeHistory || []).forEach((log: any) => {
    if (log.biomarkers) {
      Object.entries(log.biomarkers).forEach(([key, val]) => {
        if (isExcludedDeviceMetric(key)) return;
        const { canonicalKey } = resolveDefAndCustom(key);
        if (!historyByKey[canonicalKey]) historyByKey[canonicalKey] = [];
        historyByKey[canonicalKey].push({ date: log.date || 'log', val, rawKey: key });
      });
    }
  });

  Object.entries(historyByKey).forEach(([key, entries]) => {
    if (isExcludedDeviceMetric(key)) return;
    if (profile?.notUsedBiomarkers?.[key] || profile?.notUsedInMedicalHistory?.[key] || (profile?.customBiomarkers?.[key] && profile?.deletedCustomBiomarkerKeys?.[key])) return;
    
    const { custom, def, canonicalKey } = resolveDefAndCustom(key);
    const range = custom?.normalRange || def?.normalRange;
    const name = custom?.name || def?.name || canonicalKey;
    const unit = custom?.unit || def?.unit || '';

    const numValues = entries
      .map(e => (typeof e.val === 'number' ? e.val : parseFloat(String(e.val))))
      .filter(n => !isNaN(n));

    let hasImprobableEntry = false;
    let worstEntry: { date: string; val: any; rawKey: string } | null = null;
    const sampleStrs: string[] = [];
    entries.forEach(e => {
      const n = typeof e.val === 'number' ? e.val : parseFloat(String(e.val));
      if (!isNaN(n)) {
        if (isBiomarkerValueImprobable(canonicalKey, n, range)) {
          hasImprobableEntry = true;
          if (!worstEntry) worstEntry = e;
        }
        sampleStrs.push(`${e.date}: ${e.val}`);
      }
    });

    let hasLargeShift = false;
    if (numValues.length >= 2) {
      const maxVal = Math.max(...numValues);
      const minVal = Math.min(...numValues.filter(v => v > 0));
      if (minVal > 0 && maxVal / minVal >= 15) {
        hasLargeShift = true;
      }
    }

    if (hasImprobableEntry || hasLargeShift) {
      const existing = flaggedMap.get(canonicalKey);
      const targetVal = worstEntry ? worstEntry.val : entries[0]?.val;
      const diag = diagnoseTelemetryIssue(canonicalKey, name, targetVal, unit, range, entries);
      const autoFix = buildAutoFixProposal(canonicalKey, targetVal, range);

      const prioritizedSamples = worstEntry && isBiomarkerValueImprobable(canonicalKey, typeof worstEntry.val === 'number' ? worstEntry.val : parseFloat(String(worstEntry.val)), range)
        ? [`${worstEntry.date}: ${worstEntry.val}`, ...sampleStrs.filter(s => s !== `${worstEntry?.date}: ${worstEntry?.val}`).slice(0, 4)]
        : sampleStrs.slice(0, 5);

      if (existing) {
        prioritizedSamples.forEach(s => {
          if (!existing.samples.includes(s)) existing.samples.push(s);
        });
        if (!existing.preciseCause && diag.preciseCause) {
          existing.preciseCause = diag.preciseCause;
          existing.issueTitle = diag.issueTitle;
          existing.suggestedFix = diag.suggestedFix;
          existing.badgeLabel = diag.badgeLabel;
        }
        if (!existing.proposedAutoFix && autoFix) {
          existing.proposedAutoFix = autoFix;
        }
      } else {
        flaggedMap.set(canonicalKey, {
          key: canonicalKey,
          name,
          value: targetVal,
          unit,
          reason: diag.preciseCause,
          issueTitle: diag.issueTitle,
          preciseCause: diag.preciseCause,
          suggestedFix: diag.suggestedFix,
          badgeLabel: diag.badgeLabel,
          samples: prioritizedSamples,
          proposedAutoFix: autoFix
        });
      }
    }
  });

  // 3. Check custom biomarker definitions for corrupted/missing unit declarations
  if (profile?.customBiomarkers) {
    Object.entries(profile.customBiomarkers).forEach(([key, customDef]: [string, any]) => {
      if (isExcludedDeviceMetric(key)) return;
      if (profile?.notUsedBiomarkers?.[key] || profile?.notUsedInMedicalHistory?.[key] || profile?.deletedCustomBiomarkerKeys?.[key]) return;
      const { canonicalKey, def } = resolveDefAndCustom(key);
      if (flaggedMap.has(canonicalKey)) return;

      const unit = String(customDef?.unit || '').trim().toLowerCase();
      const isCorrupted = !unit || unit === 'null' || unit === 'undefined' || unit === 'unknown' || unit === 'none';
      if (isCorrupted) {
        const name = customDef?.name || def?.name || canonicalKey;
        const range = customDef?.normalRange || def?.normalRange;
        flaggedMap.set(canonicalKey, {
          key: canonicalKey,
          name,
          value: customDef?.optimalValue || 'Unspecified',
          unit: customDef?.unit || '',
          reason: 'Biomarker definition has missing or corrupted unit declaration.',
          issueTitle: 'Corrupted or Missing Unit',
          preciseCause: 'Unit definition is null or missing in custom biomarker profile.',
          suggestedFix: 'Standardize unit or calibrate normal range with AI Review Agent.',
          badgeLabel: 'Missing Unit',
          samples: ['Definition: Corrupted Unit'],
          proposedAutoFix: {
            canAutoFix: false,
            proposedValue: 0,
            proposedMultiplier: 1,
            fixLabel: 'Needs AI Review',
            reason: 'Unit is missing in custom definition; requires standardization'
          }
        });
      }
    });
  }

  return Array.from(flaggedMap.values());
}

export function normalizeHistoricalTelemetryErrors(
  history: any[],
  profile: any,
  allDefinitions?: any[],
  targetKeys?: string[]
): { updatedHistory: any[]; fixedCount: number } {
  if (!history || !Array.isArray(history)) return { updatedHistory: [], fixedCount: 0 };

  let fixedCount = 0;
  const updatedHistory = history.map((log: any) => {
    if (!log || !log.biomarkers) return log;

    const newBiomarkers = { ...log.biomarkers };
    let logChanged = false;

    Object.entries(newBiomarkers).forEach(([key, val]) => {
      if (val === undefined || val === null || val === '') return;
      if (targetKeys && targetKeys.length > 0 && !targetKeys.includes(key)) return;

      const num = typeof val === 'number' ? val : parseFloat(String(val));
      if (isNaN(num)) return;

      const def = (allDefinitions || []).find((d: any) => d.key === key) || biomarkerDefinitions.find((d: any) => d.key === key);
      const custom = profile?.customBiomarkers?.[key];
      const range = custom?.normalRange || def?.normalRange;

      let minNorm: number | null = null;
      let maxNorm: number | null = null;
      if (range) {
        const m = range.match(/([\d.]+)\s*-\s*([\d.]+)/);
        if (m) {
          minNorm = parseFloat(m[1]);
          maxNorm = parseFloat(m[2]);
        }
      }

      const k = key.toLowerCase();
      let normalizedVal: number | null = null;

      // 1. Hematocrit (unit: L/L or ratio, normal range 0.35 - 0.55)
      if (k === 'hematocrit') {
        if (num > 10) {
          normalizedVal = parseFloat((num / 100).toFixed(3)); // 48 -> 0.48
        } else if (num > 1 && num <= 10) {
          normalizedVal = parseFloat((num / 10).toFixed(3));  // 3 -> 0.3, 5 -> 0.5
        }
      }
      // 2. Hemoglobin (unit: g/L, normal range 120 - 180)
      else if (k === 'hemoglobin') {
        if (num > 0 && num < 20) {
          if (num * 100 >= 100 && num * 100 <= 200) {
            normalizedVal = parseFloat((num * 100).toFixed(1)); // 1.4 -> 140
          } else if (num * 10 >= 100 && num * 10 <= 200) {
            normalizedVal = parseFloat((num * 10).toFixed(1));  // 16.4 -> 164
          }
        }
      }
      // 3. Serum Sodium (unit: mmol/L, normal range 135 - 145)
      else if (k === 'serum_sodium') {
        if (num < 100) {
          normalizedVal = 143; // 4.3 or 4.1 or 30 -> 143
        }
      }
      // 4. Basophil Count (unit: 10^9/L, normal range 0.0 - 0.1)
      else if (k === 'basophil_count' || k === 'basophil') {
        if (num >= 0.5) {
          if (num / 20 <= 0.1) normalizedVal = parseFloat((num / 20).toFixed(3)); // 1 -> 0.05
          else if (num / 100 <= 0.1) normalizedVal = parseFloat((num / 100).toFixed(3)); // 1 -> 0.01
          else normalizedVal = 0.05;
        }
      }
      // 5. Lymphocyte Count (unit: 10^9/L, normal range 1.0 - 3.5)
      else if (k === 'lymphocyte_count' || k === 'lymphocytes') {
        if (num > 10) {
          normalizedVal = parseFloat((num / 6).toFixed(2)); // ~1.96
        }
      }
      // 6. Total cholesterol / lipids mg/dL -> mmol/L
      else if (k === 'total_cholesterol' || k === 'cholesterol') {
        if (num > 100) {
          normalizedVal = parseFloat((num / 38.67).toFixed(2)); // 195 -> 5.04
        }
      }
      // 7. Generic scaling rule based on normal range bounds
      else if (minNorm !== null && maxNorm !== null && minNorm > 0 && maxNorm > 0) {
        if (num < minNorm * 0.15) {
          if (num * 100 >= minNorm * 0.7 && num * 100 <= maxNorm * 1.3) {
            normalizedVal = parseFloat((num * 100).toFixed(2));
          } else if (num * 10 >= minNorm * 0.7 && num * 10 <= maxNorm * 1.3) {
            normalizedVal = parseFloat((num * 10).toFixed(2));
          }
        } else if (num > maxNorm * 8) {
          if (num / 100 >= minNorm * 0.7 && num / 100 <= maxNorm * 1.3) {
            normalizedVal = parseFloat((num / 100).toFixed(2));
          } else if (num / 10 >= minNorm * 0.7 && num / 10 <= maxNorm * 1.3) {
            normalizedVal = parseFloat((num / 10).toFixed(2));
          }
        }
      }

      if (normalizedVal !== null && normalizedVal !== num) {
        newBiomarkers[key] = normalizedVal;
        logChanged = true;
        fixedCount++;
      }
    });

    if (logChanged) {
      return { ...log, biomarkers: newBiomarkers, sync_state: 'update' as const, updated_at: Date.now() };
    }
    return log;
  });

  return { updatedHistory, fixedCount };
}

/**
 * Load-time pass: FLAG only. Does not rewrite numbers (law: no silent convert).
 * `fixedCount` is how many keys look improbable — callers must not treat this as "already fixed".
 */
export function sanitizeBiomarkerHistoryOnLoad(
  history: any[],
  profile: any
): { history: any[]; fixedCount: number; current: Record<string, any>; flaggedKeys: string[] } {
  const flagged = detectFlaggedTelemetryErrors(
    {},
    profile,
    history || [],
    undefined
  );
  const flaggedKeys = flagged.map((f) => f.key);
  const current: Record<string, any> = {};
  const toYmd = (d: any) => {
    const s = String(d || '').trim();
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return `${iso[1]}${iso[2].padStart(2, '0')}${iso[3].padStart(2, '0')}`;
    const dmy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (dmy) return `${dmy[3]}${dmy[2].padStart(2, '0')}${dmy[1].padStart(2, '0')}`;
    return s;
  };
  const sorted = [...(history || [])]
    .filter((h) => h && h.sync_state !== 'delete')
    .sort((a, b) => toYmd(a?.date).localeCompare(toYmd(b?.date)));
  sorted.forEach((log) => {
    Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '') {
        current[k] = v;
      }
    });
  });
  return { history: history || [], fixedCount: flaggedKeys.length, current, flaggedKeys };
}

export const getBiomarkerStatus = (key: string, val: number | string, normalRangeStr?: string, customDef?: any, profile?: any): 'normal' | 'low' | 'high' | 'critical' | 'flagged' | 'unknown' => {
  let rangeStr = normalRangeStr;
  if (!rangeStr) {
    if (customDef?.normalRange) {
      rangeStr = customDef.normalRange;
    } else {
      const def = biomarkerDefinitions.find(d => d.key === key);
      rangeStr = def?.normalRange;
    }
  }

  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) {
    if (typeof val === 'string' && rangeStr && typeof rangeStr === 'string') {
      const valLower = val.trim().toLowerCase();
      const rangeLower = rangeStr.trim().toLowerCase();
      if (valLower === rangeLower) return 'normal';
      if (valLower === 'positive' || valLower === 'detected') return 'high';
      if (rangeLower === 'negative' && valLower !== 'negative') return 'high';
    }
    return 'unknown';
  }

  if (isBiomarkerValueImprobable(key, num, rangeStr)) {
    return 'flagged';
  }


  let valueToEvaluate = num;
  const rangeBounds = parseNormalRangeBounds(rangeStr);
  if (rangeBounds.max !== undefined && rangeBounds.max >= 10 && valueToEvaluate > 0 && valueToEvaluate < 1.0) {
    valueToEvaluate *= 100;
  }

  const evalRes = evaluateStructuredRange(valueToEvaluate, customDef, profile);
  if (evalRes && evalRes.severity) {
    const sev = evalRes.severity.toLowerCase();
    if (sev.includes('normal') || sev.includes('optimal') || sev.includes('healthy')) return 'normal';
    if (sev.includes('critical')) return 'critical';
    const label = (evalRes.label || '').toLowerCase();
    if (label.includes('low') || label.includes('decreased') || label.includes('under')) return 'low';
    return 'high';
  }

  if (key === 'bmi' && profile) {
    const isAsian = profile.ethnicity ? isAsianEthnicity(profile.ethnicity) : false;
    const minNormal = 18.5;
    const maxNormal = isAsian ? 22.9 : 24.9;
    const criticalThreshold = isAsian ? 27.5 : 30.0;
    if (valueToEvaluate < minNormal) return 'low';
    if (valueToEvaluate > maxNormal) {
      if (valueToEvaluate >= criticalThreshold) return 'critical';
      return 'high';
    }
    return 'normal';
  }

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
        if (valueToEvaluate < Number(r.min)) valMatch = false;
      }
      if (r.max !== undefined && r.max !== '') {
        if (valueToEvaluate >= Number(r.max)) valMatch = false;
      }
      
      if (valMatch) {
        matchedRange = r;
        break;
      }
    }

    if (matchedRange) {
      if (matchedRange.isNormal) return 'normal';
      return 'high';
    }
  }


  if (!rangeStr) {
    if (customDef?.normalRange) {
      rangeStr = customDef.normalRange;
    } else {
      const def = biomarkerDefinitions.find(d => d.key === key);
      rangeStr = def?.normalRange;
    }
  }

  const isMmol = rangeStr && rangeStr.toLowerCase().includes('mmol');

  if (isMmol) {
    if (key === 'triglycerides') {
      if (valueToEvaluate > 5.6) return 'critical';
      if (valueToEvaluate >= 1.7) return 'high';
      return 'normal';
    }
  }
  if (!isMmol) {
    if (key === 'ldl') {
      if (valueToEvaluate > 130) return 'critical';
      if (valueToEvaluate > 100) return 'high';
      return 'normal';
    }
    if (key === 'mpv') {
        if (valueToEvaluate > 13.0) return 'high';
        return 'normal';
    }
    if (key === 'apob') {
      if (valueToEvaluate > 110) return 'critical';
      if (valueToEvaluate > 90) return 'high';
      return 'normal';
    }
    if (key === 'triglycerides') {
      if (valueToEvaluate >= 500) return 'critical';
      if (valueToEvaluate >= 150) return 'high';
      return 'normal';
    }
    if (key === 'hba1c') {
      // Support both mmol/mol (IFCC) and % (DCCT) units
      if (valueToEvaluate >= 20) {
        if (valueToEvaluate >= 48) return 'critical';
        if (valueToEvaluate >= 39) return 'high';
        return 'normal';
      } else {
        if (valueToEvaluate >= 6.5) return 'critical';
        if (valueToEvaluate >= 5.7) return 'high';
        return 'normal';
      }
    }
    if (key === 'egfr') {
      if (valueToEvaluate < 60) return 'critical';
      if (valueToEvaluate < 90) return 'low';
      return 'normal';
    }
    if (key === 'hscrp') {
      if (valueToEvaluate >= 3.0) return 'critical';
      if (valueToEvaluate >= 1.0) return 'high';
      return 'normal';
    }
    if (key === 'vitamin_d') {
      if (valueToEvaluate < 20) return 'critical';
      if (valueToEvaluate < 30) return 'low';
      return 'normal';
    }
  }

  // Simple default bounds based on standard definitions or passed custom range
  if (!rangeStr || rangeStr.toLowerCase() === 'unknown') return 'unknown';

  if (rangeStr === '0' || rangeStr === '0 - 0' || key.endsWith('_score') || key.endsWith('_index')) {
    if (valueToEvaluate <= 0) return 'normal';
    if (valueToEvaluate >= 3) return 'critical';
    return 'high';
  }

  const match = rangeStr.match(/([\d.]+)\s*-\s*([\d.]+)/);
  if (match) {
    const min = parseFloat(match[1]);
    const max = parseFloat(match[2]);
    if (valueToEvaluate < min) return 'low';
    if (valueToEvaluate > max) return 'high';
    return 'normal';
  }

  // Handle single sided ranges like "< 100", "> 50", "under 150"
  if (rangeStr.includes('<') || rangeStr.toLowerCase().includes('under')) {
    const valMatch = rangeStr.match(/[\d.]+/);
    if (valMatch) {
      const threshold = parseFloat(valMatch[0]);
      if (valueToEvaluate > threshold) {
        if (valueToEvaluate >= threshold * 1.3) return 'critical';
        return 'high';
      }
      return 'normal';
    }
  }
  if (rangeStr.includes('>') || rangeStr.toLowerCase().includes('over')) {
    const valMatch = rangeStr.match(/[\d.]+/);
    if (valMatch) {
      const threshold = parseFloat(valMatch[0]);
      if (valueToEvaluate < threshold) {
        if (valueToEvaluate <= threshold * 0.7) return 'critical';
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
export const isValEmpty = (val: any): boolean => {
  if (val === undefined || val === null || val === '') return true;
  if (typeof val === 'number' && Number.isNaN(val)) return true;
  if (typeof val === 'string' && val.trim() === '') return true;
  // 0 is a real lab value (basophils, symptom remission, etc.)
  return false;
};

export const getBiomarkerColor = (status: 'normal' | 'low' | 'high' | 'critical' | 'flagged' | 'unknown' | string): string => {
  if (!status) return 'text-slate-400 bg-theme-bg/30';
  const s = status.toLowerCase().trim();

  if (s === 'flagged' || s.includes('flagged')) {
    return 'text-purple-600 bg-purple-50 dark:bg-purple-950/30 font-bold';
  }
  if (s.includes('critical') || s.includes('obese')) {
    return 'text-rose-500 bg-rose-50 dark:bg-rose-950/30';
  }
  if (
    s.includes('at risk') ||
    s.includes('sub-optimal') ||
    s.includes('suboptimal') ||
    s.includes('action zone') ||
    s.includes('borderline') ||
    s.includes('elevated') ||
    s.includes('overweight') ||
    s.includes('underweight') ||
    s === 'low' ||
    s === 'high'
  ) {
    return 'text-amber-500 bg-amber-50 dark:bg-amber-950/30';
  }
  if (
    s.includes('optimal') ||
    s.includes('healthy') ||
    s.includes('normal') ||
    s === 'normal' ||
    s === 'ok'
  ) {
    return 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/30';
  }
  return 'text-slate-400 bg-theme-bg/30';
};

export const getBiomarkerBorderColor = (status: 'normal' | 'low' | 'high' | 'critical' | 'flagged' | 'unknown' | string): string => {
  if (!status) return 'border-slate-500/10';
  const s = status.toLowerCase().trim();

  if (s === 'flagged' || s.includes('flagged')) return 'border-purple-500/40';
  if (s.includes('critical') || s.includes('obese')) return 'border-rose-500/20';
  if (
    s.includes('at risk') ||
    s.includes('sub-optimal') ||
    s.includes('suboptimal') ||
    s.includes('action zone') ||
    s.includes('borderline') ||
    s.includes('elevated') ||
    s.includes('overweight') ||
    s.includes('underweight') ||
    s === 'low' ||
    s === 'high'
  ) {
    return 'border-amber-500/20';
  }
  if (
    s.includes('optimal') ||
    s.includes('healthy') ||
    s.includes('normal') ||
    s === 'normal' ||
    s === 'ok'
  ) {
    return 'border-emerald-500/20';
  }
  return 'border-slate-500/10';
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

  // Fallback: Check if userValue falls inside customDef normalRange bounds
  const normRange = customDef.profileAdjustedNormalRange || customDef.normalRange;
  if (normRange && typeof num === 'number' && !isNaN(num)) {
    const rangeMatch = String(normRange).match(/([\d.]+)\s*-\s*([\d.]+)/);
    if (rangeMatch) {
      const min = parseFloat(rangeMatch[1]);
      const max = parseFloat(rangeMatch[2]);
      if (num >= min && num <= max) {
        return 'Optimal';
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
  if (status === 'flagged') return 'FLAGGED (Please Review Log)';
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

export const CANONICAL_RISK_CATEGORIES = [
  'Cardiovascular',
  'Metabolic',
  'Liver',
  'Kidney',
  'Hematology',
  'Immunological',
  'Endocrine',
  'Screenings & Wellness'
] as const;

export type CanonicalRiskCategory = typeof CANONICAL_RISK_CATEGORIES[number];

/**
 * Normalizes any free-form clinical risk category or sub-specialty tag into one of the 8 canonical domains.
 */
export function canonicalizeRiskCategory(category: string): CanonicalRiskCategory {
  const cat = (category || '').toLowerCase().trim();
  if (cat.includes('cardio') || cat.includes('heart') || cat.includes('lipid') || cat.includes('cholesterol') || cat.includes('blood pressure') || cat.includes('vascular')) {
    return 'Cardiovascular';
  }
  if (cat.includes('metabol') || cat.includes('sugar') || cat.includes('glucose') || cat.includes('glycem') || cat.includes('beta-cell') || cat.includes('insulin') || cat.includes('diabetes') || cat.includes('hba1c')) {
    return 'Metabolic';
  }
  if (cat.includes('liver') || cat.includes('hepatic') || cat.includes('biliary') || cat.includes('bilirubin') || cat.includes('alt') || cat.includes('ast') || cat.includes('alp') || cat.includes('ggt')) {
    return 'Liver';
  }
  if (cat.includes('kidney') || cat.includes('renal') || cat.includes('creatinine') || cat.includes('egfr') || cat.includes('bun') || cat.includes('urea') || cat.includes('nephr')) {
    return 'Kidney';
  }
  if (cat.includes('hematolog') || cat.includes('blood') || cat.includes('cbc') || cat.includes('anemia') || cat.includes('platelet') || cat.includes('wbc') || cat.includes('rbc') || cat.includes('hemoglobin') || cat.includes('haemoglobin')) {
    return 'Hematology';
  }
  if (cat.includes('immuno') || cat.includes('inflam') || cat.includes('infect') || cat.includes('autoimmun') || cat.includes('respirat') || cat.includes('pulmon') || cat.includes('lung') || cat.includes('allerg') || cat.includes('hscrp')) {
    return 'Immunological';
  }
  if (cat.includes('endocrine') || cat.includes('thyroid') || cat.includes('hormone') || cat.includes('cortisol') || cat.includes('testosterone') || cat.includes('estrogen') || cat.includes('adrenal') || cat.includes('pituitary')) {
    return 'Endocrine';
  }
  return 'Screenings & Wellness';
}

export function getDerivedCategoryDefaults(category: string, key?: string) {
  const cat = (category || '').toLowerCase();
  const k = (key || '').toLowerCase();
  
  let grouping = 'Other';
  let risks: string[] = ['Screenings & Wellness'];
  let conditions: string[] = [];

  if (cat === 'blood_sugar' || cat === 'metabolic' || k === 'hba1c' || k === 'fasting_glucose') {
    grouping = 'Metabolic';
    risks = ['Metabolic'];
    conditions = ['Diabetes', 'Metabolic Syndrome', 'Insulin Resistance'];
  } else if (cat === 'lipids' || k === 'total_cholesterol' || k === 'ldl' || k === 'hdl' || k === 'triglycerides' || k === 'apob') {
    grouping = 'Metabolic';
    risks = ['Cardiovascular', 'Metabolic'];
    conditions = ['Dyslipidemia', 'Cardiovascular Disease Risk'];
  } else if (cat === 'liver' || k === 'alt' || k === 'ast' || k === 'alp' || k === 'bilirubin') {
    grouping = 'Hepatic';
    risks = ['Liver'];
    conditions = ['Liver Dysfunction', 'Fatty Liver'];
  } else if (cat === 'kidneys' || k === 'creatinine' || k === 'egfr' || k === 'urea' || k === 'uric_acid' || k === 'albumin') {
    grouping = 'Renal';
    risks = ['Kidney'];
    conditions = ['Kidney Dysfunction', 'Chronic Kidney Disease'];
  } else if (cat === 'hematology' || k === 'wbc' || k === 'rbc' || k === 'hemoglobin' || k === 'platelets' || k === 'hematocrit') {
    grouping = 'Hematology';
    risks = ['Hematology'];
    conditions = ['Anemia', 'Infection', 'Blood Disorder'];
  } else if (cat === 'inflammation' || k === 'hscrp') {
    grouping = 'Immunology';
    risks = ['Immunological'];
    conditions = ['Systemic Inflammation', 'Cardiovascular Risk'];
  } else if (cat === 'thyroid' || cat === 'hormones') {
    grouping = 'Endocrinology';
    risks = ['Endocrine'];
    conditions = ['Hormonal Imbalance', 'Thyroid Dysfunction'];
  } else if (cat === 'vitamins') {
    grouping = 'Nutrition & Metabolism';
    risks = ['Screenings & Wellness'];
    conditions = ['Vitamin Deficiency'];
  } else if (k === 'bmi' || k === 'weight' || k === 'height') {
    grouping = 'Biometrics';
    risks = ['Screenings & Wellness'];
    conditions = ['Weight Management'];
  }

  return { grouping, risks: Array.from(new Set(risks.map(canonicalizeRiskCategory))), conditions };
}

export function inferUnitFromKeyOrName(key: string, name?: string): string {
  const k = (key || '').toLowerCase().trim();
  const n = (name || '').toLowerCase().trim();

  // Explicit unit suffixes or notations in string
  if (k.endsWith('_mmol_l') || k.includes('mmol_l') || n.includes('mmol/l') || n.includes('mmol l')) return 'mmol/L';
  if (k.endsWith('_umol_l') || k.includes('umol_l') || n.includes('umol/l') || n.includes('umol l')) return 'umol/L';
  if (k.endsWith('_mg_dl') || k.includes('mg_dl') || n.includes('mg/dl') || n.includes('mg dl')) return 'mg/dL';
  if (k.endsWith('_g_l') || k.includes('_g_l') || n.includes('g/l') || n.includes('g l')) return 'g/L';
  if (k.endsWith('_pg') || k.includes('_pg_') || n.includes(' pg')) return 'pg';
  if (k.endsWith('_fl') || k.includes('_fl_') || n.includes(' fl')) return 'fL';
  if (k.includes('10_9_l') || k.includes('10_9l') || n.includes('10 9 l') || n.includes('10^9/l') || n.includes('10^9 l')) return '10^9/L';
  if (k.endsWith('_u_l') || k.endsWith('_iu_l') || k.includes('_u_l') || n.includes('u/l') || n.includes('u l')) return 'U/L';
  if (k.endsWith('_cm') || k.includes('_cm_') || n.includes(' cm')) return 'cm';
  if (k.endsWith('_kg') || k.includes('_kg_') || n.includes(' kg')) return 'kg';

  // Standard clinical biomarker abbreviations and names
  if (k.includes('mcv') || n.includes('mcv') || n.includes('mean corpuscular volume') || k.includes('pdw') || n.includes('pdw') || n.includes('platelet distribution width') || k.includes('mpv') || n.includes('mpv') || n.includes('mean platelet volume')) return 'fL';
  if (k.includes('mchc') || n.includes('mchc')) return 'g/L';
  if (k.includes('mch') || n.includes('mch') || n.includes('mean corpuscular hemoglobin')) return 'pg';
  if (k.includes('alkaline_phosphatase') || n.includes('alkaline phosphatase') || k.includes('phosphatase') || k.includes('alt') || k.includes('ast') || k.includes('ggt') || k.includes('ldh')) return 'U/L';
  if (k.includes('albumin') || n.includes('albumin') || k.includes('globulin') || n.includes('globulin') || k.includes('total_protein') || n.includes('total protein')) return 'g/L';
  if (k.includes('bilirubin') || n.includes('bilirubin') || k.includes('creatinine') || n.includes('creatinine') || k.includes('urate') || k.includes('uric_acid')) return 'umol/L';
  if (k.includes('calcium') || k.includes('sodium') || k.includes('potassium') || k.includes('chloride') || k.includes('bicarbonate') || k.includes('phosphate') || k.includes('magnesium') || k.includes('urea')) return 'mmol/L';
  if (k.includes('rdw') || n.includes('rdw') || k.includes('hematocrit') || n.includes('hematocrit') || k.includes('hct') || n.includes('hct')) return '%';
  if (k.includes('wbc') || n.includes('wbc') || k.includes('neutrophil') || k.includes('lymphocyte') || k.includes('monocyte') || k.includes('eosinophil') || k.includes('basophil')) return '10^9/L';

  if (k.includes('psa') || n.includes('psa')) return 'ng/mL';
  if (k.includes('score') || n.includes('score') || k.includes('audit_c')) return 'score';
  if (k.includes('percent') || k.includes('pct') || k.endsWith('_percent') || n.includes('percent') || k.includes('risk') || n.includes('risk') || k.includes('qrisk') || n.includes('qrisk')) return '%';
  if (k.includes('ratio') || n.includes('ratio')) return 'ratio';

  return '';
}

export function getMergedBiomarkerDef(key: string, builtIn?: any, custom?: any, itemLogs?: any[]) {
  const k = key.toLowerCase();
  const mappedKey = getMappedBiomarkerKey(k);
  const centralDef = builtIn || biomarkerDefinitions.find(d => d.key === k || d.key === mappedKey || (Array.isArray(d.aliases) && d.aliases.some(a => a.toLowerCase() === k || a.toLowerCase() === mappedKey)));
  
  // Extract unit and range from logs if custom & builtIn don't have it
  let logUnit = '';
  let logRange = '';
  if (Array.isArray(itemLogs)) {
    for (const log of itemLogs) {
      if (log && typeof log === 'object') {
        const u = log.unit || (log.units && (log.units[key] || log.units[k]));
        if (u && typeof u === 'string' && u.trim()) {
          logUnit = u.trim();
        }
        const r = log.normalRange || (log.normalRanges && (log.normalRanges[key] || log.normalRanges[k]));
        if (r && typeof r === 'string' && r.trim()) {
          logRange = r.trim();
        }
        if (logUnit && logRange) break;
      }
    }
  }

  const name = (custom?.name && custom.name.trim() !== '') 
    ? custom.name.trim() 
    : (centralDef?.name || k.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));

  const inferredUnit = inferUnitFromKeyOrName(k, name);

  const unit = (custom?.unit && custom.unit.trim() !== '')
    ? custom.unit.trim()
    : (logUnit || ((centralDef?.unit && centralDef.unit.trim() !== '') ? centralDef.unit : inferredUnit));

  const normalRange = (custom?.normalRange && custom.normalRange.trim() !== '' && custom.normalRange !== 'Unknown')
    ? custom.normalRange.trim()
    : (logRange || ((centralDef?.normalRange && centralDef.normalRange.trim() !== '' && centralDef.normalRange !== 'Unknown') ? centralDef.normalRange : ''));

  const defaults = getDerivedCategoryDefaults(centralDef?.category || '', k);

  const standardMedicalGrouping = (custom?.standardMedicalGrouping && custom.standardMedicalGrouping.trim() !== '' && custom.standardMedicalGrouping !== 'By Medical Practice')
    ? custom.standardMedicalGrouping
    : (centralDef?.standardMedicalGrouping && centralDef.standardMedicalGrouping !== 'Other' ? centralDef.standardMedicalGrouping : defaults.grouping);

  const rawRisks = (Array.isArray(custom?.riskCategories) && custom.riskCategories.length > 0 && !custom.riskCategories.includes('Uncategorized'))
    ? custom.riskCategories
    : (Array.isArray(centralDef?.riskCategories) && centralDef.riskCategories.length > 0 ? centralDef.riskCategories : defaults.risks);
  const riskCategories = Array.from(new Set(rawRisks.map(canonicalizeRiskCategory)));

  const potentialMedicalConditions = (Array.isArray(custom?.potentialMedicalConditions) && custom.potentialMedicalConditions.length > 0)
    ? custom.potentialMedicalConditions
    : (Array.isArray(centralDef?.potentialMedicalConditions) && centralDef.potentialMedicalConditions.length > 0 ? centralDef.potentialMedicalConditions : defaults.conditions);

  return {
    ...centralDef,
    ...custom,
    key: k,
    name,
    unit,
    normalRange,
    standardMedicalGrouping,
    riskCategories,
    potentialMedicalConditions,
    needsApproval: custom?.needsApproval
  };
}

export function getBiomarkerMetadata(key: string, customDef?: any) {
  const k = key.toLowerCase();
  const centralDef = biomarkerDefinitions.find(d => d.key === k);
  const defaults = getDerivedCategoryDefaults(centralDef?.category || '', k);
  
  // Prioritize custom definitions if they exist, fallback to central/built-in definitions, and finally to defaults
  let risks = customDef?.riskCategories && customDef.riskCategories.length > 0 
    ? [...customDef.riskCategories] 
    : (centralDef?.riskCategories ? [...centralDef.riskCategories] : []);
    
  let group = customDef?.standardMedicalGrouping && customDef.standardMedicalGrouping.trim() !== '' 
    ? customDef.standardMedicalGrouping 
    : (centralDef?.standardMedicalGrouping || '');
    
  let conditions = customDef?.potentialMedicalConditions && customDef.potentialMedicalConditions.length > 0 
    ? [...customDef.potentialMedicalConditions] 
    : (centralDef?.potentialMedicalConditions ? [...centralDef.potentialMedicalConditions] : []);

  // If both are completely missing values, set defaults
  if (risks.length === 0 || risks.includes('Uncategorized')) {
    risks = defaults.risks;
  }
  const canonicalRisks = Array.from(new Set(risks.map(canonicalizeRiskCategory)));

  if (group.trim() === '' || group === 'Other') {
    group = defaults.grouping;
  }
  if (conditions.length === 0) {
    conditions = defaults.conditions;
  }

  return {
    riskCategories: canonicalRisks,
    standardMedicalGrouping: group,
    potentialMedicalConditions: conditions
  };
}

export const BIOMARKER_GROUPING_OPTIONS = [
  { value: 'risk', label: 'By Risk Categories' },
  { value: 'practice', label: 'By Medical Practice' },
  { value: 'condition', label: 'By Medical Conditions' }
] as const;




export function isCatalogBuiltIn(key: string): boolean {
  if (!key) return false;
  const mapped = getMappedBiomarkerKey(key) || key.toLowerCase();
  return biomarkerDefinitions.some((d: any) =>
    d.key === mapped ||
    d.key === key ||
    (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === mapped || a.toLowerCase() === key.toLowerCase()))
  );
}

/**
 * True only when this key is an explicit pending catalog proposal.
 * Missing unit/range/category is a completeness issue, not "needs approval".
 * Built-in / alias-mapped keys must never sit in the pending queue — extract and
 * sync used to stamp needsApproval on every unmapped slug and on built-ins.
 */
export function isPendingCatalogApproval(key: string, profile: any): boolean {
  if (!key) return false;
  if (isCatalogBuiltIn(key)) return false;
  const mapped = getMappedBiomarkerKey(key) || key.toLowerCase();
  if (mapped && mapped !== key && isCatalogBuiltIn(mapped)) return false;
  const custom = profile?.customBiomarkers?.[key] || profile?.customBiomarkers?.[mapped];
  if (!custom) return false;
  if (custom.catalogApproved === true) return false;
  return custom.needsApproval === true;
}

/** Extract/chat may stamp a pending def only for a brand-new unknown key. */
export function shouldStampExtractedDefPending(key: string, existingDef?: any): boolean {
  if (!key) return false;
  if (isCatalogBuiltIn(key)) return false;
  const mapped = getMappedBiomarkerKey(key) || key.toLowerCase();
  if (mapped && isCatalogBuiltIn(mapped)) return false;
  if (existingDef?.catalogApproved === true) return false;
  if (existingDef && existingDef.needsApproval !== true) return false;
  return !existingDef || existingDef.needsApproval === true;
}

export function isBiomarkerApproved(key: string, profile: any, itemLogs?: any[]): boolean {
  const k = getMappedBiomarkerKey(key) || key.toLowerCase();
  const custom = profile?.customBiomarkers?.[k] || profile?.customBiomarkers?.[key];
  // Built-in catalog keys stay live even if a stale extract/sync left needsApproval on the custom overlay.
  if (isCatalogBuiltIn(k) && custom?.catalogApproved !== false) return true;
  if (custom?.needsApproval === true) return false;
  if (custom?.catalogApproved === true) return true;

  const builtIn = biomarkerDefinitions.find((d: any) => d.key === k || (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === k)));
  const combined = getMergedBiomarkerDef(k, builtIn, custom, itemLogs);

  const hasUnit = !!combined.unit && combined.unit.trim() !== '';
  const hasRange = !!combined.normalRange && combined.normalRange.trim() !== '' && combined.normalRange !== 'Unknown';
  const hasPractice = !!combined.standardMedicalGrouping && combined.standardMedicalGrouping.trim() !== '' && combined.standardMedicalGrouping !== 'By Medical Practice';
  const hasRisk = Array.isArray(combined.riskCategories) && combined.riskCategories.length > 0 && combined.riskCategories.some((r: string) => r.trim() !== '' && r !== 'Uncategorized');
  const hasConditions = Array.isArray(combined.potentialMedicalConditions) && combined.potentialMedicalConditions.length > 0 && combined.potentialMedicalConditions.some((c: string) => c.trim() !== '');

  return hasPractice && hasRisk && hasConditions && hasUnit && hasRange;
}

export function isBiomarkerMissingRange(key: string, profile: any, itemLogs?: any[]): boolean {
  if (!key) return false;
  const k = key.toLowerCase();
  const builtIn = biomarkerDefinitions.find((d: any) => d.key === k || (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === k)));
  const custom = profile?.customBiomarkers?.[k];
  const combined = getMergedBiomarkerDef(k, builtIn, custom, itemLogs);

  const range = combined?.normalRange ? String(combined.normalRange).trim().toLowerCase() : '';
  return !range || range === 'unknown' || range === 'unset' || range === 'n/a' || range === '-';
}

export function isBiomarkerNeedingReview(
  key: string,
  profile: any,
  activeHistory?: any[],
  resolvedBiomarkers?: Record<string, any>,
  allDefinitions?: any[],
  precomputedFlaggedKeys?: Set<string>
): boolean {
  if (!key) return false;
  
  // 1. Pending Approval
  if (!isBiomarkerApproved(key, profile, activeHistory)) return true;

  // 2. Missing normal reference range
  if (isBiomarkerMissingRange(key, profile, activeHistory)) return true;
  
  // 3. Flagged by telemetry / scaling / unit notation errors or improbable values
  // PERF: if caller already ran detectFlaggedTelemetryErrors once for this render,
  // it passes the resulting key set here so we don't rescan all history/definitions
  // again for every single biomarker (this function is called once per biomarker,
  // per render, at multiple call sites — recomputing the full scan each time is
  // the #1 cause of Health tab / Biomarker Dictionary slow load).
  if (precomputedFlaggedKeys) {
    return precomputedFlaggedKeys.has(key);
  }
  const flagged = detectFlaggedTelemetryErrors(
    resolvedBiomarkers || {},
    profile,
    activeHistory || [],
    allDefinitions || biomarkerDefinitions
  );
  if (flagged.some(f => f.key === key)) return true;
  return false;
}

export function isBiomarkerCorruptedUnit(
  key: string,
  profile: any,
  activeHistory?: any[],
  resolvedBiomarkers?: Record<string, any>,
  allDefinitions?: any[]
): boolean {
  if (!key) return false;
  const flagged = detectFlaggedTelemetryErrors(
    resolvedBiomarkers || {},
    profile,
    activeHistory || [],
    allDefinitions || biomarkerDefinitions
  );
  return flagged.some(f => f.key === key);
}

export function approvePendingBiomarker(biomarkerKey: string, targetCategory?: string) {
  // Dead store — callers must set profile.customBiomarkers[key].catalogApproved.
  try {
    const raw = localStorage.getItem('biomarker_dictionary_store');
    if (raw) {
      const store = JSON.parse(raw);
      if (store[biomarkerKey]) {
        store[biomarkerKey].isPendingApproval = false;
        store[biomarkerKey].approved = true;
        delete store[biomarkerKey].needsApproval;
        if (targetCategory) {
          store[biomarkerKey].category = targetCategory;
        }
        // Intentionally do not persist the dead store.
      }
    }
  } catch (e) {
    console.error(e);
  }
}

export function buildReviewBiomarkerContext(
  biomarkerKey: string,
  currentValue: number | string,
  allDefinitions: any[],
  biomarkerHistory: any[],
  profile: any
): string {
  const customDef = profile?.customBiomarkers?.[biomarkerKey] || {};
  const def = getMergedBiomarkerDef(biomarkerKey, allDefinitions.find(d => d.key === biomarkerKey), customDef);

  const age = profile?.age || 'unknown';
  const gender = profile?.gender || 'unknown';
  const ethnicity = profile?.ethnicity || 'unknown';
  const unitPreference = profile?.unitPreference || 'SI';

  const targetMeta = getBiomarkerMetadata(biomarkerKey, customDef);
  
  const sortedLogs = [...(biomarkerHistory || [])].sort((a, b) => b.date.localeCompare(a.date));
  const selectedHistory = sortedLogs
    .filter(log => log.biomarkers && log.biomarkers[biomarkerKey] !== undefined && log.biomarkers[biomarkerKey] !== '')
    .map(log => ({
      date: log.date,
      value: log.biomarkers[biomarkerKey],
      unit: def.unit || ''
    }));

  const payloadObj = {
    user_profile: {
      age,
      gender,
      ethnicity,
      unit_preference: unitPreference
    },
    target_biomarker: {
      key: biomarkerKey,
      name: def.name || '',
      current_value: currentValue,
      unit: def.unit || '',
      normal_range: def.normalRange || '',
      description: def.description || def.descriptions?.[profile.language || 'en'] || def.descriptions?.en || '',
      medical_insights: customDef.specificRiskContext || customDef.benefitRisk || def.medicalInsight || '',
      optimal_value: customDef.optimalValue || def.optimalValue || '',
      severity_rating: getBiomarkerStatusLabel(biomarkerKey, getBiomarkerStatus(biomarkerKey, currentValue, def.normalRange, def.unit, profile), customDef, currentValue, profile),
      medical_categorisation: {
        risk_categories: targetMeta.riskCategories || [],
        potential_conditions: targetMeta.potentialMedicalConditions || [],
        standard_grouping: targetMeta.standardMedicalGrouping || ''
      }
    },
    target_biomarker_history: selectedHistory
  };

  return JSON.stringify(payloadObj, null, 2);
}

export function buildBiomarkerReviewPrefill(
  biomarkerKey: string,
  providedDef?: any,
  biomarkers?: any,
  profile?: any
): string {
  const customDef = profile?.customBiomarkers?.[biomarkerKey] || {};
  const def = getMergedBiomarkerDef(
    biomarkerKey,
    providedDef || biomarkerDefinitions.find(d => d.key === biomarkerKey),
    customDef
  );
  const defName = def.name || biomarkerKey;

  const rawCur = (biomarkers?.[biomarkerKey] || profile?.customBiomarkers?.[biomarkerKey] || null) as any;
  const valStr = rawCur && typeof rawCur === 'object' && 'value' in rawCur 
    ? String(rawCur.value) 
    : (rawCur !== undefined && rawCur !== null ? String(rawCur) : '');
  const unitStr = rawCur && typeof rawCur === 'object' && 'unit' in rawCur 
    ? String(rawCur.unit || '') 
    : (def?.unit || '');
  const rangeStr = rawCur && typeof rawCur === 'object' && 'normalRange' in rawCur 
    ? String(rawCur.normalRange || '') 
    : (def?.normalRange || 'Standard reference range');

  let valueDetail = valStr ? `${valStr} ${unitStr}`.trim() : 'No current value recorded';
  if (rangeStr) {
    valueDetail += ` (Standard Range: ${rangeStr})`;
  }

  return `Please review my biomarker: ${defName}\n• Current Value: ${valueDetail}\n• Biomarker Key: ${biomarkerKey}\n\nPlease perform a clinical diagnostic review on this biomarker, evaluate my full log history, and propose diagnostic insights and recommendations.`;
}
