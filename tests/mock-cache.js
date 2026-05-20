'use strict';

// Synthetic cache for offline test runs when SSH to the VPS is down.
// Each recipe carries the minimum fields searchRecipe / autoTerms need:
//   - url  (slug-bearing — scoreRecipe matches the upper-cased slug)
//   - name (autoTerms tokenizes this)
//   - source_page_id
//   - restaurant (informational)
//   - completeness (tiebreak — set to "full" so all candidates tie)
// Names are real recipes observed in the Le Garage Notion cache.

const NAMES = [
  // Caesar family — important for "caesar salad" vs "dressing" tiebreak
  ['Caesar Salad Dressing',         'cairo'],
  ['Caesar Salad with Chicken',     'cairo'],
  ['Caesar Salad Le Garage Style',  'cairo'],
  ['Chicken Fillet Caesar Salad',   'cairo'],

  // Chicken family — "chicken in the basket" vs "chicken kebab"
  ['Chicken in the Basket',         'cairo'],
  ['Chicken Kebab',                 'cairo'],
  ['Chicken Alfredo Pasta',         'cairo'],
  ['Buffalo Chicken Wings',         'cairo'],
  ['Crispy Buffalo Chicken',        'cairo'],
  ['Le Garage Chicken Salad',       'cairo'],

  // Sauces
  ['Mushroom Sauce',                'cairo'],
  ['Truffle Sauce',                 'cairo'],
  ['Caesar Sauce',                  'cairo'],
  ['Bolognese Sauce',               'cairo'],
  ['Ponzu Sauce',                   'cairo'],
  ['Tahina Sauce',                  'cairo'],
  ['Buffalo Sauce',                 'cairo'],
  ['Pepper Sauce',                  'cairo'],
  ['Hollandaise Sauce',             'cairo'],
  ['Chocolate Sauce',               'cairo'],
  ['Tartar Sauce for Burgers and Fish', 'cairo'],
  ['Le Garage Sauce',               'cairo'],

  // Burgers
  ['Swiss Burger',                  'cairo'],
  ['Smash Burger Delight',          'cairo'],
  ['Fish Burger',                   'cairo'],
  ['Goat Cheese Burger',            'cairo'],
  ['Blue Cheese Burger',            'cairo'],
  ['French Burger',                 'cairo'],

  // Fries / sides
  ['French Fries',                  'cairo'],
  ['Cheese Fries',                  'cairo'],
  ['Sweet Potato Fries',            'cairo'],
  ['Onion Rings',                   'cairo'],

  // Mains
  ['Cordon Bleu',                   'cairo'],
  ['Beef Carpaccio',                'cairo'],
  ['Beef Fillet',                   'cairo'],
  ['Wiener Schnitzel',              'cairo'],
  ['Spaghetti Bolognese',           'cairo'],
  ['Fish & Chips',                  'cairo'],

  // Salads / soups
  ['Goat Cheese Salad',             'cairo'],
  ['Big Salad',                     'cairo'],
  ['Small Salad',                   'cairo'],
  ['Mushroom Soup',                 'cairo'],
  ['Lentil Soup',                   'cairo'],
  ['Carrot Ginger Soup',            'cairo'],

  // Other / sweets
  ['Chocolate Lava Cake',           'cairo'],
  ['Creme Brule',                   'cairo'],
  ['Homemade Apple Crumble Cake',   'cairo'],
  ['Basque Cheesecake',             'cairo'],
  ['Salmon Tartar',                 'cairo'],
  ['Avocado Toast',                 'cairo'],
];

// Build a deterministic 32-char hex id from a name so re-runs are stable.
function fakeId(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
  // Pad to 32 hex chars
  return ('00000000' + h.toString(16)).slice(-8).repeat(4);
}

function makeRecipe(name, restaurant) {
  const id = fakeId(name);
  const slug = name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const url = `https://www.notion.so/${slug}-${id}`;
  return {
    url,
    source_page_id: id,
    restaurant,
    last_edited_time: '2026-05-08T00:00:00.000Z',
    name,
    ingredients_en: '• placeholder\n',
    ingredients_ar: '• placeholder\n',
    prep_en: '',
    prep_ar: '',
    photo_block_id: '',
    video_block_id: '',
    format: 'list',
    completeness: {
      has_ingredients_en: true,
      has_ingredients_ar: true,
      has_prep_en: false,
      has_prep_ar: false,
      has_photo: false,
      has_video: false,
    },
  };
}

const recipes = {};
for (const [name, restaurant] of NAMES) {
  const r = makeRecipe(name, restaurant);
  recipes[r.source_page_id] = r;
}

module.exports = { updated_at: '2026-05-18 mock', recipes_count: NAMES.length, recipes };
