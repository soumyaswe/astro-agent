require('dotenv').config();
const fs = require('fs/promises');
const { performance } = require('perf_hooks');
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");

// Pricing Constants (e.g. gemini-1.5-flash / gemini-3.5-flash-lite pricing)
const COST_PER_1M_INPUT = 0.075;
const COST_PER_1M_OUTPUT = 0.30;

// 1. Initialize LLM Judge
const judgeModel = new ChatGoogleGenerativeAI({
  model: "gemini-3.1-flash-lite", 
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0
});

// Helper for percentiles
function calculatePercentile(arr, p) {
  if (arr.length === 0) return 0;
  arr.sort((a, b) => a - b);
  const index = (p / 100) * (arr.length - 1);
  if (Math.floor(index) === index) return arr[index];
  const i = Math.floor(index);
  const fraction = index - i;
  return arr[i] + (arr[i + 1] - arr[i]) * fraction;
}

async function runEval() {
  console.log("Starting Evaluation with Strict Metrics & LLM-as-a-Judge...\n");
  
  let rawData;
  try {
    rawData = await fs.readFile('./golden_dataset.json', 'utf-8');
  } catch (err) {
    console.error("Failed to read golden_dataset.json.");
    return;
  }
  
  const dataset = JSON.parse(rawData);
  const results = [];
  
  const PORT = process.env.PORT || 4000;
  console.log(`Targeting API on port ${PORT}...\n`);
  
  let totalCost = 0;
  let totalToolCalls = 0;
  let totalTokens = 0;
  const latencies = [];
  
  // 2. The Loop
  for (let i = 0; i < dataset.length; i++) {
    const test = dataset[i];
    
    const sessionId = `${test.id}_${Date.now()}`;
    const startTime = performance.now();
    let responseText = '';
    let isSuccess = true;
    let failureReason = '';
    let llmScore = 0;
    let llmReason = '';
    
    let runTokensInput = 0;
    let runTokensOutput = 0;
    let runToolCalls = 0;
    let runCost = 0;
    
    try {
      // API Execution
      const res = await fetch(`http://localhost:${PORT}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: test.input, 
          userId: 'eval_user', 
          thread_id: sessionId 
        })
      });
      
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      
      const decoder = new TextDecoder("utf-8");
      const reader = res.body.getReader();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        
        // Proper SSE parsing
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.type === 'token') {
                responseText += data.value;
              } else if (data.type === 'end') {
                if (data.tools) runToolCalls = data.tools;
                if (data.usage) {
                  runTokensInput = data.usage.input_tokens || 0;
                  runTokensOutput = data.usage.output_tokens || 0;
                }
              }
            } catch (e) {
              // Ignore incomplete JSON chunks from SSE chunking
            }
          }
        }
      }
      
      const latency = performance.now() - startTime;
      
      // Calculate Cost
      runCost = ((runTokensInput / 1000000) * COST_PER_1M_INPUT) + 
                ((runTokensOutput / 1000000) * COST_PER_1M_OUTPUT);
      
      totalCost += runCost;
      totalToolCalls += runToolCalls;
      totalTokens += (runTokensInput + runTokensOutput);
      
      // Deterministic Checks
      if (responseText.trim() === '') {
        isSuccess = false;
        failureReason = 'Empty response string';
      } else if (responseText.includes('{"intent":')) {
        isSuccess = false;
        failureReason = 'Leaked JSON detected in stream';
      }
      
      // LLM-as-a-Judge Evaluation
      if (isSuccess) {
        try {
          const prompt = `You are evaluating an astrology AI. The user asked: '${test.input}'. The AI replied: '${responseText}'. Does the AI answer politely, safely, and match this expected behavior: '${test.expected_behavior}'? Reply with only a JSON object: {"score": [1-10], "reason": "brief explanation"}.`;
          
          const judgeResponse = await judgeModel.invoke(prompt);
          let content = judgeResponse.content;
          
          content = content.replace(/```json/g, '').replace(/```/g, '').trim();
          
          const parsed = JSON.parse(content);
          llmScore = parsed.score || 0;
          llmReason = parsed.reason || "No reason provided";
        } catch (e) {
          console.error(`  [!] LLM Judge failed: ${e.message}`);
          llmReason = `Judge Error: ${e.message}`;
          llmScore = 0;
        }
        
        // Rate limit handling
        await new Promise(r => setTimeout(r, 1000));
        latencies.push(latency); // Track latency for p50/p95 calculations
      }
      
      results.push({
        id: test.id,
        category: test.category,
        latencyMs: Math.round(latency),
        success: isSuccess,
        failureReason: isSuccess ? null : failureReason,
        actualResponseText: responseText,
        llmScore: llmScore,
        llmReason: llmReason,
        tokens: runTokensInput + runTokensOutput,
        cost: runCost,
        tools: runToolCalls
      });
      
      console.log(`✅ [${test.id}] - Latency: ${(latency/1000).toFixed(1)}s | Cost: $${runCost.toFixed(5)} | Tools: ${runToolCalls} | Score: ${llmScore}/10`);
      
    } catch (error) {
      const latency = performance.now() - startTime;
      results.push({
        id: test.id,
        category: test.category,
        latencyMs: Math.round(latency),
        success: false,
        failureReason: `Crash: ${error.message}`,
        actualResponseText: responseText,
        llmScore: 0,
        llmReason: '',
        tokens: 0,
        cost: 0,
        tools: 0
      });
      console.log(`❌ [${test.id}] - Latency: ${(latency/1000).toFixed(1)}s | Crash: ${error.message}`);
    }
  }
  
  // 3. Output CSV
  let csv = 'ID,Category,API_Success,LatencyMs,Tokens,Cost,Tools,LLM_Score,Judge_Reason\n';
  results.forEach(r => {
    const safeReason = (r.llmReason || r.failureReason || '').replace(/"/g, '""');
    csv += `"${r.id}","${r.category}",${r.success},${r.latencyMs},${r.tokens},${r.cost},${r.tools},${r.llmScore},"${safeReason}"\n`;
  });
  await fs.writeFile('./eval_results.csv', csv);
  
  // Scorecard Calculations
  const total = results.length;
  const passed = results.filter(r => r.success).length;
  const failureRate = ((total - passed) / total * 100).toFixed(1);
  
  const p50 = Math.round(calculatePercentile([...latencies], 50));
  const p95 = Math.round(calculatePercentile([...latencies], 95));
  
  console.log(`\n\n=== 📊 ASTROAGENT EVALUATION SCORECARD ===`);
  console.log(`Total Tests Run:     ${total}`);
  console.log(`Failure Rate:        ${failureRate}%`);
  console.log(`p50 Latency:         ${p50}ms`);
  console.log(`p95 Latency:         ${p95}ms`);
  console.log(`Total Tool Calls:    ${totalToolCalls}`);
  console.log(`Total Tokens Used:   ${totalTokens}`);
  console.log(`Total Dollar Cost:   $${totalCost.toFixed(5)}`);
  
  const tableData = results.map(r => ({
    Test: r.id,
    API: r.success ? 'PASS' : 'FAIL',
    Latency: `${r.latencyMs}ms`,
    Cost: `$${r.cost.toFixed(5)}`,
    Tools: r.tools,
    Score: r.llmScore > 0 ? r.llmScore : '-',
    Notes: r.success ? r.llmReason : r.failureReason
  }));
  
  console.table(tableData);
  console.log("\nDetailed results saved to eval_results.csv");
}

runEval().catch(console.error);
