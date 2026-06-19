import { NextRequest, NextResponse } from "next/server";
import { chatWithAI } from "@/lib/ai-service";
import { createServerSupabase } from "@/lib/supabase";
import { ChatRequestSchema } from "@/lib/validations";
import { corsHeadersFromRequest } from "@/lib/cors";

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeadersFromRequest(req) });
}

export async function POST(req: NextRequest) {
  const headers = corsHeadersFromRequest(req);
  let requestLocale = "id";

  try {
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

    const { message, sessionId, history, context } = validationResult.data;
    const locale = context?.locale || "id";
    const supabase = createServerSupabase();

    let session = null;
    if (sessionId) {
      const { data, error } = await supabase
        .from("chat_sessions")
        .select("*")
        .eq("id", sessionId)
        .maybeSingle();

      if (!error && data) {
        session = data;
      }
    }

    const chatHistory = history || session?.messages || [];
    let aiResponseText = await chatWithAI(message, chatHistory, context);

    if (aiResponseText.includes('{"tool":')) {
      try {
        const jsonMatch = aiResponseText.match(/\{"tool":[\s\S]*\}/);
        if (jsonMatch) {
          const toolCall = JSON.parse(jsonMatch[0]);

          if (toolCall.tool === "save_chat_lead" && toolCall.args) {
            await supabase.from("leads").upsert(
              {
                name: toolCall.args.name || "Chat User",
                email: toolCall.args.email,
                source: "chat_nara",
              },
              { onConflict: "email" },
            );

            aiResponseText =
              locale === "en"
                ? `Thank you, ${toolCall.args.name}. I have saved your email (${toolCall.args.email}). Is there a specific business operations or people transformation topic you would like to discuss now?`
                : `Terima kasih, ${toolCall.args.name}. Data email Anda (${toolCall.args.email}) sudah saya simpan. Ada hal spesifik tentang operasional bisnis atau SDM yang ingin kita diskusikan sekarang?`;
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
      ...chatHistory,
      { role: "user", content: message, timestamp: new Date().toISOString() },
      { role: "assistant", content: aiResponseText, timestamp: new Date().toISOString() },
    ];

    let finalSessionId = sessionId;

    try {
      if (session?.id) {
        await supabase
          .from("chat_sessions")
          .update({ messages: newMessages, updated_at: new Date().toISOString() })
          .eq("id", session.id);
      } else {
        const { data: newSession, error: insertError } = await supabase
          .from("chat_sessions")
          .insert({ messages: newMessages })
          .select()
          .single();

        if (!insertError) {
          finalSessionId = newSession?.id;
        }
      }
    } catch (dbError) {
      console.error("[Chat DB Error]", dbError);
    }

    return NextResponse.json(
      {
        success: true,
        response: aiResponseText,
        sessionId: finalSessionId,
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
