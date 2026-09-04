import { Type } from '@google/genai';

/**
 * F-8.10 shard 3 — dietitian response schema, extracted verbatim from
 * runFoodAnalyze. Static literal: Level-2 estimate `required` lists P/C/F
 * macros + sodium, never `calories` (food-calc §1b grammar enforcement).
 */
export const foodAnalyzeSchema = {
      type: Type.OBJECT,
      properties: {
        _internalReasoning: { type: Type.STRING, description: "Silently gather clinical evidence and synthesize trade-offs before writing the final output." },
        verdict: {
          type: Type.OBJECT,
          properties: {
            label: { type: Type.STRING, description: "Strictly concise (3-6 words) biological health benefit or metric impact label, e.g., 'Within Daily Calorie Target', 'Elevated Saturated Fat Impact', or 'Supports Lean Muscle Growth'." },
            level: { type: Type.STRING, description: "'good' | 'warning' | 'alert' | 'neutral'" }
          },
          required: ["label", "level"]
        },
        message: { type: Type.STRING, description: "Primary clinical assessment, incorporating comforting and supportive tone, next step coaching, and meal balancing suggestions. Do NOT repeat raw calorie, sat fat, or sodium numbers." },
        modificationCommand: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING, enum: ['update_weight', 'update_component_weight', 'update_modifier', 'remove_item', 'add_item', 'replace_item', 'replace_identity', 'split_item', 'set_count', 'rename_alias', 'update_cooking_method'] },
              itemName: { type: Type.STRING },
              newWeightGrams: { type: Type.INTEGER, nullable: true },
              targetDbId: { type: Type.STRING, nullable: true },
              componentName: { type: Type.STRING, nullable: true, description: "Required when action is 'update_component_weight'. The name of the specific ingredient/component inside the composite dish named by itemName (e.g. itemName='Sizzling Steak with Wedges', componentName='Beef Steak')." },
              modifier: { type: Type.STRING, nullable: true, description: "Required when action is 'update_modifier'. The text modifier to apply (e.g. 'unsweetened', 'no sugar', 'no oil', 'no salt')." },
              newItemName: { type: Type.STRING, nullable: true, description: "Required when action changes item identity/name (replace_identity, replace_item)." },
              replacementItemName: { type: Type.STRING, nullable: true },
              newCookingMethod: { type: Type.STRING, nullable: true },
              count: { type: Type.INTEGER, nullable: true },
              estimate: {
                type: Type.OBJECT,
                description: "The nutrient profile for itemName at its current or new weight. For replace_identity, replace_item, add_item, and split_item this MUST reflect the NEW identity's real nutrient composition (e.g. near-zero carbohydrates for a plain grilled fish/meat). For all other actions, echo the item's existing known values from the provided ledger context — do not invent implausible numbers.",
                properties: {
                  protein: { type: Type.NUMBER, description: "Grams of protein. Use 0 only if genuinely protein-free." },
                  carbohydrates: { type: Type.NUMBER, description: "Grams of carbohydrates. Use 0 for plain unbreaded meat/fish/poultry." },
                  totalFat: { type: Type.NUMBER },
                  saturatedFat: { type: Type.NUMBER },
                  sodium: { type: Type.NUMBER },
                  transFat: { type: Type.NUMBER, nullable: true },
                  sugar: { type: Type.NUMBER, nullable: true },
                  totalSugar: { type: Type.NUMBER, nullable: true },
                  addedSugar: { type: Type.NUMBER, nullable: true },
                  totalFibre: { type: Type.NUMBER, nullable: true },
                  cookingMethod: { type: Type.STRING, nullable: true },
                  foodType: { type: Type.STRING, nullable: true }
                },
                required: ["protein", "carbohydrates", "totalFat", "saturatedFat", "sodium"]
              },
              into: {
                type: Type.ARRAY,
                nullable: true,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    grams: { type: Type.NUMBER, nullable: true },
                    role: { type: Type.STRING, nullable: true },
                    estimate: {
                      type: Type.OBJECT,
                      description: "Nutrient profile for this split-off portion. Must reflect its real composition.",
                      properties: {
                        protein: { type: Type.NUMBER },
                        carbohydrates: { type: Type.NUMBER },
                        totalFat: { type: Type.NUMBER },
                        saturatedFat: { type: Type.NUMBER },
                        sodium: { type: Type.NUMBER },
                        transFat: { type: Type.NUMBER, nullable: true },
                        sugar: { type: Type.NUMBER, nullable: true },
                        totalSugar: { type: Type.NUMBER, nullable: true },
                        addedSugar: { type: Type.NUMBER, nullable: true },
                        totalFibre: { type: Type.NUMBER, nullable: true },
                      },
                      required: ["protein", "carbohydrates", "totalFat", "saturatedFat", "sodium"]
                    }
                  },
                  required: ["name", "estimate"]
                }
              }
            },
            required: ["action", "itemName", "estimate"]
          },
          nullable: true
        },
        foodData: {
          type: Type.OBJECT,
          properties: {
            date: { type: Type.STRING, description: "YYYY-MM-DD" },
            name: { type: Type.STRING },
            itemsBreakdown: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  scoutIndex: { type: Type.INTEGER },
                  canonicalDbName: { type: Type.STRING, description: "Standard database or product name, extremely concise (e.g. 'Whole Rolled Oats'). Do NOT include scaling, rationale, calculations, or explanations." },
                  weightGrams: { type: Type.INTEGER },
                  foodType: {
                    type: Type.STRING,
                    enum: ['grain', 'protein', 'vegetable', 'fruit', 'dairy', 'fat/oil', 'beverage', 'snack', 'condiment', 'prepared dish/entree', 'other'],
                    description: "Strictly one of: 'grain', 'protein', 'vegetable', 'fruit', 'dairy', 'fat/oil', 'beverage', 'snack', 'condiment', 'prepared dish/entree', 'other'.",
                    nullable: true
                  },
                  cookingMethod: { type: Type.STRING, description: "Concise cooking method (e.g. 'raw', 'baked', 'grilled', 'boiled', 'fried').", nullable: true },
                  correctedNutrients: {
                    type: Type.OBJECT,
                    properties: {
                      calories: { type: Type.NUMBER, nullable: true },
                      protein: { type: Type.NUMBER, nullable: true },
                      carbohydrates: { type: Type.NUMBER, nullable: true },
                      totalFat: { type: Type.NUMBER, nullable: true },
                      saturatedFat: { type: Type.NUMBER, nullable: true },
                      sodium: { type: Type.NUMBER, nullable: true },
                      addedSugar: { type: Type.NUMBER, nullable: true },
                      totalFibre: { type: Type.NUMBER, nullable: true },
                    },
                    nullable: true,
                    description: "Optional. If you identify an inaccurate or underestimated estimate (e.g. deep-fried oil absorption undercounted), output corrected values for this portion."
                  },
                  clinicalCorrectionNote: { type: Type.STRING, nullable: true, description: "If any nutrient was corrected, state the clinical reason (e.g. 'Adjusted fat +6g to account for deep-fried wonton oil absorption')." }
                },
                required: ["scoutIndex", "canonicalDbName", "weightGrams"]
              }
            }
          },
          required: ["date", "name"],
          nullable: true
        },
        comparison: {
          type: Type.OBJECT,
          properties: {
            comparisonTitle: { type: Type.STRING, nullable: true },
            auditChecklist: { type: Type.STRING, nullable: true },
            groups: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  groupName: { type: Type.STRING, description: "Descriptive name or option title e.g. 'Quaker Oats So Simple' or 'Tier 1 - Safest Choice'" },
                  scoutItemIndices: {
                    type: Type.ARRAY,
                    items: { type: Type.INTEGER },
                    description: "0-based indices of scout items placed in this group"
                  },
                  itemNames: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    nullable: true,
                    description: "Item names for text-only comparisons"
                  },
                  verdict: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      level: { type: Type.STRING }
                    },
                    required: ["label", "level"]
                  },
                  message: { type: Type.STRING, description: "Clinical advice comparing this option against patient biomarkers" },
                  averageNutrients: {
                    type: Type.OBJECT,
                    properties: {
                      calories: { type: Type.NUMBER, nullable: true },
                      protein: { type: Type.NUMBER, nullable: true },
                      totalFat: { type: Type.NUMBER, nullable: true },
                      saturatedFat: { type: Type.NUMBER, nullable: true },
                      sodium: { type: Type.NUMBER, nullable: true },
                      carbohydrates: { type: Type.NUMBER, nullable: true },
                      addedSugar: { type: Type.NUMBER, nullable: true },
                      totalFibre: { type: Type.NUMBER, nullable: true }
                    },
                    nullable: true
                  }
                },
                required: ["groupName", "scoutItemIndices", "verdict", "message"]
              }
            }
          },
          nullable: true
        }
      },
      propertyOrdering: ["_internalReasoning", "verdict", "message", "modificationCommand", "foodData", "comparison"],
      required: ["_internalReasoning", "verdict", "message"]
    };

