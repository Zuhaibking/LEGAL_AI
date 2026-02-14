"use client"

import { useState, useRef, useEffect } from "react"
import { 
  Send, 
  Scale, 
  Loader2, 
  Bot, 
  User,
  Mic,
  MicOff,
  Plus,
  X,
  FileText,
  Image as ImageIcon,
  Paperclip,
} from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import ReactMarkdown from "react-markdown"

import { usePdfProcessor } from "@/hooks/use-pdf-processor"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
  documents?: string[]
}

interface UploadedDocument {
  id: string
  name: string
  size: number
  type: string
  content?: string
  extractedText?: string
  isImage?: boolean
  isPdf?: boolean
  preview?: string
  file?: File
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: (event: SpeechRecognitionEvent) => void
  onerror: (event: SpeechRecognitionErrorEvent) => void
  onend: () => void
  start: () => void
  stop: () => void
  abort: () => void
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message: string
}

interface SpeechRecognitionResultList {
  length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
  isFinal: boolean
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDocument[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  
  // Hook for server-side document processing
  const { processDocument, isProcessing: isPdfProcessing, progress: pdfProgress } = usePdfProcessor()


  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [messages])

  // Focus input on mount
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // Close attach menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(event.target as Node)) {
        setShowAttachMenu(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // Track accumulated finalized speech text between start/stop cycles
  const finalTranscriptRef = useRef("")
  const voiceRetryCountRef = useRef(0)
  const MAX_VOICE_RETRIES = 3

  // Initialize speech recognition
  useEffect(() => {
    if (typeof window === "undefined") return

    const SpeechRecognitionAPI = (window as Window & {
      SpeechRecognition?: new () => SpeechRecognition
      webkitSpeechRecognition?: new () => SpeechRecognition
    }).SpeechRecognition || (window as Window & {
      SpeechRecognition?: new () => SpeechRecognition
      webkitSpeechRecognition?: new () => SpeechRecognition
    }).webkitSpeechRecognition

    if (!SpeechRecognitionAPI) return

    const recognition = new SpeechRecognitionAPI()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = "en-IN"

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // Build transcript: finalized segments are committed, interim is preview-only
      let finalizedChunk = ""
      let interimChunk = ""

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalizedChunk += result[0].transcript
        } else {
          interimChunk += result[0].transcript
        }
      }

      if (finalizedChunk) {
        finalTranscriptRef.current += finalizedChunk
      }

      // Show finalized + current interim preview (interim will be replaced on next event)
      setInput(finalTranscriptRef.current + interimChunk)
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn("Speech recognition error:", event.error)

      // Don't retry on permission errors
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone access denied. Please allow microphone permissions.")
        setIsListening(false)
        return
      }

