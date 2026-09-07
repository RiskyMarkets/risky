/* The token roster every surface on the page draws from. */

/*
 * The memecoins the curves are opened against. Editing this list is enough to
 * change every surface: the hero burst, the market marquee and the curve scene
 * all read from it.
 *
 * `image` is the token's own artwork, already cropped to a circle with a
 * transparent surround, so it drops straight onto a coin, a chip or an SVG
 * without any further masking. `color` is the signature colour sampled from
 * that artwork; it paints the coin's rim and the chip's ring.
 */
export const TOKENS = [
  { id: 'ai',     ticker: 'AI',     name: 'Artificial Inu', image: 'brand/tokens/visor-dog.png',     color: '#4b4a8f' },
  { id: 'meme',   ticker: 'MEME',   name: 'A Meme Coin',    image: 'brand/tokens/amc.png',           color: '#d61532' },
  { id: 'grass',  ticker: 'GRASS',  name: 'Touch Grass',    image: 'brand/tokens/tg.png',            color: '#54a4e5' },
  { id: 'boner',  ticker: 'BONER',  name: 'Boner Coin',     image: 'brand/tokens/statue.png',        color: '#9f7527' },
  { id: 'moo',    ticker: 'MOO',    name: 'Memory cow Moo', image: 'brand/tokens/cow.png',           color: '#b3f901' },
  { id: 'shroom', ticker: 'SHROOM', name: 'MUSHROOM',       image: 'brand/tokens/mushroom.png',      color: '#eedbb6' },
  /* Ticker not identified from the source screenshot — fill these two in and
   * every surface picks them up. The artwork carries the identity meanwhile. */
  { id: 'chrome', ticker: null,     name: null,             image: 'brand/tokens/chrome-letter.png', color: '#9aa698' },
];

/* The reserve asset every curve is priced in. */
export const RESERVE = { id: 'hood', ticker: 'HOOD', name: 'Robinhood Chain', color: '#00d95a' };
