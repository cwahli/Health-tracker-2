import fs from 'fs';
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

const targetStr = `        const inputSnapshot = {
          text: userContent,
          imageRefs: [],
          imageDates: tempDates.length > 0 ? tempDates : (extraOptions?.imageDates || job?.inputSnapshot?.imageDates || undefined),
          hasImage: finalImages.length > 0,
          mode: submissionMode,
          portionChoices: extraOptions?.portionChoices,
          activeScoutItems: scoutItemsForJob,
          skipScout: extraOptions?.skipScout,
          scoutContentType: scoutContentTypeFallback,
          goldenCaseId: extraOptions?.goldenCaseId || (typeof overrideText === 'object' ? overrideText?.goldenCaseId : undefined),
        };`;

const replacement = `
        let strippedText = userContent || '';
        explicitFoodTags.forEach(t => {
          strippedText = strippedText.replace(\`[\${t.name} \${t.weightGrams}g]\`, '').replace(\`[\${t.name}]\`, '').replace('  ', ' ').trim();
        });
        const hasAdditionalText = strippedText.replace(/\\[.*?\\]/g, '').trim().length > 0;
        
        if (!hasAdditionalText && finalImages.length === 0 && explicitFoodTags.length === 1 && explicitFoodTags[0].source === 'previous_meal') {
          handleDuplicateFoodLog(explicitFoodTags[0].originalLog);
          setInputText('');
          setExplicitFoodTags([]);
          clearTimeout(failsafe);
          isSendingRef.current = false;
          setIsSubmitting(false);
          setIsAnalyzing(false);
          return;
        }

        const inputSnapshot = {
          text: userContent,
          imageRefs: [],
          imageDates: tempDates.length > 0 ? tempDates : (extraOptions?.imageDates || job?.inputSnapshot?.imageDates || undefined),
          hasImage: finalImages.length > 0,
          mode: submissionMode,
          portionChoices: extraOptions?.portionChoices,
          activeScoutItems: scoutItemsForJob,
          skipScout: extraOptions?.skipScout || (!hasAdditionalText && finalImages.length === 0),
          scoutContentType: scoutContentTypeFallback,
          goldenCaseId: extraOptions?.goldenCaseId || (typeof overrideText === 'object' ? overrideText?.goldenCaseId : undefined),
          explicitFoodTags: explicitFoodTags.length > 0 ? explicitFoodTags : undefined,
        };`;

code = code.replace(targetStr, replacement);
fs.writeFileSync('src/components/LogChat.tsx', code);
console.log("Patched input snapshot");