/**
 * F-8.10 shard 9 — vision scout response schema, extracted verbatim from
 * runFoodAnalyze. Static literal; dish nutrients required are the P/C/F
 * estimate core (saturatedFat/totalFat/totalSugar at dish level).
 */
export const visionScoutResponseSchema = {
                type: Type.OBJECT,
                properties: {
                  _internalReasoning: { type: Type.STRING },
                  contentType: { type: Type.STRING, enum: ["visual", "menu_or_poster", "label", "text"] },
                  diningEnvironment: { type: Type.STRING, enum: ["home_cooked", "casual_restaurant", "fast_food_chain", "fine_dining", "airline", "unknown"] },
                  dishes: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        dishName: { type: Type.STRING },
                        chainName: { type: Type.STRING, nullable: true },
                        packageLabelText: { type: Type.STRING, nullable: true },
                        estimatedWeightGrams: { type: Type.NUMBER },
                        packGrams: { type: Type.NUMBER, nullable: true },
                        cookingMethod: { type: Type.STRING, enum: ["raw", "baked", "grilled", "boiled", "steamed", "deep_fried", "pan_fried", "stir_fried"] },
                        sourceImageIndex: { type: Type.INTEGER },
                        boundingBox2D: {
                          type: Type.ARRAY,
                          items: { type: Type.INTEGER },
                        },
                        isStandaloneCondimentPacket: { type: Type.BOOLEAN, nullable: true },
                        foods: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              foodName: { type: Type.STRING },
                              packageLabelText: { type: Type.STRING, nullable: true },
                              weightGrams: { type: Type.NUMBER },
                              packGrams: { type: Type.NUMBER, nullable: true },
                              sourceImageIndex: { type: Type.INTEGER, nullable: true },
                              rawNutritionLabel: {
                                type: Type.OBJECT,
                                nullable: true,
                                properties: {
                                  servingSize: { type: Type.STRING },
                                  calories: { type: Type.STRING },
                                  protein: { type: Type.STRING },
                                  totalFat: { type: Type.STRING },
                                  saturatedFat: { type: Type.STRING },
                                  transFat: { type: Type.STRING },
                                  totalCarbohydrate: { type: Type.STRING },
                                  sugar: { type: Type.STRING },
                                  addedSugar: { type: Type.STRING },
                                  sodium: { type: Type.STRING },
                                  salt: { type: Type.STRING },
                                  potassium: { type: Type.STRING },
                                  totalFibre: { type: Type.STRING },
                                },
                                required: ["servingSize", "calories"],
                              },
                              nutrients: {
                                type: Type.OBJECT,
                                properties: {
                                  protein: { type: Type.NUMBER },
                                  saturatedFat: { type: Type.NUMBER },
                                  addedSugar: { type: Type.NUMBER },
                                  totalFibre: { type: Type.NUMBER },
                                  sodium: { type: Type.NUMBER },
                                  carbohydrates: { type: Type.NUMBER },
                                },
                                required: ["protein", "saturatedFat", "addedSugar", "totalFibre", "sodium", "carbohydrates"],
                              },
                            },
                            required: ["foodName", "weightGrams", "nutrients"],
                          },
                        },
                        dishNutrients: {
                          type: Type.OBJECT,
                          properties: {
                            saturatedFat: { type: Type.NUMBER },
                            totalFat: { type: Type.NUMBER },
                            totalSugar: { type: Type.NUMBER },
                          },
                          required: ["saturatedFat", "totalFat", "totalSugar"],
                        },
                      },
                      required: ["dishName", "estimatedWeightGrams", "cookingMethod", "boundingBox2D", "foods", "dishNutrients"],
                    },
                  },
                },
                required: ["contentType", "diningEnvironment", "dishes"],
              };
