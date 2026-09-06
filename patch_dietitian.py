import re

with open('server_food_analyze_run.ts', 'r') as f:
    content = f.read()

target = r"""    } else {
      // Dietitian LLM removed: every create goes through the single-agent
      // projector \(precalc math \+ scout verdict ladder\)\. No model call\.
      addDebugLog\(`\[MealAgent\] Single-agent create: composing meal from precalc for \$\{visionScoutItems\.length\} dish\(es\) \(no LLM call\)\.`\);
      sendStreamEvent\(\{ type: 'status', stage: 'dietitian', status: 'completed', message: 'Meal analysis finalized\.' \}\);

      const mealName = resolveCreateMealTitle\(rawScoutData, visionScoutItems, userProfile\?\.language\);

      const \{ totalGrams, totalCals, totalP, totalC, totalF, totalSugar, totalAddedSugar, totalSatFat \} = sumPrecalcTotals\(preCalculatedItems\);

      let scoutVerdict = decideScoutVerdict\(\{ scoutVerdict: rawScoutData\?\.verdict, totals: \{ totalSugar, totalSatFat, totalP \}, mealName, language: userProfile\?\.language \}\);

      let rawAdvice = decideScoutAdvice\(\{ rawAdvice: rawScoutData\?\.clinicalAdvice \|\| rawScoutData\?\.message, totals: \{ totalSugar, totalSatFat, totalP \}, mealName, language: userProfile\?\.language \}\);

      const created = buildCreateSkipResponse\(\{
        rawScoutData, visionScoutItems, preCalculatedItems,
        totals: \{ totalGrams, totalCals, totalP, totalC, totalF, totalSugar, totalAddedSugar, totalSatFat \},
        scoutVerdict, rawAdvice, scoutConfidenceRating, scoutConfidenceComment, scoutCookingMethod,
        scoutInternalReasoning, diningEnvironment, language: userProfile\?\.language,
      \}\);
      textOutput = created\.textOutput;
      rawParsed = created\.rawParsed;
    \}
    addDebugLog\(`\[MealAgent\] Composed meal message \(projector, no LLM call\)\. Length: \$\{textOutput\.length\} chars\.`\);"""

replacement = """    } else {
      addDebugLog(`[MealAgent] Initiating Dietitian LLM evaluation...`);
      
      const timeCtx = buildTimeContext({ userTimezone: userProfile?.timezone, systemCurrentDate });
      const userCtx = buildUserContext(userProfile);
      const historyContext = buildHistoryContext(history);
      const imageCtx = buildImageContext(imagePayloads, imageDates);
      const visionScoutCtx = buildVisionScoutContext({
        visionScoutItems,
        visionScoutContentType,
        scoutConfidenceRating,
        scoutConfidenceComment,
        scoutCookingMethod,
        diningEnvironment,
        userSelectedMode,
        isExplicitModify,
        hasActiveMeal: !!effectiveActiveMeal,
        hasComparison: false,
        hasImages: hasUploadedNewImages,
      });
      const biomarkersCtx = buildBiomarkersContext(biomarkersNeedingImprovement);

      const systemInstruction = selectSystemInstruction({
        userSelectedMode,
        isExplicitModify,
        effectiveActiveMeal,
        activeComparisonState: null,
        biomarkersNeedingImprovement,
        remainingAllowance,
        foodLogs,
        userProfile,
        visionScoutItems,
      });

      let { promptText, fullPromptSent } = stitchFoodPrompt({
        systemInstruction,
        userSelectedMode,
        biomarkersCtx,
        visionScoutCtx,
        databaseMatchesCtx: buildDatabaseMatchesContext('', ''),
        historyContext,
        pastMealsCtx: '',
        userCtx,
        timeCtx,
        imageCtx,
        message,
      });

      const precalcRes = assemblePrecalcPromptBlock({
        preCalculatedItems,
        activeMeal: effectiveActiveMeal,
        aggregatedNutrients,
        userProfile,
        promptText,
        fullPromptSent,
        onLog: addDebugLog
      });
      promptText = precalcRes.promptText;
      fullPromptSent = precalcRes.fullPromptSent;
      
      addDebugLog(`[MealAgent] Dispatched System Instruction:\\n${systemInstruction}`);
      addDebugLog(`[MealAgent] Dispatched Prompt:\\n${promptText}`);

      const responseText = await callUnifiedLLM(
        engine || 'gemini-3.5-flash-lite',
        systemInstruction,
        promptText,
        imagePayloads || [],
        'application/json',
        8192,
        0.2,
        'dietitian',
        (chunk: string, isThought?: boolean) => {
          if (isStream && hasSentHeaders) {
             try {
               res.write(`data: ${JSON.stringify({ type: 'stream', chunk, stage: 'dietitian' })}\\n\\n`);
               if (typeof (res as any).flush === 'function') (res as any).flush();
             } catch(e) {}
          }
        }
      );
      
      textOutput = responseText;
      addDebugLog(`[MealAgent] Raw Dietitian LLM Response (${textOutput.length} chars):\\n${textOutput}`);
      
      try {
        const cleaned = textOutput.replace(/^```(?:json)?|```$/gm, '').trim();
        rawParsed = JSON.parse(cleaned);
      } catch (err: any) {
        addDebugLog(`[MealAgent] Failed to parse Dietitian JSON: ${err.message}`);
        throw new Error("Failed to parse Dietitian LLM output as JSON");
      }
    }"""

if re.search(target, content, flags=re.MULTILINE):
    content = re.sub(target, replacement, content, count=1, flags=re.MULTILINE)
    with open('server_food_analyze_run.ts', 'w') as f:
        f.write(content)
    print("Patched successfully!")
else:
    print("Target block not found!")
