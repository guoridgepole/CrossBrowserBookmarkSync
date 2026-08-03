/**
 * Chunked processing utility for handling large bookmark sets
 * without exceeding Service Worker timeout limits.
 */

/**
 * Process an array in chunks, yielding to the event loop between chunks
 * to reset the SW idle timer.
 */
export async function processInChunks<T>(
  items: T[],
  batchSize: number,
  processor: (item: T, index: number) => Promise<void>,
  onBatchComplete?: (completedCount: number) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    await processor(items[i]!, i);

    // After each batch, yield to event loop and report progress
    if ((i + 1) % batchSize === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (onBatchComplete) {
        await onBatchComplete(i + 1);
      }
    }
  }
}

/**
 * Split an array into chunks of a given size.
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
