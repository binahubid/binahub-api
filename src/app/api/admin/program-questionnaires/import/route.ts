import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import { requireAdmin } from "@/lib/admin-auth";
import { questionnaireQuestionImportSchema } from "@/lib/configurable-business-schemas";

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = new Set(["docx", "txt", "csv", "json"]);

type ImportedQuestion = {
  position: number;
  questionType: "single_choice" | "multiple_choice" | "yes_no" | "scale" | "short_text" | "long_text" | "number";
  prompt: string;
  helpText: string;
  required: boolean;
  options: string[];
  correctAnswer: string | number | boolean | string[] | null;
  points: number;
  scaleMin: number | null;
  scaleMax: number | null;
  scaleLabels: Record<string, string>;
};

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

function baseQuestion(position: number, prompt: string): ImportedQuestion {
  return {
    position,
    questionType: "long_text",
    prompt,
    helpText: "",
    required: true,
    options: [],
    correctAnswer: null,
    points: 1,
    scaleMin: null,
    scaleMax: null,
    scaleLabels: {},
  };
}

function parseTextQuestions(text: string) {
  const lines = text.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  const groups: Array<{ prompt: string; options: string[]; correctAnswer: string | null }> = [];
  let current: { prompt: string; options: string[]; correctAnswer: string | null } | null = null;

  for (const line of lines) {
    const questionMatch = line.match(/^(?:\d+[.)]|q\d+[.):]?)\s+(.+)$/i);
    const optionMatch = line.match(/^(?:[a-z][.)]|[-*])\s+(.+)$/i);
    const answerMatch = line.match(/^(?:kunci|answer|correct)\s*:\s*(.+)$/i);
    if (questionMatch) {
      if (current) groups.push(current);
      current = { prompt: questionMatch[1].trim(), options: [], correctAnswer: null };
      continue;
    }
    if (!current) {
      current = { prompt: line, options: [], correctAnswer: null };
      continue;
    }
    if (answerMatch) {
      const rawAnswer = answerMatch[1].trim();
      const letter = rawAnswer.match(/^[a-z]$/i);
      current.correctAnswer = letter
        ? current.options[letter[0].toUpperCase().charCodeAt(0) - 65] || rawAnswer
        : rawAnswer;
    } else if (optionMatch) {
      current.options.push(optionMatch[1].trim());
    } else {
      current.prompt = `${current.prompt} ${line}`.trim();
    }
  }
  if (current) groups.push(current);

  return groups.map((group, index) => ({
    ...baseQuestion(index + 1, group.prompt),
    questionType: group.options.length >= 2 ? "single_choice" as const : "long_text" as const,
    options: group.options,
    correctAnswer: group.correctAnswer,
  }));
}

function parseCsv(text: string) {
  const lines = text.replace(/\r/g, "").split("\n").filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV harus memiliki header dan minimal satu pertanyaan.");
  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase().replace(/\s+/g, "_"));
  const requiredHeader = headers.indexOf("question");
  if (requiredHeader < 0) throw new Error("CSV membutuhkan kolom question.");
  return lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const field = (name: string) => values[headers.indexOf(name)] || "";
    const options = field("options").split("|").map((item) => item.trim()).filter(Boolean);
    const requestedType = field("type");
    const questionType = requestedType || (options.length >= 2 ? "single_choice" : "long_text");
    return {
      ...baseQuestion(index + 1, field("question")),
      questionType,
      helpText: field("help_text"),
      required: !["false", "tidak", "0"].includes(field("required").toLowerCase()),
      options,
      correctAnswer: field("correct_answer") || null,
      points: Number(field("points") || 1),
      scaleMin: field("scale_min") ? Number(field("scale_min")) : null,
      scaleMax: field("scale_max") ? Number(field("scale_max")) : null,
    };
  });
}

function parseJson(text: string) {
  const payload = JSON.parse(text) as unknown;
  if (!Array.isArray(payload)) throw new Error("JSON harus berupa array pertanyaan.");
  return payload.map((item, index) => ({
    ...baseQuestion(index + 1, ""),
    ...(item as Record<string, unknown>),
    position: index + 1,
  }));
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error || "Akses admin tidak valid." }, { status: admin.status });
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "Pilih satu dokumen untuk diimpor." }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ success: false, error: "Ukuran dokumen harus antara 1 byte dan 3 MB." }, { status: 400 });
  }

  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!ACCEPTED_EXTENSIONS.has(extension)) {
    return NextResponse.json({ success: false, error: "Format yang didukung: DOCX, TXT, CSV, atau JSON." }, { status: 415 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    let questions: unknown[];
    if (extension === "docx") {
      // Hanya mengambil plain text; HTML dari dokumen tidak pernah dirender atau disimpan.
      const result = await mammoth.extractRawText({ buffer });
      questions = parseTextQuestions(result.value);
    } else {
      const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
      questions = extension === "csv" ? parseCsv(text) : extension === "json" ? parseJson(text) : parseTextQuestions(text);
    }

    const parsedQuestions: ImportedQuestion[] = [];
    const errors: Array<{ position: number; message: string }> = [];
    questions.slice(0, 200).forEach((question, index) => {
      const parsed = questionnaireQuestionImportSchema.safeParse({
        ...(question as Record<string, unknown>),
        position: index + 1,
      });
      if (parsed.success) parsedQuestions.push(parsed.data as ImportedQuestion);
      else errors.push({ position: index + 1, message: parsed.error.issues[0]?.message || "Pertanyaan tidak valid." });
    });

    if (parsedQuestions.length === 0) {
      return NextResponse.json({
        success: false,
        error: "Tidak ada pertanyaan valid yang dapat dibaca. Gunakan penomoran 1., 2., dst. dan pilihan A., B., dst.",
        validationErrors: errors,
      }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      filename: file.name,
      sourceType: extension,
      questions: parsedQuestions,
      rejected: errors,
      warning: "Periksa kembali redaksi, pilihan, dan kunci jawaban sebelum menyimpan.",
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Dokumen gagal dibaca.",
    }, { status: 422 });
  }
}
