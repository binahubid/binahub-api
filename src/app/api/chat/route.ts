import { NextRequest, NextResponse } from "next/server";
import { chatWithAI } from "@/lib/ai-service";
import { createServerSupabase } from "@/lib/supabase";
import { ChatRequestSchema } from "@/lib/validations";
import { corsHeadersFromRequest } from "@/lib/cors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createOpaqueToken, hashOpaqueToken, opaqueTokenMatches } from "@/lib/secure-token";
import { z } from "zod";

const chatLeadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
});

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeadersFromRequest(req) });
}

export async function POST(req: NextRequest) {
  const headers = corsHeadersFromRequest(req);
  let requestLocale = "id";

  try {
    const rateLimited = await enforceRateLimit(req, "chat", 20, 60 * 60);
    if (rateLimited) {
      for (const [key, value] of Object.entries(headers)) rateLimited.headers.set(key, value);
      return rateLimited;
    }
    const rawBody = await req.json();
    requestLocale = rawBody?.context?.locale === "en" ? "en" : "id";

    const validationResult = ChatRequestSchema.safeParse(rawBody);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: requestLocale === "en" ? "Message validation failed" : "Validasi pesan gagal",
          details: validationResult.error.format(),
        },
        { status: 400, headers },
      );
    }

    const { message, sessionId, sessionToken, history, context } = validationResult.data;
    const locale = context?.locale || "id";
    const supabase = createServerSupabase();

    let session = null;
    if (sessionId) {
      if (!sessionToken) {
        return NextResponse.json({ success: false, error: "Token sesi chat wajib diisi." }, { status: 403, headers });
      }
      const { data, error } = await supabase
        .from("chat_sessions")
        .select("id, messages, session_secret_hash, expires_at")
        .eq("id", sessionId)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (error || !data || !opaqueTokenMatches(sessionToken, data.session_secret_hash)) {
        return NextResponse.json({ success: false, error: "Sesi chat tidak valid." }, { status: 403, headers });
      }
      session = data;
    }

    const chatHistory = session?.messages || history || [];
    let aiResponseText = await chatWithAI(message, chatHistory, context);

    if (aiResponseText.includes('{"tool":')) {
      try {
        const jsonMatch = aiResponseText.match(/\{"tool":[\s\S]*\}/);
        if (jsonMatch) {
          const toolCall = JSON.parse(jsonMatch[0]);

          const parsedLead = toolCall.tool === "save_chat_lead"
            ? chatLeadSchema.safeParse(toolCall.args)
            : null;
          if (parsedLead?.success) {
            await supabase.from("leads").upsert(
              {
                name: parsedLead.data.name,
                email: parsedLead.data.email,
                source: "chat_nara",
              },
              { onConflict: "email" },
            );

            aiResponseText =
              locale === "en"
                ? `Thank you, ${parsedLead.data.name}. I have saved your email (${parsedLead.data.email}). Is there a specific business operations or people transformation topic you would like to discuss now?`
                : `Terima kasih, ${parsedLead.data.name}. Data email Anda (${parsedLead.data.email}) sudah saya simpan. Ada hal spesifik tentang operasional bisnis atau SDM yang ingin kita diskusikan sekarang?`;
          }
        }
      } catch (error) {
        console.error("[Bina Agent] Tool parsing failed:", error);
        aiResponseText =
          locale === "en"
            ? "Sorry, I am experiencing a small system issue. Could you repeat that?"
            : "Mohon maaf, saya sedang mengalami sedikit gangguan sistem. Bisa diulangi?";
      }
    }

    const newMessages = [
      ...chatHistory.slice(-28),
      { role: "user", content: message, timestamp: new Date().toISOString() },
      { role: "assistant", content: aiResponseText, timestamp: new Date().toISOString() },
    ];

    let finalSessionId = sessionId;
    let finalSessionToken: string | undefined;

    try {
      if (session?.id) {
        await supabase
          .from("chat_sessions")
          .update({ messages: newMessages, updated_at: new Date().toISOString() })
          .eq("id", session.id);
      } else {
        finalSessionToken = createOpaqueToken();
        const { data: newSession, error: insertError } = await supabase
          .from("chat_sessions")
          .insert({ messages: newMessages, session_secret_hash: hashOpaqueToken(finalSessionToken) })
          .select()
          .single();

        if (insertError || !newSession?.id) throw insertError || new Error("Gagal membuat sesi chat.");
        finalSessionId = newSession.id;
      }
    } catch (dbError) {
      console.error("[Chat DB Error]", dbError);
    }

    return NextResponse.json(
      {
        success: true,
        response: aiResponseText,
        sessionId: finalSessionId,
        ...(finalSessionToken ? { sessionToken: finalSessionToken } : {}),
      },
      { headers },
    );
  } catch (error: unknown) {
    console.error("[Chat API Error]", error);
    return NextResponse.json(
      {
        success: false,
        error: requestLocale === "en" ? "An internal server error occurred." : "Terjadi kesalahan internal server.",
      },
      { status: 500, headers },
    );
  }
}
