import { Request, Response } from "express";
import { HumanMessage } from "@langchain/core/messages";
import { app as agentApp } from "../agent/graph";
import { BirthDetails } from "../agent/state";

export async function chatHandler(req: Request, res: Response): Promise<void> {
  const {
    message,
    userId,
    thread_id,
    userProfile,
  }: {
    message: string;
    userId: string;
    thread_id: string;
    userProfile?: {
      name?: string;
      date_of_birth?: string;
      time_of_birth?: string;
      place_of_birth?: string;
      latitude?: number;
      longitude?: number;
      timezone?: string;
    };
  } = req.body;

  if (!message || !userId || !thread_id) {
    res.status(400).json({ error: "message, userId, and thread_id are required." });
    return;
  }

  // Build birth_details from userProfile if provided
  const birth_details: BirthDetails | null = userProfile
    ? {
        name: userProfile.name,
        date_of_birth: userProfile.date_of_birth,
        time_of_birth: userProfile.time_of_birth,
        place_of_birth: userProfile.place_of_birth,
        latitude: userProfile.latitude,
        longitude: userProfile.longitude,
        timezone: userProfile.timezone,
      }
    : null;

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders(); // send headers immediately so the browser can start reading

  // Helper to write an SSE message
  const send = (payload: object) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const stream = agentApp.streamEvents(
      {
        messages: [new HumanMessage(message)],
        birth_details,
      },
      {
        version: "v2",
        configurable: { thread_id },
      }
    );

    for await (const event of stream) {
      const { event: eventType, name, data } = event;

      // Token streaming — model is generating text
      if (eventType === "on_chat_model_stream") {
        // Skip tokens from the intent classifier so they don't leak to the UI
        if (event.tags && event.tags.includes("classifier")) {
          continue;
        }

        const chunk = data?.chunk;
        const token: string =
          typeof chunk?.content === "string"
            ? chunk.content
            : Array.isArray(chunk?.content)
            ? chunk.content
                .filter((c: { type: string }) => c.type === "text")
                .map((c: { text: string }) => c.text)
                .join("")
            : "";

        if (token) {
          send({ type: "token", value: token });
        }
      }

      // Tool invocation started
      else if (eventType === "on_tool_start") {
        send({ type: "tool_start", tool: name });
      }

      // Tool invocation finished
      else if (eventType === "on_tool_end") {
        send({ type: "tool_end", tool: name });
      }
    }

    // Signal the client that the stream is done
    send({ type: "end" });
  } catch (err) {
    console.error("[/api/chat] Stream error:", err);
    send({ type: "error", message: "Stream failed unexpectedly." });
  } finally {
    res.end();
  }
}
