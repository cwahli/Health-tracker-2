with open('server.ts', 'r') as f:
    content = f.read()

content = content.replace("""      return res.json({
          text: "",
          agentType,
          extractedYaml: textOutput,
          hasMoreMarkers: false,
          remainingText: "",
          estimatedTotalMarkers: 0,
          agentPrompt: fullPromptSent
      });
  } catch (error: any) {""", """      return res.json({
          text: "",
          agentType,
          extractedYaml: textOutput,
          hasMoreMarkers: false,
          remainingText: "",
          estimatedTotalMarkers: 0,
          agentPrompt: fullPromptSent
      });
    }
  } catch (error: any) {""")

with open('server.ts', 'w') as f:
    f.write(content)
