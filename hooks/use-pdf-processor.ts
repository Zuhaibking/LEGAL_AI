"use client"

import { useState, useCallback } from 'react'

export interface DocumentResult {
  text: string
  isAnalyzed: boolean
}

/**
 * Hook that sends any document to the server for processing.
 * All heavy lifting (text extraction, OCR, AI analysis) happens server-side.
 * This hook only provides upload state for the UI.
 */
export function usePdfProcessor() {
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)

  const processDocument = useCallback(async (file: File): Promise<DocumentResult> => {
    setIsProcessing(true)
    setProgress(10)

    try {
      const formData = new FormData()
      formData.append('file', file)

      setProgress(30)

      const response = await fetch('/api/analyze-document', {
        method: 'POST',
        body: formData,
      })

      setProgress(80)

      if (!response.ok) {
        let errorMsg = 'Failed to analyze document'
        try {
          const errorData = await response.json()
          errorMsg = errorData.error || errorMsg
        } catch {
          // response wasn't JSON
        }
        return {
          text: `⚠️ Document analysis encountered an issue: ${errorMsg}\n\nPlease try re-uploading or converting to PNG/JPG.`,
          isAnalyzed: true,
        }
      }

      const data = await response.json()
      setProgress(100)

      return {
        text: data.analysis ?? data.message ?? '',
        isAnalyzed: true,
      }
    } catch (error) {
      console.error('Document processing error:', error)
      return {
        text: `⚠️ Upload failed: ${error instanceof Error ? error.message : 'Network error'}. Please try again.`,
        isAnalyzed: true,
      }
    } finally {
      setIsProcessing(false)
      setProgress(0)
    }
  }, [])

  return { processDocument, isProcessing, progress }
}
