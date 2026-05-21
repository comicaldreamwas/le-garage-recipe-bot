'use strict';

// Boho recipe titles in Notion are English-only, but the kitchen often
// types Arabic transliterations of those dish names ("تزاتزيكي" for
// Tzatziki, "بشاميل" for Bechamel). The hand-curated DICTIONARY in
// lib/dictionary.js covers common AR translations for Le Garage
// (sauce, chicken, salad, dressing…) but doesn't include
// Boho-specific transliterations of European/Mediterranean dish
// names. This file extends DICTIONARY with those aliases at
// require-time so no code path has to special-case it — search.js
// already iterates DICTIONARY for AR queries.
//
// Each entry maps the Arabic spelling kitchen staff actually type to
// the canonical UPPER-CASE code that already exists in DICTIONARY or
// in the recipe slugs. Single-word codes are preferred over hyphenated
// multi-word codes so the v4.0.2 component-singles flow can find the
// dish even when the slug doesn't carry the exact phrase.

const ARABIC_ALIASES = {
  // ── Dish categories / cuisine vocabulary ────────────────────────────
  'تزاتزيكي':   'TZATZIKI',
  'تساتسيكي':   'TZATZIKI',
  'بشاميل':     'BECHAMEL',
  'بيشاميل':    'BECHAMEL',
  'موس':        'MOUSSE',
  'موسي':       'MOUSSE',
  'تشيز كيك':   'CHEESECAKE',
  'تشيزكيك':    'CHEESECAKE',
  'تشيز':       'CHEESE',
  'كيك':        'CAKE',
  'ريزوتو':     'RISOTTO',
  'ريسوتو':     'RISOTTO',
  'كالاماري':   'CALAMARI',
  'جواكاموله':  'GUACAMOLE',
  'جواكامولي':  'GUACAMOLE',
  'حمص':        'HUMMUS',
  'حمّص':       'HUMMUS',
  'كروك مدام':  'CROQUE-MADAME',
  'فوكاتشيا':   'FOCACCIA',
  'فوكاسيا':    'FOCACCIA',
  'أفوكادو':    'AVOCADO',
  'افوكادو':    'AVOCADO',
  'بولونيز':    'BOLOGNESE',
  'بولونيس':    'BOLOGNESE',
  'ستروجانوف':  'STROGANOFF',
  'بافلوفا':    'PAVLOVA',
  'تارتار':     'TARTAR',
  'تارتر':      'TARTAR',
  'تمبورا':     'TEMPURA',
  'تيمبورا':    'TEMPURA',
  'ماسالا':     'MASALA',
  'مسالا':      'MASALA',
  'بوهو':       'BOHO',
  'تشاتني':     'CHUTNEY',
  'شاتني':      'CHUTNEY',
  'مارينة':     'MARINADE',
  'تتبيلة':     'MARINADE',
  'فينيغريت':   'VINAIGRETTE',
  'كيش':        'QUICHE',
  'سوفليه':     'SOUFFLE',
  'ريوش':       'BRIOCHE',
  'كيوي':       'KIWI',
  'مانجو':      'MANGO',
  'فراولة':     'STRAWBERRY',
  'توت':        'BERRY',
  'باشن فروت':  'PASSION-FRUIT',
  'باشون فروت': 'PASSION-FRUIT',
  'فستق':       'PISTACHIO',
  'لوز':        'ALMOND',
  'كاجو':       'CASHEW',
  'جوز':        'WALNUT',
  'كراميل':     'CARAMEL',
  'كاراميل':    'CARAMEL',
  'فانيليا':    'VANILLA',
  'دارسين':     'CINNAMON',
  'قرفة':       'CINNAMON',
  'زبدة الفول السوداني': 'PEANUT-BUTTER',
  'كروسان':     'CROISSANT',
  'وافل':       'WAFFLE',
  'بانكيك':     'PANCAKE',
  'باربكيو':    'BBQ',
  'لينجويني':   'LINGUINE',
  'سباغيتي':    'SPAGHETTI',
  'بيستو':      'PESTO',
  'تيرياكي':    'TERIYAKI',
  'سوشي':       'SUSHI',
  'مكروني':     'MAC',
};

module.exports = { ARABIC_ALIASES };
