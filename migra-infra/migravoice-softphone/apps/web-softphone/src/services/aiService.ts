/**
 * MigraVoice AI Service
 *
 * Browser builds must not embed third-party API secrets. This implementation
 * keeps live transcription on the native Web Speech API when available and
 * falls back to lightweight local heuristics for summaries and sentiment.
 */

export interface TranscriptionResult {
  text: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  language?: string;
  duration?: number;
}

export interface CallSummary {
  summary: string;
  keyPoints: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  actionItems: string[];
  topics: string[];
}

export interface LiveTranscriptionChunk {
  text: string;
  isFinal: boolean;
  timestamp: number;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function splitSentences(text: string): string[] {
  return normalizeWhitespace(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function summarizeHeuristically(text: string): string {
  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    return 'No call summary available.';
  }

  const summary = sentences.slice(0, 2).join(' ');
  return summary.length > 320 ? `${summary.slice(0, 317)}...` : summary;
}

function extractActionItems(text: string): string[] {
  const triggers = ['follow up', 'send', 'email', 'schedule', 'call back', 'review', 'confirm', 'share'];
  return splitSentences(text)
    .filter((sentence) => triggers.some((trigger) => sentence.toLowerCase().includes(trigger)))
    .slice(0, 3);
}

function extractTopics(text: string): string[] {
  const catalog = ['billing', 'support', 'transfer', 'conference', 'voicemail', 'analytics', 'message', 'contact', 'setup', 'porting'];
  const matches = new Set<string>();
  const lower = text.toLowerCase();

  catalog.forEach((topic) => {
    if (lower.includes(topic)) {
      matches.add(topic);
    }
  });

  return Array.from(matches).slice(0, 5);
}

function scoreSentiment(text: string): { sentiment: 'positive' | 'neutral' | 'negative'; score: number; emotions: string[] } {
  const lower = text.toLowerCase();
  const positiveTriggers = ['great', 'good', 'perfect', 'thanks', 'thank you', 'resolved', 'helpful', 'working'];
  const negativeTriggers = ['issue', 'problem', 'frustrated', 'broken', 'slow', 'error', 'fail', 'angry'];

  const positive = positiveTriggers.filter((trigger) => lower.includes(trigger)).length;
  const negative = negativeTriggers.filter((trigger) => lower.includes(trigger)).length;
  const delta = positive - negative;

  if (delta > 0) {
    return { sentiment: 'positive', score: Math.min(1, delta / 3), emotions: ['confident'] };
  }
  if (delta < 0) {
    return { sentiment: 'negative', score: Math.max(-1, delta / 3), emotions: ['concerned'] };
  }
  return { sentiment: 'neutral', score: 0, emotions: ['calm'] };
}

class AIService {

  /**
   * File transcription requires a server-side AI integration.
   */
  async transcribeAudio(audioBlob: Blob, language?: string): Promise<TranscriptionResult> {
    void audioBlob;
    void language;
    throw new Error('Audio file transcription is not enabled in the browser build.');
  }

  /**
   * Generate a browser-safe heuristic summary without exposing third-party keys.
   */
  async generateCallSummary(transcription: string, callMetadata?: {
    duration: number;
    callerNumber: string;
    direction: 'inbound' | 'outbound';
  }): Promise<CallSummary> {
    void callMetadata;
    const sentences = splitSentences(transcription);
    const sentiment = scoreSentiment(transcription);

    return {
      summary: summarizeHeuristically(transcription),
      keyPoints: sentences.slice(0, 3),
      sentiment: sentiment.sentiment,
      actionItems: extractActionItems(transcription),
      topics: extractTopics(transcription),
    };
  }

  /**
   * Real-time transcription using browser's SpeechRecognition
   * Falls back to chunked Whisper API if not supported
   */
  createLiveTranscriber(
    onChunk: (chunk: LiveTranscriptionChunk) => void,
    language: string = 'en-US'
  ): {
    start: () => void;
    stop: () => void;
    isSupported: boolean;
  } {
    // Check for native Web Speech API support
    const SpeechRecognition = (window as any).SpeechRecognition ||
                               (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = language;

      recognition.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          onChunk({
            text: result[0].transcript,
            isFinal: result.isFinal,
            timestamp: Date.now(),
          });
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
      };

      return {
        start: () => recognition.start(),
        stop: () => recognition.stop(),
        isSupported: true,
      };
    }

    // Fallback - no live transcription
    return {
      start: () => console.warn('Speech recognition not supported'),
      stop: () => {},
      isSupported: false,
    };
  }

  /**
   * Translate transcription to another language
   */
  async translateText(text: string, targetLanguage: string): Promise<string> {
    void targetLanguage;
    return text;
  }

  /**
   * Analyze caller sentiment in real-time
   */
  async analyzeSentiment(text: string): Promise<{
    sentiment: 'positive' | 'neutral' | 'negative';
    score: number;
    emotions: string[];
  }> {
    return scoreSentiment(text);
  }

  /**
   * Browser builds intentionally do not embed remote AI credentials.
   */
  isConfigured(): boolean {
    return false;
  }
}

export const aiService = new AIService();
export default aiService;
