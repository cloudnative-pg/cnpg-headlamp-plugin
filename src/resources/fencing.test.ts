import { describe, expect, it } from 'vitest';
import { parseFencedInstances, updateFencedInstances } from './fencing';

describe('parseFencedInstances', () => {
  it('returns an empty list when the annotation is absent', () => {
    expect(parseFencedInstances(undefined)).toEqual([]);
  });

  it('parses the JSON list written by kubectl cnpg fencing', () => {
    expect(parseFencedInstances('["demo-1","demo-2"]')).toEqual(['demo-1', 'demo-2']);
    expect(parseFencedInstances('["*"]')).toEqual(['*']);
  });

  // The operator rejects these as ErrorFencedInstancesSyntax, so they must not read as "nothing
  // fenced" (which would let the UI overwrite them).
  it.each(['', 'demo-1', '{"a":1}', '[1,2]', 'null'])('returns undefined for %s', value => {
    expect(parseFencedInstances(value)).toBeUndefined();
  });
});

describe('updateFencedInstances', () => {
  it('adds an instance keeping the list sorted and deduplicated', () => {
    expect(updateFencedInstances(['demo-3'], 'demo-1', true)).toEqual(['demo-1', 'demo-3']);
    expect(updateFencedInstances(['demo-1'], 'demo-1', true)).toEqual(['demo-1']);
  });

  it('removes an instance without touching the others', () => {
    expect(updateFencedInstances(['demo-1', 'demo-2'], 'demo-1', false)).toEqual(['demo-2']);
    expect(updateFencedInstances(['demo-1'], 'demo-1', false)).toEqual([]);
  });

  it('treats fencing an instance as a no-op when all instances are fenced', () => {
    expect(updateFencedInstances(['*'], 'demo-1', true)).toEqual(['*']);
  });

  it('refuses to unfence a single instance when all instances are fenced', () => {
    expect(() => updateFencedInstances(['*'], 'demo-1', false)).toThrow();
  });

  it('handles the fence-all token itself', () => {
    expect(updateFencedInstances(['demo-1'], '*', true)).toEqual(['*']);
    expect(updateFencedInstances(['*'], '*', false)).toEqual([]);
  });
});