      // Retry on transient errors (network, audio-capture, aborted, no-speech)
      if (voiceRetryCountRef.current < MAX_VOICE_RETRIES) {
        voiceRetryCountRef.current++
        console.log(`Retrying speech recognition (${voiceRetryCountRef.current}/${MAX_VOICE_RETRIES})...`)
        setTimeout(() => {
          try {
            recognition.start()
          } catch {
            setIsListening(false)
          }
        }, 500)
      } else {
        setIsListening(false)
        setError("Voice input failed after multiple attempts. Please try again.")
      }
    }

    recognition.onend = () => {
      // Only mark as stopped if we're not in a retry cycle
      // If we ARE retrying, the onerror handler restarts it
      setIsListening(false)
    }

    recognitionRef.current = recognition
  }, [])

  const startListening = () => {
    if (recognitionRef.current && !isListening) {
      // Reset state for a fresh listening session
      finalTranscriptRef.current = input // preserve any existing typed text
      voiceRetryCountRef.current = 0
      setError(null)
      setIsListening(true)
      try {
        recognitionRef.current.start()
      } catch (e) {
        console.warn("Failed to start speech recognition:", e)
        setIsListening(false)
        setError("Could not start voice input. Please try again.")
      }
    }
  }

  const stopListening = () => {
    if (recognitionRef.current && isListening) {
      voiceRetryCountRef.current = MAX_VOICE_RETRIES // prevent retry on intentional stop
      try {
        recognitionRef.current.stop()
      } catch {
        // Already stopped
      }
      setIsListening(false)
    }
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return

    setIsUploading(true)
    setShowAttachMenu(false)
    const newDocs: UploadedDocument[] = []

    for (const file of Array.from(files)) {
      try {
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
        const isDocx = file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || file.name.toLowerCase().endsWith(".docx")
        const isImageFile = file.type.startsWith("image/")
        
        const doc: UploadedDocument = {
          id: Date.now().toString() + Math.random(),
          name: file.name,
          size: file.size,
          type: file.type,
          isImage: isImageFile,
          isPdf: isPdf,
          file: file,
        }

        if (isImageFile) {
          // Create preview for images
          const reader = new FileReader()
          const preview = await new Promise<string>((resolve) => {
            reader.onload = (e) => resolve(e.target?.result as string)
            reader.readAsDataURL(file)
          })
          doc.preview = preview
          doc.content = preview
        } else if (!isPdf && !isDocx) {
          // Read text content for plain text files only
          const text = await readFileAsText(file)
          doc.content = text
        }
        
        newDocs.push(doc)
      } catch (error) {
        console.error("Error reading file:", error)
        setError("Failed to read file. Please try again.")
      }
    }

    setUploadedDocs(prev => [...prev, ...newDocs])
    setIsUploading(false)
    
    // Clear file inputs
    if (fileInputRef.current) fileInputRef.current.value = ""
    if (imageInputRef.current) imageInputRef.current.value = ""
  }

  const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target?.result as string)
      reader.onerror = reject
      reader.readAsText(file)
    })
  }

  const removeDocument = (id: string) => {
    setUploadedDocs(prev => prev.filter(doc => doc.id !== id))
  }

  /**
   * Send any file to the server for processing + AI analysis.
   * Returns { text, isAnalyzed: true } — the server handles everything.
   */
  const analyzeDocument = async (file: File): Promise<{ text: string; isAnalyzed: boolean }> => {
    return processDocument(file)
  }

  const handleSend = async () => {
    const userQuery = input.trim()
    const hasDocuments = uploadedDocs.length > 0
    
    // Must have either text or documents
    if (!userQuery && !hasDocuments) return
    if (isLoading) return

    // Clear input immediately
    setInput("")
    setIsLoading(true)
    setError(null)
    
    // Store docs before clearing
    const docsToProcess = [...uploadedDocs]
    setUploadedDocs([])

    let messageContent = userQuery
    let rawDocumentText = ""      // Raw extracted text → send to /api/chat for AI analysis
    let preAnalyzedContent = ""   // Already-analyzed by server → show directly as assistant message

    // Process uploaded documents if any
    if (docsToProcess.length > 0) {
      try {
        for (const doc of docsToProcess) {
          if (doc.file && (doc.isPdf || doc.isImage || doc.type.includes("wordprocessingml"))) {
            console.log("Analyzing document:", doc.name)
            const result = await analyzeDocument(doc.file)

            if (result.isAnalyzed) {
              // Server already produced a full AI analysis — collect it
              preAnalyzedContent += `\n\n--- Analysis of: ${doc.name} ---\n${result.text}`
            } else {
              // Raw text — needs AI analysis via /api/chat
              rawDocumentText += `\n\n--- Document: ${doc.name} ---\n${result.text}`
            }
          } else if (doc.content && !doc.isImage && !doc.isPdf) {
            // Plain text files — raw content to be analyzed
            rawDocumentText += `\n\n--- Document: ${doc.name} ---\n${doc.content.substring(0, 5000)}`
          }
        }
      } catch (err) {
        console.error("Document analysis error:", err)
        setError(err instanceof Error ? err.message : "Failed to analyze document")
        setIsLoading(false)
        return
      }
    }

    // If server already analyzed everything and user typed no question,
    // show the analysis directly without another round-trip to /api/chat
    const hasRawDocs = rawDocumentText.length > 0
    const hasPreAnalyzed = preAnalyzedContent.length > 0

    if (hasPreAnalyzed && !hasRawDocs && !userQuery) {
      // Show server's analysis directly as assistant message — no need to re-process
      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content: "Analyze uploaded document(s)",
        timestamp: new Date(),
        documents: docsToProcess.map(doc => doc.name)
      }
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: preAnalyzedContent.trim(),
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, userMessage, assistantMessage])
      setIsLoading(false)
      return
    }

    // Build the message content for /api/chat
    if (hasRawDocs || hasPreAnalyzed) {
      const allDocContent = rawDocumentText + preAnalyzedContent
      messageContent = userQuery 
        ? `${userQuery}\n\nPlease analyze the following document(s) in context of my question:${allDocContent}`
        : `Please analyze the following document(s) and provide a detailed legal analysis with: Simple Summary, Purpose, Key Clauses, Risks/Red Flags, Relevant Indian Laws, and Next Steps:${allDocContent}`
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: userQuery || "Analyze uploaded document(s)",
      timestamp: new Date(),
      documents: docsToProcess.map(doc => doc.name)
    }

    setMessages((prev) => [...prev, userMessage])

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [...messages, { role: "user", content: messageContent }].map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to get response")
      }

      const data = await response.json()

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.message,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (err) {
      setError("Failed to get response. Please try again.")
      console.error("Chat error:", err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px"
    }
  }, [input])

  return (
    <div className="min-h-screen flex flex-col bg-[#212121]">
      {/* Minimal Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#212121]/80 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center justify-between px-4 h-14">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Scale className="h-6 w-6 text-white" />
            <span className="text-lg font-semibold text-white">LexAI</span>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col pt-14">
        {/* Messages Area */}
        <div 
          ref={scrollAreaRef}
          className="flex-1 overflow-y-auto"
        >
          {messages.length === 0 ? (
            /* Welcome Screen */
            <div className="flex flex-col items-center justify-center min-h-[calc(100vh-180px)] px-4">
              <h1 className="text-3xl md:text-4xl font-medium text-white mb-8 text-center">
                What legal question do you have today?
              </h1>
              
              {/* Quick Suggestions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
                {[
                  { icon: "📜", text: "Explain tenant rights in India" },
                  { icon: "⚖️", text: "How to file a consumer complaint?" },
                  { icon: "📋", text: "What is Section 498A of IPC?" },
                  { icon: "📝", text: "Help me draft an RTI application" },
                ].map((suggestion, idx) => (
                  <button
                    key={idx}
                    onClick={() => setInput(suggestion.text)}
                    className="flex items-center gap-3 px-4 py-3 bg-[#2f2f2f] hover:bg-[#3a3a3a] rounded-xl text-left transition-colors border border-white/5"
                  >
                    <span className="text-xl">{suggestion.icon}</span>
                    <span className="text-sm text-gray-300">{suggestion.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Messages List */
            <div className="max-w-3xl mx-auto w-full px-4 py-6 space-y-6">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex gap-4",
                    message.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  {message.role === "assistant" && (
                    <div className="w-8 h-8 rounded-full bg-[#19c37d] flex items-center justify-center shrink-0">
                      <Bot className="h-5 w-5 text-white" />
                    </div>
                  )}
                  
                  <div
                    className={cn(
                      "max-w-[85%] md:max-w-[80%] rounded-2xl px-4 py-3",
                      message.role === "user"
                        ? "bg-[#2f2f2f] text-white"
                        : "bg-transparent"
                    )}
                  >
                    {message.role === "assistant" ? (
                      <div className="prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown
                          components={{
                            h1: ({ children }) => (
                              <h1 className="text-xl font-bold text-white mb-3">{children}</h1>
                            ),
                            h2: ({ children }) => (
                              <h2 className="text-lg font-bold text-white mb-2 mt-4">{children}</h2>
                            ),
                            h3: ({ children }) => (
                              <h3 className="text-base font-semibold text-white mb-2 mt-3">{children}</h3>
                            ),
                            p: ({ children }) => (
                              <p className="text-gray-200 mb-3 leading-relaxed">{children}</p>
                            ),
                            ul: ({ children }) => (
                              <ul className="list-disc list-outside ml-4 mb-3 space-y-1 text-gray-200">{children}</ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="list-decimal list-outside ml-4 mb-3 space-y-1 text-gray-200">{children}</ol>
                            ),
                            li: ({ children }) => (
                              <li className="text-gray-200">{children}</li>
                            ),
                            strong: ({ children }) => (
                              <strong className="font-semibold text-white">{children}</strong>
                            ),
                            a: ({ href, children }) => (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#19c37d] hover:underline"
                              >
                                {children}
                              </a>
                            ),
                            hr: () => <hr className="my-4 border-white/10" />,
                            code: ({ children }) => (
                              <code className="bg-[#2f2f2f] px-1.5 py-0.5 rounded text-sm text-gray-200">
                                {children}
                              </code>
                            ),
                            pre: ({ children }) => (
                              <pre className="bg-[#2f2f2f] p-4 rounded-lg overflow-x-auto mb-3">
                                {children}
                              </pre>
                            ),
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div>
                        <p className="text-gray-100 whitespace-pre-wrap">{message.content.split("\n\n[Document:")[0]}</p>
                        {message.documents && message.documents.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {message.documents.map((doc, idx) => (
                              <span key={idx} className="inline-flex items-center gap-1 text-xs text-gray-400 bg-white/5 px-2 py-1 rounded">
                                <FileText className="h-3 w-3" />
                                {doc}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {message.role === "user" && (
                    <div className="w-8 h-8 rounded-full bg-[#5436DA] flex items-center justify-center shrink-0">
                      <User className="h-5 w-5 text-white" />
                    </div>
                  )}
                </div>
              ))}
              
              {/* Loading indicator */}
              {(isLoading || isPdfProcessing) && (
                <div className="flex gap-4 justify-start">
                  <div className="w-8 h-8 rounded-full bg-[#19c37d] flex items-center justify-center shrink-0">
                    <Bot className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex items-center gap-2 text-gray-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{
                        isPdfProcessing 
                        ? `Processing PDF pages... ${pdfProgress}%` 
                        : "Thinking..."
                    }</span>
                  </div>
                </div>
              )}
              
              {/* Error message */}
              {error && (
                <div className="flex justify-center">
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input Area - Fixed at Bottom */}
        <div className="sticky bottom-0 bg-gradient-to-t from-[#212121] via-[#212121] to-transparent pt-6 pb-4 px-4">
          <div className="max-w-3xl mx-auto w-full">
            {/* Uploaded files preview */}
            {uploadedDocs.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {uploadedDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-2 bg-[#2f2f2f] rounded-lg px-3 py-2 text-sm"
                  >
                    {doc.isImage ? (
                      <ImageIcon className="h-4 w-4 text-gray-400" />
                    ) : (
                      <FileText className="h-4 w-4 text-gray-400" />
                    )}
                    <span className="text-gray-300 max-w-[150px] truncate">{doc.name}</span>
                    <button
                      onClick={() => removeDocument(doc.id)}
                      className="text-gray-500 hover:text-white transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Input container */}
            <div className="relative bg-[#2f2f2f] rounded-3xl border border-white/10 focus-within:border-white/20 transition-colors">
              <div className="flex items-end gap-2 p-2">
                {/* Attachment button with menu */}
                <div className="relative" ref={attachMenuRef}>
                  <button
                    onClick={() => setShowAttachMenu(!showAttachMenu)}
                    className={cn(
                      "p-2 rounded-full hover:bg-white/10 transition-colors",
                      showAttachMenu && "bg-white/10"
                    )}
                    disabled={isLoading || isUploading}
                  >
                    {isUploading ? (
                      <Loader2 className="h-5 w-5 text-gray-400 animate-spin" />
                    ) : (
                      <Plus className="h-5 w-5 text-gray-400" />
                    )}
                  </button>
                  
                  {/* Attachment menu dropdown */}
                  {showAttachMenu && (
                    <div className="absolute bottom-full left-0 mb-2 bg-[#3a3a3a] rounded-xl border border-white/10 shadow-xl overflow-hidden min-w-[200px]">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
                      >
                        <Paperclip className="h-5 w-5 text-gray-400" />
                        <div>
                          <p className="text-sm text-white">Upload document</p>
                          <p className="text-xs text-gray-500">PDF, DOC, TXT</p>
                        </div>
                      </button>
                      <button
                        onClick={() => imageInputRef.current?.click()}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left border-t border-white/5"
                      >
                        <ImageIcon className="h-5 w-5 text-gray-400" />
                        <div>
                          <p className="text-sm text-white">Upload image</p>
                          <p className="text-xs text-gray-500">PNG, JPG, WEBP</p>
                        </div>
                      </button>
                    </div>
                  )}
                </div>

                {/* Hidden file inputs */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <input
                  ref={imageInputRef}
                  type="file"
                  multiple
                  accept="image/*,.png,.jpg,.jpeg,.webp"
                  onChange={handleFileUpload}
                  className="hidden"
                />

                {/* Text input */}
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask anything about Indian law..."
                  className="flex-1 bg-transparent text-white placeholder-gray-500 resize-none focus:outline-none py-2 px-2 max-h-[200px] min-h-[24px]"
                  rows={1}
                  disabled={isLoading}
                />

                {/* Voice input button */}
                <button
                  onClick={isListening ? stopListening : startListening}
                  disabled={isLoading || !recognitionRef.current}
                  className={cn(
                    "p-2 rounded-full transition-colors",
                    isListening
                      ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                      : "hover:bg-white/10 text-gray-400"
                  )}
                >
                  {isListening ? (
                    <MicOff className="h-5 w-5" />
                  ) : (
                    <Mic className="h-5 w-5" />
                  )}
                </button>

                {/* Send button */}
                <button
                  onClick={handleSend}
                  disabled={(!input.trim() && uploadedDocs.length === 0) || isLoading}
                  className={cn(
                    "p-2 rounded-full transition-all",
                    (input.trim() || uploadedDocs.length > 0) && !isLoading
                      ? "bg-white text-black hover:bg-gray-200"
                      : "bg-gray-600 text-gray-400 cursor-not-allowed"
                  )}
                >
                  {isLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Send className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Helper text */}
            <p className="text-xs text-gray-500 text-center mt-3">
              LexAI can make mistakes. Consider checking important legal information.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
