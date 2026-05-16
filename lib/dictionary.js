'use strict';

// Translation dictionary: English + Arabic spellings → canonical UPPER-CASE code.
// The code is what gets matched against the recipe slug (e.g. "MUSHROOM-SAUCE").
// To support a new dish keyword, add its EN and AR spellings here, then make sure
// the recipe in Notion has the code present in its URL slug.
const DICTIONARY = {
  // ── Meats ──────────────────────────────────────────────────────────────────
  'chicken': 'CHICKEN',
  'دجاج': 'CHICKEN',
  'فراخ': 'CHICKEN',

  'beef': 'BEEF',
  'لحم': 'BEEF',
  'لحمة': 'BEEF',

  'lamb': 'LAMB',
  'حمل': 'LAMB',
  'خروف': 'LAMB',

  'veal': 'VEAL',
  'عجل': 'VEAL',

  'bacon': 'BACON',
  'بايكون': 'BACON',

  // ── Seafood ────────────────────────────────────────────────────────────────
  'fish': 'FISH',
  'سمك': 'FISH',

  'shrimp': 'SHRIMP',
  'shrimps': 'SHRIMP',
  'prawn': 'SHRIMP',
  'prawns': 'SHRIMP',
  'جمبري': 'SHRIMP',

  'salmon': 'SALMON',
  'سلمون': 'SALMON',

  'seafood': 'SEAFOOD',
  'مأكولات بحرية': 'SEAFOOD',

  // ── Vegetables / produce ───────────────────────────────────────────────────
  'mushroom': 'MUSHROOM',
  'mushrooms': 'MUSHROOM',
  'فطر': 'MUSHROOM',
  'مشروم': 'MUSHROOM',

  'pumpkin': 'PUMPKIN',
  'يقطين': 'PUMPKIN',
  'قرع': 'PUMPKIN',

  'avocado': 'AVOCADO',
  'أفوكادو': 'AVOCADO',
  'افوكادو': 'AVOCADO',

  'carrot': 'CARROT',
  'carrots': 'CARROT',
  'جزر': 'CARROT',

  'ginger': 'GINGER',
  'زنجبيل': 'GINGER',

  'lentil': 'LENTIL',
  'lentils': 'LENTIL',
  'عدس': 'LENTIL',

  'tomato': 'TOMATO',
  'tomatoes': 'TOMATO',
  'طماطم': 'TOMATO',

  'onion': 'ONION',
  'onions': 'ONION',
  'بصل': 'ONION',

  'corn': 'CORN',
  'ذرة': 'CORN',

  'potato': 'POTATO',
  'potatoes': 'POTATO',
  'بطاطس': 'POTATO',

  'pear': 'PEAR',
  'كمثرى': 'PEAR',

  'apple': 'APPLE',
  'تفاح': 'APPLE',

  'banana': 'BANANA',
  'موز': 'BANANA',

  'berry': 'BERRY',
  'berries': 'BERRY',
  'توت': 'BERRY',

  // ── Dishes ─────────────────────────────────────────────────────────────────
  'soup': 'SOUP',
  'شوربة': 'SOUP',
  'شوربه': 'SOUP',

  'salad': 'SALAD',
  'سلطة': 'SALAD',
  'سلطه': 'SALAD',

  'pasta': 'PASTA',
  'مكرونة': 'PASTA',
  'باستا': 'PASTA',

  'pizza': 'PIZZA',
  'بيتزا': 'PIZZA',

  'burger': 'BURGER',
  'برجر': 'BURGER',
  'برغر': 'BURGER',

  'sandwich': 'SANDWICH',
  'ساندويتش': 'SANDWICH',

  'steak': 'STEAK',
  'ستيك': 'STEAK',

  'fillet': 'FILLET',
  'فيليه': 'FILLET',

  'nachos': 'NACHOS',
  'ناتشوز': 'NACHOS',

  'omelette': 'OMELETTE',
  'omelet': 'OMELETTE',
  'عجة': 'OMELETTE',

  'toast': 'TOAST',
  'توست': 'TOAST',

  'wings': 'WINGS',
  'أجنحة': 'WINGS',

  'nuggets': 'NUGGETS',
  'ناجتس': 'NUGGETS',

  'fries': 'FRIES',
  'بطاطس مقلية': 'FRIES',

  'rings': 'RINGS',
  'حلقات': 'RINGS',

  'breakfast': 'BREAKFAST',
  'فطار': 'BREAKFAST',
  'فطور': 'BREAKFAST',

  'eggs': 'EGGS',
  'egg': 'EGGS',
  'بيض': 'EGGS',

  // ── Cheeses ────────────────────────────────────────────────────────────────
  'cheese': 'CHEESE',
  'جبنة': 'CHEESE',
  'جبن': 'CHEESE',

  'halloumi': 'HALLOUMI',
  'حلوم': 'HALLOUMI',

  'mozzarella': 'MOZZARELLA',
  'موزاريلا': 'MOZZARELLA',

  'parmesan': 'PARMESAN',
  'بارميزان': 'PARMESAN',

  'cheddar': 'CHEDDAR',
  'شيدر': 'CHEDDAR',

  'camembert': 'CAMEMBERT',
  'كاممبر': 'CAMEMBERT',
  'كامبير': 'CAMEMBERT',

  // ── Sauces, oils, condiments ───────────────────────────────────────────────
  'sauce': 'SAUCE',
  'صلصة': 'SAUCE',
  'صوص': 'SAUCE',

  // OIL is intentionally distinct from SAUCE — see OPPOSITES below
  'oil': 'OIL',
  'زيت': 'OIL',

  'butter': 'BUTTER',
  'زبدة': 'BUTTER',

  'mayo': 'MAYO',
  'mayonnaise': 'MAYO',
  'مايونيز': 'MAYO',

  'mustard': 'MUSTARD',
  'خردل': 'MUSTARD',
  'مستردة': 'MUSTARD',

  'honey': 'HONEY',
  'عسل': 'HONEY',

  'dressing': 'DRESSING',
  'دريسنج': 'DRESSING',

  'jam': 'JAM',
  'مربى': 'JAM',

  'dip': 'DIP',
  'غموس': 'DIP',

  // ── Bread / dough ──────────────────────────────────────────────────────────
  'bread': 'BREAD',
  'خبز': 'BREAD',
  'عيش': 'BREAD',

  'bun': 'BUN',
  'فطيرة': 'BUN',

  // ── Misc / desserts ────────────────────────────────────────────────────────
  'cream': 'CREAM',
  'كريمة': 'CREAM',

  'truffle': 'TRUFFLE',
  'كمأة': 'TRUFFLE',
  'ترفل': 'TRUFFLE',
  'ترافل': 'TRUFFLE',

  'chocolate': 'CHOCOLATE',
  'شوكولاتة': 'CHOCOLATE',

  'cake': 'CAKE',
  'كيك': 'CAKE',
  'تورتة': 'CAKE',

  'cheesecake': 'CHEESECAKE',
  'تشيز كيك': 'CHEESECAKE',

  'crumble': 'CRUMBLE',
  'كرامبل': 'CRUMBLE',

  // ── Named dishes / styles ──────────────────────────────────────────────────
  'buffalo': 'BUFFALO',
  'بافلو': 'BUFFALO',

  'alfredo': 'ALFREDO',
  'الفريدو': 'ALFREDO',
  'ألفريدو': 'ALFREDO',

  'tartar': 'TARTAR',
  'تارتار': 'TARTAR',

  'schnitzel': 'SCHNITZEL',
  'shnitzel': 'SCHNITZEL',
  'شنيتزل': 'SCHNITZEL',
  'شنسيل': 'SCHNITZEL',

  'kebab': 'KEBAB',
  'كباب': 'KEBAB',

  'bolognese': 'BOLOGNESE',
  'بولونيز': 'BOLOGNESE',

  'caesar': 'CAESAR',
  'سيزر': 'CAESAR',

  'benedict': 'BENEDICT',
  'بنديكت': 'BENEDICT',

  'teriyaki': 'TERIYAKI',
  'تيرياكي': 'TERIYAKI',

  'tandoori': 'TANDOORI',
  'تندوري': 'TANDOORI',

  'pesto': 'PESTO',
  'بيستو': 'PESTO',

  'tahina': 'TAHINA',
  'tahini': 'TAHINA',
  'طحينة': 'TAHINA',

  'guacamole': 'GUACAMOLE',
  'جواكامولي': 'GUACAMOLE',

  'coleslaw': 'COLESLAW',
  'كول سلو': 'COLESLAW',

  'aioli': 'AIOLI',
  'آيولي': 'AIOLI',

  'kimchi': 'KIMCHI',
  'كيمتشي': 'KIMCHI',

  'wasabi': 'WASABI',
  'واسابي': 'WASABI',

  'ponzu': 'PONZU',
  'بونزو': 'PONZU',

  'tempura': 'TEMPURA',
  'تمبورا': 'TEMPURA',

  // ── Multi-word phrases (matched before single-word pass) ───────────────────
  'goat cheese': 'GOAT-CHEESE',
  'جبنة ماعز': 'GOAT-CHEESE',
  'جبنه ماعز': 'GOAT-CHEESE',

  'blue cheese': 'BLUE-CHEESE',
  'جبنة زرقاء': 'BLUE-CHEESE',
  'جبنة بلو': 'BLUE-CHEESE',

  'cordon bleu': 'CORDON-BLEU',
  'كوردون بلو': 'CORDON-BLEU',

  'panna cotta': 'PANNA-COTTA',
  'بانا كوتا': 'PANNA-COTTA',

  'lava cake': 'LAVA-CAKE',
  'لافا كيك': 'LAVA-CAKE',

  'french toast': 'FRENCH-TOAST',
  'توست فرنسي': 'FRENCH-TOAST',

  'french fries': 'FRENCH-FRIES',
  'بطاطس فرنسية': 'FRENCH-FRIES',

  'mac cheese': 'MAC-CHEESE',
  'mac and cheese': 'MAC-CHEESE',

  'creme brulee': 'CREME-BRULE',
  'كريم برولي': 'CREME-BRULE',

  'surf turf': 'SURF-TURF',
  'surf and turf': 'SURF-TURF',
};

// Pairs that should never substitute for each other. If the user's query
// resolves to one side and the candidate recipe slug only contains the
// other, the recipe is rejected (score = -1).
const OPPOSITES = [
  ['SAUCE', 'OIL'],
  ['SALAD', 'SOUP'],
  ['CHICKEN', 'BEEF'],
  ['BURGER', 'SANDWICH'],
];

module.exports = { DICTIONARY, OPPOSITES };
