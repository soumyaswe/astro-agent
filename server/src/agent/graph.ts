import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { AgentState } from "./state";
import { callModel, toolNode, shouldContinue, classifyIntent } from "./nodes";

const workflow = new StateGraph(AgentState)
  .addNode("classifier", classifyIntent)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge(START, "classifier")
  .addEdge("classifier", "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent");

const checkpointer = new MemorySaver();

export const app = workflow.compile({ checkpointer });
