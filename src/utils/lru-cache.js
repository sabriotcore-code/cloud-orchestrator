/**
 * LRU CACHE - Bounded memory with automatic eviction
 *
 * A simple Least Recently Used cache implementation with:
 * - Maximum size limit with automatic eviction of oldest entries
 * - TTL (time-to-live) expiration for entries
 * - O(1) get/set operations using Map
 */

export class LRUCache {
  /**
   * Create a new LRU cache
   * @param {number} maxSize - Maximum number of items (default: 1000)
   * @param {number} ttlMs - Time-to-live in milliseconds (default: 1 hour)
   */
  constructor(maxSize = 1000, ttlMs = 3600000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }

  /**
   * Get a value from the cache
   * @param {string} key - Cache key
   * @returns {*} The cached value or undefined if not found/expired
   */
  get(key) {
    const item = this.cache.get(key);
    if (!item) return undefined;

    // Check TTL expiration
    if (Date.now() - item.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }

  /**
   * Set a value in the cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   */
  set(key, value) {
    // Delete if exists (to update position)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest entries if at capacity
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, { value, timestamp: Date.now() });
  }

  /**
   * Check if key exists and is not expired
   */
  has(key) {
    return this.get(key) !== undefined;
  }

  /**
   * Delete a key from the cache
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get current cache size
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Get all entries as [key, value] pairs
   * Useful for iteration and search
   */
  entries() {
    return Array.from(this.cache.entries()).map(([k, v]) => [k, v.value]);
  }

  /**
   * Get iterator over all keys
   */
  keys() {
    return this.cache.keys();
  }

  /**
   * Get cache statistics
   */
  stats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs
    };
  }
}

export default LRUCache;
