package metadata

import (
	"sync"
	"time"
)

// ponytail: per-key TTL only; if memory grows, swap for hashicorp/golang-lru/v2.
type cache struct {
	mu   sync.Mutex
	ttl  time.Duration
	data map[string]cacheEntry
}

type cacheEntry struct {
	value   any
	expires time.Time
}

func newCache(ttl time.Duration) *cache {
	return &cache{ttl: ttl, data: make(map[string]cacheEntry)}
}

func (c *cache) get(key string) (any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.data[key]
	if !ok {
		return nil, false
	}
	if time.Now().After(e.expires) {
		delete(c.data, key)
		return nil, false
	}
	return e.value, true
}

func (c *cache) set(key string, v any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.data[key] = cacheEntry{value: v, expires: time.Now().Add(c.ttl)}
}
