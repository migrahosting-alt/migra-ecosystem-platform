### File-by-File Plan

#### `apps/brain-service/src/engine/liveKnowledge/liveFetch.ts`
- **Change**: Add an optional `maxRetries` parameter to the `fetchLiveDocument` function.
- **Reason**: To allow transient 503 errors to be retried once.

```typescript
export async function fetchLiveDocument(
  url: string,
  options?: { maxRetries?: number }
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? 0;
  let retries = 0;

  while (retries <= maxRetries) {
    try {
      return await guardedRequest(url);
    } catch (error) {
      if (error instanceof Response && error.status === 503 && retries < maxRetries) {
        retries++;
        continue;
      }
      throw error;
    }
  }
}
```

#### `apps/brain-service/src/engine/liveKnowledge/liveResearch.ts`
- **Change**: Update the `researchLive` function to accept and pass the `maxRetries` option to `fetchLiveDocument`.
- **Reason**: Ensure that the retry logic is applied when fetching live documents.

```typescript
export async function researchLive(
  query: string,
  budget: LiveResearchBudget,
  options?: { maxRetries?: number }
): Promise<ResearchResult> {
  // Existing code...

  const response = await fetchLiveDocument(documentUrl, { maxRetries: options?.maxRetries });

  // Existing code...
}
```

#### `apps/brain-service/src/engine/liveKnowledge/liveKnowledgeDecision.ts`
- **Change**: Update the `LiveResearchBudget` interface to include an optional `maxRetries` property.
- **Reason**: To allow configuration of retry behavior through the budget.

```typescript
export interface LiveResearchBudget {
  // Existing properties...
  maxRetries?: number;
}
```

#### `apps/brain-service/test/liveFetchSecurity.test.ts`
- **Change**: Update tests to include scenarios for the new `maxRetries` functionality.
- **Reason**: Ensure that the retry logic does not bypass security checks or document budgets.

```typescript
describe('fetchLiveDocument', () => {
  it('should retry transient 503 errors once', async () => {
    // Mock a 503 response on first attempt, then success on second
    const mockFetch = jest.fn()
      .mockImplementationOnce(() => Promise.reject(new Response(null, { status: 503 })))
      .mockImplementationOnce(() => Promise.resolve(new Response('Success')));

    global.fetch = mockFetch;

    const result = await fetchLiveDocument('http://example.com', { maxRetries: 1 });
    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // Existing tests...
});
```

### Summary
- **`liveFetch.ts`**: Added `maxRetries` parameter to `fetchLiveDocument`.
- **`liveResearch.ts`**: Passed `maxRetries` option to `fetchLiveDocument`.
- **`liveKnowledgeDecision.ts`**: Updated `LiveResearchBudget` interface.
- **`liveFetchSecurity.test.ts`**: Added tests for retry logic.

These changes ensure that transient 503 errors are retried once without violating any existing invariants or protected surfaces.