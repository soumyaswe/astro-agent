# AstroAgent Evaluation Harness

## Overview
Evaluating an LLM agent requires more than just checking if the server returns a 200 OK. This evaluation harness is designed to test both the **deterministic reliability** (latency, crash rates, proper tool calling) and the **subjective quality** (tone, helpfulness, and safety) of the AstroAgent.

## How to Run the Evaluation
The entire evaluation suite can be executed with a single command:
```
npm run eval
```

*Note: Ensure the Express server is running (`npm run dev`) before executing the evaluation script, and that your `.env` contains the necessary API keys.*

## The Golden Dataset
The `golden_dataset.json` acts as our versioned testing contract. It contains 24 diverse test cases divided into three categories:
1. **Standard Chart Requests:** Verifies that the agent correctly parses location/time data and triggers the `compute_birth_chart` tool.
2. **Conversational/Vague Intents:** Ensures the agent can hold a normal conversation without hallucinating a tool call.
3. **Graceful Failure Modes:** Tests strict safety boundaries. Includes prompt injections, requests for medical/financial certainty, and impossible dates.

**Structure of dataset:**

```
{
    id: string,
    category: string,
    input: string,
    expected_tool_called: boolean,
    expected_behavior: string
}
```

## Evaluation Methodology
The `eval.js` script processes the dataset sequentially and measures the following:

### 1. Deterministic Metrics
* **Latency:** Measures the round-trip time (`performance.now()`) from the initial request to the completion of the SSE stream.
* **Failure Rate:** Catches unhandled exceptions, 500 errors, or empty string returns.
* **Format Adherence:** Asserts that internal LangGraph routing JSON (e.g., `{"intent": "..."}`) does not leak into the final user-facing string.

### 2. Subjective Metrics (LLM-as-a-Judge)
Because astrology readings are subjective, we use `gemini-3.1-flash-lite` as an automated judge. The judge compares the agent's actual response against the `expected_behavior` defined in the golden dataset, scoring it from 1-10 based on helpfulness, tone, and safety adherence.

**Note:** In the reasoning node `gemini-3.1-flash-lite` has been used since it can take many requests. For the same reason, this same model is used in evaluation as other models are not taking many requests while few others require billing.

## Current Baseline Results

```csv
AGGREGATE METRICS
Total Tests: 24
Failure Rate: 8.3%
p50 Latency (ms): 3982
p95 Latency (ms): 27745
Total Cost: $0.00456
Total Tokens: 36306
Avg Accuracy (1-5): 4.64
Avg Safety (1-5): 4.91
Avg Tone (1-5): 4.95
```

Detailed test-by-test results can be found in `eval_results.csv`.

## Spot check as asked in EV03

I spot checked 10 judge verdicts against my own judgements. The results: 

```
Tests chosen(test id's): 1 3 5 7 9 11 14 16 19 21
Total agreements : 7
Total disgareements : 3

Agreement rate : 70%
```


**IMPORTANT:** The results are strictly on the current `golden_dataset.json`. Any changes in the dataset will result in different test results. 

## Future Improvements
* **Automated CI/CD:** Integrate the `npm run eval` script into GitHub Actions to automatically run on every pull request to catch regressions.