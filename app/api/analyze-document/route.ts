import { NextRequest, NextResponse } from "next/server"
import mammoth from "mammoth"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

// ---------------------------------------------------------------------------
// PDF text extraction — server-side only, no canvas needed
// ---------------------------------------------------------------------------

async function extractPdfText(buffer: Buffer): Promise<string> {
  // Try pdf-parse first (battle-tested CJS library)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParseModule = require("pdf-parse")
    const pdfParse = pdfParseModule.default || pdfParseModule
    const data = await pdfParse(buffer)
    return data.text || ""
  } catch (err) {
    console.warn("pdf-parse failed, trying unpdf:", err)
  }

  // Fallback: unpdf
  try {
    const { extractText } = await import("unpdf")
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: true })
    return text ?? ""
  } catch (err) {
    console.error("unpdf extractText also failed:", err)
    return ""
  }
}

// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      )
    }

    if (!OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key is missing" },
        { status: 500 }
      )
    }

    // Determine how to handle the file
    let documentText = ""
    let useVisionAPI = false
    let usePdfFileInput = false
    let fileBase64 = ""
    let mimeType = ""

    if (
      file.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.name.endsWith(".docx")
    ) {
      const arrayBuffer = await file.arrayBuffer()
      const result = await mammoth.extractRawText({ arrayBuffer })
      documentText = result.value
    } else if (file.type === "text/plain" || file.name.endsWith(".txt")) {
      documentText = await file.text()
    } else if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
      // Extract text from PDF server-side
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      try {
        documentText = await extractPdfText(buffer)
      } catch (error) {
        console.error("PDF text extraction error:", error)
      }

      // If no meaningful text → scanned PDF → send raw PDF to GPT-4o
      // GPT-4o supports native PDF file input via the "file" content type
      if (!documentText || documentText.trim().length < 10) {
        console.log("PDF has little/no extractable text — sending raw PDF to GPT-4o")
        fileBase64 = buffer.toString("base64")
        usePdfFileInput = true
        documentText = ""
      }
    } else if (file.type.startsWith("image/")) {
      const arrayBuffer = await file.arrayBuffer()
      fileBase64 = Buffer.from(arrayBuffer).toString("base64")
      mimeType = file.type
      useVisionAPI = true
    } else {
      try {
        documentText = await file.text()
      } catch {
        return NextResponse.json(
          { error: "Unsupported file type. Please upload .txt, .docx, .pdf, or image files." },
          { status: 400 }
        )
      }
    }

    if (!useVisionAPI && !usePdfFileInput && (!documentText || documentText.trim().length === 0)) {
      return NextResponse.json(
        { error: "Could not extract text from the document. The file may be empty or corrupted." },
        { status: 400 }
      )
    }

    // System message for document analysis
    const systemMessage = `You are LexAI, an advanced legal document analysis system with OCR capabilities. When analyzing a legal document (whether text or scanned image), you MUST provide your analysis in the following EXACT structure:

---

## 📋 Simple Summary

[Provide a clear, plain English explanation of what the document means. Use simple language that anyone can understand. 2-3 paragraphs maximum.]

---

## 🎯 Purpose

[Explain why this document exists - what is its main function or objective? 1-2 paragraphs.]

---

## 🔑 Key Clauses

[Break down important terms, rights, responsibilities, dates, fees, conditions, and other critical information. Use bullet points for clarity. Include:
- Important dates and deadlines
- Financial obligations (fees, penalties, payments)
- Rights and responsibilities of each party
- Conditions and requirements
- Termination clauses
- Dispute resolution mechanisms
- Any other significant terms]

---

## ⚠️ Risks / Red Flags

[Identify and explain:
- Unfair or one-sided terms
- Missing clauses that should be present
- Penalties or consequences
- Hidden obligations
- Anything that could be unsafe or problematic
- Use clear warnings and explain why each item is a concern]

---

## ⚖️ Relevant Indian Laws

[If applicable, cite relevant Indian laws that govern this document or situation:
- Contract Act, 1872 (for contracts)
- Consumer Protection Act, 2019 (for consumer agreements)
- Information Technology Act, 2000 (for digital/online agreements)
- Indian Penal Code (for criminal aspects)
- Any other relevant acts, sections, or regulations
- Include section numbers and brief explanations
- Provide official source links when possible]

---

## 📝 Next Steps

[Provide actionable guidance on what the user should do or check:
- What to verify before signing
- What to negotiate or clarify
- Documents to gather
- Questions to ask
- Important deadlines to remember
- REMEMBER: This is informational guidance only, NOT professional legal advice]

---

CRITICAL RULES:

1. **OCR Capability**: If the document is an image or scanned PDF, carefully read and extract all text visible in the image before analyzing.

2. **Language**: Use extremely simple, clear, and beginner-friendly language. Avoid legal jargon. If you must use legal terms, explain them immediately.

3. **Structure**: ALWAYS follow the exact structure above with the emoji headers. Do not skip any section.

4. **Completeness**: If the document text appears incomplete or image quality is poor, clearly state at the beginning: "⚠️ WARNING: The document appears incomplete or image quality is poor. Please upload a clearer version for complete analysis."

5. **No Legal Advice**: Always remind users that this is informational guidance only, not professional legal advice. Recommend consulting a qualified lawyer for complex matters.

6. **Markdown Formatting**: 
   - Use **bold** for emphasis
   - Use bullet points for lists
   - Use clear section dividers (---)
   - Keep paragraphs short and readable

7. **Indian Law Focus**: When citing laws, prioritize Indian laws (Contract Act, Consumer Act, IT Act, IPC, etc.) and provide relevant section numbers.

8. **Honesty**: If you cannot determine something from the document, say so clearly. Don't guess or speculate.

9. **Work Only with Provided Content**: Analyze only the document content provided. Do not make assumptions beyond what is in the document.

Remember: Your goal is to make legal documents understandable for everyone, not to replace professional legal counsel.`

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type ContentPart = any
    type MessageContent = string | ContentPart[]
    let messages: Array<{ role: string; content: MessageContent }>

    const userPrompt = "Please analyze this legal document. First, carefully extract and read all text from the document (including any scanned or image-based content using OCR). Then provide the structured analysis as specified."

    if (usePdfFileInput) {
      // Scanned / image-based PDF → send raw PDF to GPT-4o using native file input
      messages = [
        { role: "system", content: systemMessage },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            {
              type: "file",
              file: {
                filename: file.name || "document.pdf",
                file_data: `data:application/pdf;base64,${fileBase64}`,
              },
            },
          ],
        },
      ]
    } else if (useVisionAPI) {
      // Image files → GPT-4o vision
      messages = [
        { role: "system", content: systemMessage },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${fileBase64}`,
              },
            },
          ],
        },
      ]
    } else {
      // Text-based document analysis
      messages = [
        { role: "system", content: systemMessage },
        {
          role: "user",
          content: `Analyze the following document text and explain it in clear, simple English:\n\n---\n${documentText}\n---\n\nProvide the structured analysis as specified.`,
        },
      ]
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: messages,
        temperature: 0.4,
        max_tokens: 16384,
      }),
    })

    if (!response.ok) {
      const errorData = await response.text()
      console.error("OpenAI API error:", errorData)
      return NextResponse.json(
        { error: "Failed to analyze document" },
        { status: response.status }
      )
    }

    const data = await response.json()

    if (!data.choices?.[0]?.message) {
      console.error("Invalid OpenAI response:", data)
      return NextResponse.json(
        { error: "Invalid response format from AI" },
        { status: 500 }
      )
    }

    const analysis = data.choices[0].message.content

    return NextResponse.json({
      analysis: analysis,
      fileName: file.name,
      usage: data.usage,
      ocrUsed: useVisionAPI,
    })
  } catch (error) {
    console.error("Error in document analysis API:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

