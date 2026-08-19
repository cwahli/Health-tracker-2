import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppModal } from './AppModal';

describe('AppModal UI Primitive', () => {
  it('does not render markup when isOpen is false', () => {
    const html = renderToStaticMarkup(
      <AppModal isOpen={false} onClose={() => {}}>
        <div>Modal Content</div>
      </AppModal>
    );
    expect(html).toBe('');
  });

  it('renders title, children, and actions when isOpen is true', () => {
    const html = renderToStaticMarkup(
      <AppModal
        isOpen={true}
        onClose={() => {}}
        title="Test Modal Title"
        subtitle="Test Subtitle"
        actions={<button>Submit</button>}
      >
        <div>Modal Content</div>
      </AppModal>
    );

    expect(html).toContain('Test Modal Title');
    expect(html).toContain('Test Subtitle');
    expect(html).toContain('Modal Content');
    expect(html).toContain('Submit');
    expect(html).toContain('role="dialog"');
  });
});
