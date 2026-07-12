import re

with open('server.ts', 'r') as f:
    content = f.read()

bad_pattern = re.compile(r'if \(agentType === "agent1"\) \{\s*let cleanJson = textOutput.replace.*?res\.status\(500\)\.json\(\{ error: "Failed to standardize units: " \+ error\.message \}\);\s*\}\s*\}\);', re.DOTALL)

good_block = """      if (agentType === "agent1") {
        let cleanYaml = textOutput.replace(/```(?:yaml)?/gi, "").trim();
        return res.json({
          text: "",
          agentType,
          extractedYaml: cleanYaml,
          hasMoreMarkers: false,
          remainingText: "",
          estimatedTotalMarkers: 0,
          agentPrompt: fullPromptSent
        });
      }
      
      return res.json({
          text: "",
          agentType,
          extractedYaml: textOutput,
          hasMoreMarkers: false,
          remainingText: "",
          estimatedTotalMarkers: 0,
          agentPrompt: fullPromptSent
      });
  } catch (error: any) {
    console.error("[Medical Analyze Error]:", error);
    res.status(500).json({ error: "Failed to process medical analysis: " + error.message });
  }
});
"""

content = bad_pattern.sub(good_block, content)

with open('server.ts', 'w') as f:
    f.write(content)
