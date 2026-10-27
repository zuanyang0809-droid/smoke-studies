import { describe, expect, it } from 'vitest';
import { fitRect, photoSettings, viewToImage } from '../src/ui/background.js';
import { DEFAULT_STYLE, mergeStyle, validateStyle } from '../src/core/style.js';

describe('background photo fit', () => {
  it('cover fills the view, cropping the long side, centered', () => {
    expect(fitRect(400, 200, 800, 600, 'cover')).toEqual({ x: -200, y: 0, w: 1200, h: 600 });
    expect(fitRect(200, 400, 800, 600)).toEqual({ x: 0, y: -500, w: 800, h: 1600 }); // cover is the default
  });

  it('contain fits the whole photo, letterboxed, centered', () => {
    expect(fitRect(400, 200, 800, 600, 'contain')).toEqual({ x: 0, y: 100, w: 800, h: 400 });
    expect(fitRect(200, 400, 800, 600, 'contain')).toEqual({ x: 250, y: 0, w: 300, h: 600 });
  });

  it('maps view points to image pixels and misses the letterbox', () => {
    const r = fitRect(400, 200, 800, 600, 'contain');
    expect(viewToImage(0, 100, r, 400, 200)).toEqual({ x: 0, y: 0 });
    expect(viewToImage(799, 499, r, 400, 200)).toEqual({ x: 399, y: 199 });
    expect(viewToImage(400, 50, r, 400, 200)).toBeNull();
    const c = fitRect(400, 200, 800, 600, 'cover'); // the cropped center shows image x 66..333
    expect(viewToImage(0, 300, c, 400, 200)).toEqual({ x: 66, y: 100 });
  });
});

describe('backgroundImage in the Style JSON', () => {
  it('defaults to cover at 70% brightness and validates', () => {
    expect(DEFAULT_STYLE.backgroundImage).toEqual({ fit: 'cover', brightness: 0.7 });
    expect(validateStyle(mergeStyle(DEFAULT_STYLE, { backgroundImage: { fit: 'contain' } })).valid).toBe(true);
    expect(validateStyle(mergeStyle(DEFAULT_STYLE, { backgroundImage: { fit: 'stretch' } })).valid).toBe(false);
  });

  it('fills in settings for styles saved before the field existed', () => {
    const { backgroundImage, ...old } = DEFAULT_STYLE;
    expect(validateStyle(old).valid).toBe(true);
    expect(photoSettings(old)).toEqual({ fit: 'cover', brightness: 0.7 });
    expect(photoSettings({ backgroundImage: { brightness: 0.2 } })).toEqual({ fit: 'cover', brightness: 0.2 });
  });
});
