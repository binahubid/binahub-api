import 'server-only';
import { callRoutedAI } from '@/lib/ai-provider';
import {
  buildSpinMatchingRequest, buildSpinRecommendationResult, spinHasRequiredEvidence, validateSpinMatches,
} from './recommendation';

/** Internal foundation only: no route, persistence, dispatch or email side effects. */
export async function prepareSpinRecommendation(input: unknown) {
  const request = buildSpinMatchingRequest(input);
  if (request.needs.summaryStatus !== 'confirmed' || !spinHasRequiredEvidence(request.needs)) {
    return buildSpinRecommendationResult(request.needs, { matches: [] });
  }
  const parse = (content: string) => {
    // JSON mode is a transport convenience. Both shape and source references are rechecked.
    if (content.length > 16_384) throw new Error('SPIN_AI_OUTPUT_INVALID');
    const value: unknown = JSON.parse(content);
    validateSpinMatches(value, request.needs);
    return value;
  };
  try {
    const response = await callRoutedAI({
      purpose: 'reasoning', jsonMode: true, messages: request.messages,
      validateContent: content => { parse(content); },
      budget: { maxTokens: 1200, perAttemptTimeoutMs: 10_000, totalTimeoutMs: 25_000 },
    });
    return buildSpinRecommendationResult(request.needs, parse(response.content));
  } catch {
    // Never replace failure with a generic sale, leak provider errors, or retry an email.
    return buildSpinRecommendationResult(request.needs, { matches: [] }, 'AI_MATCH_UNAVAILABLE');
  }
}
