          agentType: agentType || 'agent1_step1',
          numberOfBatches,
          extractedData,
          remainingText,
          bucketMapping: bucketMappingStr,
          estimatedTotalMarkers,
          currentBatch,
          reviewBiomarkerKey,
          dataReviewBatchKeys,
          dataReviewBatchIdx,
          batchSize
        };

        const userMsg: ChatMessage = {
          id: `msg_user_${Date.now()}`,
          role: 'user',
          content: textToSend,
          timestamp: new Date().toISOString()
        };

        const existingMsgs = (job?.messages && job.messages.length > 0)
          ? job.messages
          : [getWelcomeMessage()];
        const updatedMessages = [...existingMsgs, userMsg];

        let updatedProfile = profile ? { ...profile } : null;
        let reserved = 0;
        if (profile) {
          const resCredits = reserveCredits(profile, selectedModelId);
          reserved = resCredits.reserved;
          updatedProfile = resCredits.updatedProfile;
          if (onSaveProfile && updatedProfile) {
            await onSaveProfile(updatedProfile);
          }
        }

        if (job) {
          JobStore.updateJob(currentJobId, {
            status: 'queued',
            inputSnapshot,
            messages: updatedMessages,
            creditReserved: reserved,
            creditSettled: false,
            requestId: currentReqId
          });
        } else {
          JobStore.createJob({
            id: currentJobId,
            kind: 'medical',
            status: 'queued',
            inputSnapshot,
            messages: updatedMessages,
            creditReserved: reserved,
            creditSettled: false,
            requestId: currentReqId
          });
        }

        // Keep modal open, append messages to local React state
        const liveMsg: ChatMessage = {
          id: `msg_live_${currentJobId}`,
          role: 'assistant',
          content: 'Analyzing medical data in the background...',
          timestamp: new Date().toISOString(),
          isLive: true,
          agentType: 'medical',
          data: {
            userSelectedMode: 'review',
            hasImage: false,
            agentResult: {
              scoutScratchpad: 'Analysis queued...',
              dietitianScratchpad: ''
            }
          }
        };
        setMessages([...existingMsgs, userMsg, liveMsg], false);

        // Clear input compose dock
        setInputText('');

        // Wake queue runner & notify parent
        JobQueueRunner.wake();
        if (onJobEnqueued) {
          onJobEnqueued(currentJobId, 'medical');
        }
        onClose();
      } catch (err: any) {
        console.error('Failed to enqueue medical job:', err);
        const errorMsg: ChatMessage = {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: `⚠️ **Submission Failed**\n\n${err.message || 'An unexpected error occurred while queueing your request.'}`,
          timestamp: new Date().toISOString(),
          isError: true
        };
        setMessages(prev => [...prev, errorMsg]);
      }
      return;
    }

    if (!textToSend && finalImages.length === 0) {
      if (autoSendMessage) {
        textToSend = autoSendMessage;
      } else if (reviewBiomarkerKey) {
        textToSend = buildBiomarkerReviewPrefill(reviewBiomarkerKey, undefined, biomarkers, profile);
      } else if (isAgent('biomarker_review') || agentType === 'biomarker_review') {
        textToSend = 'Please review my full set of biomarker data and log history.';
      }
    }

    if (!textToSend && finalImages.length === 0) return;

    // Eagerly wait for geolocation if doing food ideas and it's not resolved yet
    let loc = userLocation;
    if (isAgent('food_idea') && !loc) {
      if (navigator.geolocation) {
        try {
          console.log("[Geolocation] Awaiting geolocation resolution before food-idea request...");
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 });
          });
          loc = { lat: position.coords.latitude, lng: position.coords.longitude };
          setUserLocation(loc);
        } catch (err) {
          console.warn("[Geolocation] Could not await location during handleSend:", err);
        }
      }
    }

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: textToSend,
      timestamp: new Date().toISOString(),
      imageUrl: finalImages[0] || undefined,
      imageUrls: finalImages.length > 0 ? finalImages : undefined,
      data: {
        userSelectedMode: mappedMode
      }
    };

    const isFood = isAgent('food');
    const liveMsg: ChatMessage = {
      id: `msg_live_${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isLive: true,
      agentType: isFood ? 'food' : (isAgent('food_idea') ? 'food_idea' : (agentType || 'agent1')),
      data: {
        userSelectedMode: mappedMode,
        hasImage: finalImages.length > 0,
        agentResult: {
          scoutScratchpad: '',
          dietitianScratchpad: ''
        }
      }
    };

    setMessages(prev => [...prev, userMsg, liveMsg]);
    if (typeof overrideText !== 'string') {
      setInputText('');
    }
    const tempImages = overrideImagesInner.length > 0 ? overrideImagesInner : [...selectedImages];
    const tempAnalysisImages = overrideImagesInner.length > 0 ? overrideImagesInner : [...selectedImagesForAnalysis];
    const tempDates = overrideImagesInner.length > 0 ? [] : [...imageDates];
    setSelectedImages([]);
    setSelectedImagesForAnalysis([]);
    setImageDates([]);
    // Task 9: Only reset the live-log accumulator for brand-new submissions.
    // Portion-confirm turns (inPlaceMsgId set) preserve the prior logs so
    // the full turn-1 + turn-2 trace remains visible without a blank gap.
    const isPortionConfirmTurn = !!(extraOptions as any)?.inPlaceMsgId;
    if (!isPortionConfirmTurn) {
      setGlobalLiveLogs('');
      globalLiveLogsRef.current = '';
    }
    setIsAnalyzing(true);
    // Scroll immediately so the user can watch the agent's live thought process
    // as soon as the request starts, instead of waiting for the final answer.
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });

    try {
      if (isAgent('food')) {
        const executorInput: FoodAgentExecutorInput = {
          jobId: jobId || `legacy_${Date.now()}`,
          text: textToSend,
          images: tempImages.length > 0 ? tempImages : undefined,
          mode: mappedMode,
          lockedModeFamily: jobId ? JobStore.getJob(jobId)?.lockedModeFamily : undefined,
          profile,
          modelId: selectedModelId,
          requestId: currentReqId,
          activeScoutItems: activeScoutItemsFallback || undefined,
          scoutContentType: scoutContentTypeFallback || undefined,
          skipScout,
          activeFoodLogs: activeFoodLogs,
          outOfRangeBiomarkers,
          remainingAllowance,
          messages,
        };

        let resData: any = null;
        let lastCheckpoint: any = null;

        for await (const event of executeFoodAgent(executorInput)) {
          if (event.type === 'checkpoint' && event.checkpoint) {
             lastCheckpoint = event.checkpoint;
             setMessages(prev => {
