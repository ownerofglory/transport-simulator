// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { isTypingTarget } from './typingTarget';

describe('isTypingTarget', () => {
  it('treats form fields as typing targets', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isTypingTarget(document.createElement(tag))).toBe(true);
    }
  });

  it('treats contenteditable elements as typing targets', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'isContentEditable', { value: true });
    expect(isTypingTarget(el)).toBe(true);
  });

  it('leaves ordinary elements and non-elements alone', () => {
    expect(isTypingTarget(document.createElement('canvas'))).toBe(false);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
  });
});
