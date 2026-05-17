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

  // 'lava' alone maps to LAVA-CAKE so "chocolate lava" finds the cake
  // (not Chocolate Sauce). "lava cake" multi-word still takes priority.
  'lava': 'LAVA-CAKE',
  'لافا': 'LAVA-CAKE',

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

  // ── Cyrillic (UA/RU) transliterations ─────────────────────────────────────
  // The kitchen is in Cairo, but the owner/staff sometimes test the bot in
  // Cyrillic. Keys here cover the most-typed dish keywords; fuzzy matching
  // handles common typos automatically.

  // Meats / seafood
  'курка': 'CHICKEN',
  'курица': 'CHICKEN',
  'фарш': 'BEEF',
  'говядина': 'BEEF',
  'яловичина': 'BEEF',
  'риба': 'FISH',
  'рыба': 'FISH',
  'креветки': 'SHRIMP',
  'лосось': 'SALMON',

  // Vegetables / produce
  'гриб': 'MUSHROOM',
  'гриби': 'MUSHROOM',
  'грибы': 'MUSHROOM',
  'гарбуз': 'PUMPKIN',
  'тыква': 'PUMPKIN',
  'авокадо': 'AVOCADO',
  'морква': 'CARROT',
  'морковь': 'CARROT',
  'імбир': 'GINGER',
  'имбирь': 'GINGER',
  'сочевиця': 'LENTIL',
  'чечевица': 'LENTIL',
  'помідор': 'TOMATO',
  'помидор': 'TOMATO',
  'цибуля': 'ONION',
  'лук': 'ONION',
  'картопля': 'POTATO',
  'картошка': 'POTATO',

  // Dishes
  'суп': 'SOUP',
  'салат': 'SALAD',
  'паста': 'PASTA',
  'піца': 'PIZZA',
  'пицца': 'PIZZA',
  'бургер': 'BURGER',
  'сендвіч': 'SANDWICH',
  'сэндвич': 'SANDWICH',
  'стейк': 'STEAK',
  'філе': 'FILLET',
  'филе': 'FILLET',
  'омлет': 'OMELETTE',
  'тост': 'TOAST',
  'нагетси': 'NUGGETS',
  'крильця': 'WINGS',
  'крылышки': 'WINGS',
  'кільця': 'RINGS',
  'кольца': 'RINGS',
  'сніданок': 'BREAKFAST',
  'завтрак': 'BREAKFAST',
  'яйце': 'EGGS',
  'яйцо': 'EGGS',

  // Cheeses
  'сир': 'CHEESE',
  'сыр': 'CHEESE',
  'халумі': 'HALLOUMI',
  'халуми': 'HALLOUMI',
  'моцарелла': 'MOZZARELLA',
  'пармезан': 'PARMESAN',
  'чеддер': 'CHEDDAR',

  // Sauces / oils / condiments
  'соус': 'SAUCE',
  'соуc': 'SAUCE',
  'олія': 'OIL',
  'масло': 'OIL',
  'вершкове': 'BUTTER',
  'майонез': 'MAYO',
  'мед': 'HONEY',
  'гірчиця': 'MUSTARD',
  'горчица': 'MUSTARD',

  // Bread / desserts
  'хліб': 'BREAD',
  'хлеб': 'BREAD',
  'булочка': 'BUN',
  'крем': 'CREAM',
  'трюфель': 'TRUFFLE',
  'шоколад': 'CHOCOLATE',
  'торт': 'CAKE',
  'кейк': 'CAKE',
  'тортик': 'CAKE',
  'лава': 'LAVA-CAKE',
  'крамбл': 'CRUMBLE',
  'панна': 'PANNA-COTTA',

  // Named styles
  'буффало': 'BUFFALO',
  'альфредо': 'ALFREDO',
  'тартар': 'TARTAR',
  'шніцель': 'SCHNITZEL',
  'шницель': 'SCHNITZEL',
  'кебаб': 'KEBAB',
  'болоньєзе': 'BOLOGNESE',
  'болоньезе': 'BOLOGNESE',
  'цезар': 'CAESAR',
  'цезарь': 'CAESAR',
  'бенедикт': 'BENEDICT',
  'теріяки': 'TERIYAKI',
  'тандурі': 'TANDOORI',
  'песто': 'PESTO',
  'тахіні': 'TAHINA',
  'гуакамоле': 'GUACAMOLE',

  // Multi-word Cyrillic phrases (matched before single-word pass)
  'козячий сир': 'GOAT-CHEESE',
  'козий сыр': 'GOAT-CHEESE',
  'голубий сир': 'BLUE-CHEESE',
  'голубой сыр': 'BLUE-CHEESE',
  'кордон блю': 'CORDON-BLEU',
  'панна котта': 'PANNA-COTTA',
  'панакотта': 'PANNA-COTTA',
  'лава кейк': 'LAVA-CAKE',
  'лава торт': 'LAVA-CAKE',
  'шоколадна лава': 'LAVA-CAKE',
  'шоколадный лава': 'LAVA-CAKE',
  'французький тост': 'FRENCH-TOAST',
  'французский тост': 'FRENCH-TOAST',
  'картопля фрі': 'FRENCH-FRIES',
  'картошка фри': 'FRENCH-FRIES',
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
