import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ImageSlider from './ImageSlider';

/**
 * Sensor for the orphaned hero-slider box (literal `imgNoImages` on an empty
 * image area while item tiles still showed fallbacks).
 *
 * Class AGREE_DEDUPED: raw image lists can be non-empty yet dedupe to zero
 * (revoked blob:, empty strings, placeholder tokens). The slider must render
 * nothing then — never a placeholder box — so hero and tiles agree.
 */
describe('ImageSlider empty state', () => {
  it('renders nothing when every entry dedupes to zero', () => {
    const html = renderToStaticMarkup(
      <ImageSlider images={['', '   ', '[image_removed_for_snapshot]']} altText="Meal" language="en" />
    );
    expect(html).toBe('');
    expect(html).not.toContain('imgNoImages');
  });

  it('renders nothing for empty/undefined lists', () => {
    expect(renderToStaticMarkup(<ImageSlider images={[]} altText="Meal" language="en" />)).toBe('');
    expect(renderToStaticMarkup(<ImageSlider altText="Meal" language="en" />)).toBe('');
  });

  it('still renders usable photos', () => {
    const html = renderToStaticMarkup(
      <ImageSlider images={['/photos/job_tofu.jpg']} altText="Meal" language="en" deferUntilVisible={false} />
    );
    expect(html).toContain('/photos/job_tofu.jpg');
  });
});
