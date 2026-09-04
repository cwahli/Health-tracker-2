import * as fs from 'fs';
const content = fs.readFileSync('server_food_analyze_run.ts', 'utf8');

const startStr = "    async function callAndParseFoodAnalysis(callArgs: any): Promise<{ textOutput: string; rawParsed: any }> {";
const endStr = "    // Pre-dietitian density check:";

const startIndex = content.indexOf(startStr);
const endIndex = content.indexOf(endStr);

if (startIndex !== -1 && endIndex !== -1) {
  const chunk = content.substring(startIndex, endIndex);
  console.log("Chunk length:", chunk.length);
  // Find variables it uses from outer scope. 
  // It uses `isStream`, `res`, `callUnifiedLLM`, `extractBalancedJson`.
  // Let's create the external function.
  const externalFunc = `
import { callUnifiedLLM, extractBalancedJson } from '../../../server.js';

export async function callAndParseFoodAnalysis(callArgs: any, isStream: boolean, res: any): Promise<{ textOutput: string; rawParsed: any }> {
${chunk.replace("async function callAndParseFoodAnalysis(callArgs: any): Promise<{ textOutput: string; rawParsed: any }> {", "").slice(0, -5)}
}
`;
  fs.writeFileSync('src/server/food/server_food_analyze_llm.ts', externalFunc);
  
  // Replace in original
  let newContent = content.replace(chunk, `    const { callAndParseFoodAnalysis } = await import('./src/server/food/server_food_analyze_llm.js');\n    // (Replaced by external function)\n`);
  // also need to fix the call site: callAndParseFoodAnalysis(llmCallArgs) -> callAndParseFoodAnalysis(llmCallArgs, isStream, res)
  newContent = newContent.replace(/callAndParseFoodAnalysis\(llmCallArgs\)/g, 'callAndParseFoodAnalysis(llmCallArgs, isStream, res)');
  
  fs.writeFileSync('server_food_analyze_run.ts', newContent);
  console.log("Extracted callAndParseFoodAnalysis");
}
