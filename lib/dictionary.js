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

  // ── Modifiers that distinguish specific recipes ───────────────────────────
  // Without these, queries like "le garage sauce" or "spicy sauce" match
  // only SAUCE and any sauce recipe wins by completeness.

  // Brand / location
  'le garage': 'LE-GARAGE',
  'le-garage': 'LE-GARAGE',
  'ле гараж': 'LE-GARAGE',
  'ле-гараж': 'LE-GARAGE',
  'لي جاراج': 'LE-GARAGE',
  'لو جاراج': 'LE-GARAGE',

  // Burger variants
  'classic': 'CLASSIC',
  'класичний': 'CLASSIC',
  'классический': 'CLASSIC',
  'red bean': 'RED-BEAN',
  'red-bean': 'RED-BEAN',
  'червона квасоля': 'RED-BEAN',
  'красная фасоль': 'RED-BEAN',
  'veggie': 'VEGGIE',
  'vegetarian': 'VEGETERIAN',
  'vegeterian': 'VEGETERIAN',
  'веггі': 'VEGGIE',
  'вегетаріанський': 'VEGETERIAN',
  'вегетарианский': 'VEGETERIAN',
  'hawaii': 'HAWAII',
  'hawaiian': 'HAWAII',
  'гаваї': 'HAWAII',
  'гавайский': 'HAWAII',
  'swiss': 'SWISS',
  'швейцарський': 'SWISS',
  'швейцарский': 'SWISS',
  'trio': 'TRIO',
  'тріо': 'TRIO',
  'трио': 'TRIO',
  'french': 'FRENCH',
  'french burger': 'FRENCH-BURGER',
  'французький': 'FRENCH',
  'французский': 'FRENCH',
  'big': 'BIG',
  'big one': 'BIG-ONE',
  'great big': 'BIG',
  'velikij': 'BIG',
  'small': 'SMALL',
  'smash': 'SMASH',
  'смаш': 'SMASH',
  'fish burger': 'FISH-BURGER',
  'shrimp burger': 'SHRIMP-BURGER',
  'halloumi burger': 'HALLOUMI-BURGER',
  'red bean burger': 'RED-BEAN-BURGER',
  'veggie burger': 'VEGGIE-BURGER',

  // Special items
  'special': 'SPECIAL',
  'special one': 'SPECIAL',
  'forest': 'FOREST',
  'лісовий': 'FOREST',
  'лесной': 'FOREST',
  'single': 'SINGLE',
  'dipper': 'DIPPER',
  'дипер': 'DIPPER',

  // Sauce variants
  'spicy': 'SPICY',
  'гострий': 'SPICY',
  'острый': 'SPICY',
  'orange': 'ORANGE',
  'апельсин': 'ORANGE',
  'апельсиновий': 'ORANGE',
  'green': 'GREEN',
  'зелений': 'GREEN',
  'зеленый': 'GREEN',
  'red': 'RED',
  'червоний': 'RED',
  'красный': 'RED',
  'le garage sauce': 'LE-GARAGE-SAUCE',
  'le garage signature': 'LE-GARAGE',

  // Preparation styles / textures
  'crispy': 'CRISPY',
  'хрумкий': 'CRISPY',
  'хрустящий': 'CRISPY',
  'mashed': 'MASHED',
  'товчений': 'MASHED',
  'mashed potato': 'MASHED-POTATO',
  'mashed potatoes': 'MASHED-POTATO',
  'rostie': 'ROSTIE',
  'rosti': 'ROSTIE',
  'roast': 'ROAST',
  'roasted': 'ROAST',
  'grilled': 'GRILLED',
  'fried': 'FRIED',
  'pickled': 'PICKLED',
  'caramelized': 'CARAMELIZED',
  'smoked': 'SMOKED',
  'tempura': 'TEMPURA',

  // Dishes / sides
  'chips': 'CHIPS',
  'фрі': 'FRIES',
  'фри': 'FRIES',
  'fish chips': 'FISH-CHIPS',
  'fish and chips': 'FISH-CHIPS',
  'fish & chips': 'FISH-CHIPS',
  'mac and cheese': 'MAC-CHEESE',
  'mac & cheese': 'MAC-CHEESE',
  'panna cotta': 'PANNA-COTTA',
  'pavlova': 'PAVLOVA',
  'павлова': 'PAVLOVA',
  'bolognese': 'BOLOGNESE',
  'spaghetti': 'SPAGHETTI',
  'спагетті': 'SPAGHETTI',
  'спагетти': 'SPAGHETTI',
  'risotto': 'RISOTTO',
  'різотто': 'RISOTTO',
  'ризотто': 'RISOTTO',
  'gambas': 'GAMBAS',
  'pil pil': 'PIL-PIL',
  'gambas pil pil': 'GAMBAS-PIL-PIL',
  'shnitzel': 'SCHNITZEL',
  'schnitzel kids': 'SCHNITZEL-KIDS',
  'wiener': 'WIENER',
  'wiener schnitzel': 'WIENER-SCHNITZEL',
  'in the basket': 'IN-THE-BASKET',
  'chicken in the basket': 'CHICKEN-IN-THE-BASKET',
  'kids': 'KIDS',
  'kid': 'KIDS',

  // Marinades / patties / prep components
  'patty': 'PATTY',
  'patties': 'PATTY',
  'marinade': 'MARINADE',
  'beef kebab marinade': 'BEEF-KEBAB-MARINADE',
  'chicken kebab marinade': 'CHICKEN-KEBAB-MARINADE',
  'dough': 'DOUGH',
  'pancake dough': 'PANCAKE-DOUGH',
  'white bread': 'WHITE-BREAD',
  'brioche': 'BRIOCHE',
  'sesame': 'SESAME',
  'sesame burger bun': 'SESAME-BURGER-BUN',

  // Sauces, dressings, mixes
  'dressing': 'DRESSING',
  'french dressing': 'FRENCH-DRESSING',
  'caesar dressing': 'CAESAR-DRESSING',
  'aioli': 'AIOLI',
  'kimchi': 'KIMCHI',
  'aioli kimchi sauce': 'AIOLI-KIMCHI-SAUCE',
  'wasabi': 'WASABI',
  'wasabi aioli': 'WASABI-AIOLI',
  'tartar': 'TARTAR',
  'tartar sauce': 'TARTAR-SAUCE',
  'truffle': 'TRUFFLE',
  'truffle sauce': 'TRUFFLE-SAUCE',
  'truffle oil': 'TRUFFLE-OIL',
  'truffle oil mix': 'TRUFFLE-OIL-MIX',
  'mushroom sauce': 'MUSHROOM-SAUCE',
  'mushroom soup': 'MUSHROOM-SOUP',
  'buffalo sauce': 'BUFFALO-SAUCE',
  'cheese sauce': 'CHEESE-SAUCE',
  'tahina': 'TAHINA',
  'tomato feta': 'TOMATO-FETA',
  'feta': 'FETA',
  'minced garlic': 'MINCED-GARLIC',
  'garlic': 'GARLIC',
  'часник': 'GARLIC',
  'чеснок': 'GARLIC',
  'tomato basil': 'TOMATO-BASIL',
  'basil dill': 'BASIL-DILL',
  'basil': 'BASIL',
  'dill': 'DILL',
  'кріп': 'DILL',
  'укроп': 'DILL',
  'tomato feta dip': 'TOMATO-FETA',
  'mix green oil': 'GREEN-OIL',
  'green oil': 'GREEN-OIL',
  'mix herbs': 'MIX-HERBS',
  'mix berry': 'MIX-BERRY',
  'mixed berries': 'MIX-BERRY',
  'orange sauce': 'ORANGE-SAUCE',
  'spicy sauce': 'SPICY-SAUCE',
  'rosemary': 'ROSEMARY',
  'розмарин': 'ROSEMARY',
  'honey mustard': 'HONEY-MUSTARD',
  'cranberry': 'CRANBERRY',
  'sweet balsamic': 'SWEET-BALSAMIC',
  'balsamic': 'BALSAMIC',
  'pickled onion': 'PICKLED-ONION',
  'onion confit': 'ONION-CONFIT',
  'onion chutney': 'ONION-CHUTNEY',
  'chutney': 'CHUTNEY',
  'cafe de paris': 'CAFE-DE-PARIS',
  'café de paris': 'CAFE-DE-PARIS',
  'brown butter': 'BROWN-BUTTER',
  'tempura butter': 'TEMPURA-BUTTER',
  'brioche burger': 'BRIOCHE-BURGER',
  'brown': 'BROWN',
  'caramelized pear': 'CARAMELIZED-PEAR',
  'caramelized apple': 'CARAMELIZED-APPLE',
  'chocolate sauce': 'CHOCOLATE-SAUCE',
  'chocolate lava': 'LAVA-CAKE',
  'fig mustard': 'FIG-MUSTARD',
  'fig': 'FIG',
  'tarragon': 'TARRAGON',
  'ponzu': 'PONZU',
  'ponzu sauce': 'PONZU-SAUCE',
  'tandoori': 'TANDOORI',
  'tandoori sauce': 'TANDOORI-SAUCE',
  'pesto': 'PESTO',
  'guacamole': 'GUACAMOLE',

  // Breakfast variants
  'breakfast': 'BREAKFAST',
  'le garage breakfast': 'LE-GARAGE-BREAKFAST',
  'vegeterian breakfast': 'VEGETERIAN-BREAKFAST',
  'rosemary honey topping': 'ROSEMARY-HONEY-TOPPING',

  // Salads / sides / fries variants
  'shrimps for salads': 'SHRIMPS-FOR-SALADS',
  'marina seafood': 'MARINA-SEAFOOD',
  'shrimp avocado': 'SHRIMP-AVOCADO',
  'cheese fries': 'CHEESE-FRIES',
  'small cheese fries': 'SMALL-CHEESE-FRIES',
  'sweet potato': 'SWEET-POTATO',
  'sweet potato fries': 'SWEET-POTATO-FRIES',
  'black bean': 'BLACK-BEAN',
  'big salad': 'BIG-SALAD',
  'small salad': 'SMALL-SALAD',
  'side dish': 'SIDE-DISH',
  'side dish salad': 'SIDE-DISH-SALAD',

  // Other things
  'apple crumble': 'APPLE-CRUMBLE',
  'banana peanut butter': 'BANANA-PEANUT-BUTTER',
  'tropical': 'TROPICAL',
  'mix berries': 'MIX-BERRY',
  'breakfast panna cotta': 'BREAKFAST-PANNA-COTTA',
  'tropical bowl': 'TROPICAL-BOWL',
  'salmon tartar': 'SALMON-TARTAR',
  'salmon rostie': 'SALMON-ROSTIE',
  'exotic salmon': 'EXOTIC-SALMON',
  'beef nachos': 'BEEF-NACHOS',
  'beef carpaccio': 'BEEF-CARPACCIO',
  'carpaccio': 'CARPACCIO',
  'carrot ginger': 'CARROT-GINGER',
  'sweet corn': 'SWEET-CORN',
  'sweet corn ribs': 'SWEET-CORN-RIBS',
  'corn ribs': 'CORN-RIBS',
  'ribs': 'RIBS',
  'beef fillet': 'BEEF-FILLET',
  'fish burger': 'FISH-BURGER',
  'french fries': 'FRENCH-FRIES',
  'mac cheese': 'MAC-CHEESE',
  'creamy mushroom': 'CREAMY-MUSHROOM',
  'creamy mushroom soup': 'CREAMY-MUSHROOM-SOUP',
  'grilled chicken': 'GRILLED-CHICKEN',
  'grilled vegetables': 'GRILLED-VEGETABLES',
  'fried camembert': 'FRIED-CAMEMBERT',
  'fried camemebert': 'FRIED-CAMEMBERT',
  'fried eggs bacon': 'FRIED-EGGS-BACON',
  'creme brulee': 'CREME-BRULE',
  'cheese cake': 'CHEESECAKE',
  'lemon yoghurt': 'LEMON-YOGHURT',
  'le-garage-style': 'LE-GARAGE-STYLE',
  'le garage style': 'LE-GARAGE-STYLE',
  'eggs benedict': 'EGGS-BENEDICT',
  'avocado toast': 'AVOCADO-TOAST',
  'french toast': 'FRENCH-TOAST',
  'ultimate french toast': 'ULTIMATE-FRENCH-TOAST',
  'cordon bleu': 'CORDON-BLEU',
  'kebab': 'KEBAB',
  'beef kebab': 'BEEF-KEBAB',
  'chicken kebab': 'CHICKEN-KEBAB',
  'chicken alfredo': 'CHICKEN-ALFREDO',
  'chicken alfredo pasta': 'CHICKEN-ALFREDO-PASTA',
  'spaghetti bolognese': 'SPAGHETTI-BOLOGNESE',
  'linguine': 'LINGUINE',
  'linguine prawns': 'LINGUINE-PRAWNS',
  'smoked salmon pasta': 'SMOKED-SALMON-PASTA',
  'tomato basil pasta': 'TOMATO-BASIL-PASTA',
  'lentil soup': 'LENTIL-SOUP',
  'carrot ginger soup': 'CARROT-GINGER-SOUP',
  'pumpkin soup': 'PUMPKIN-SOUP',
  'creme brule': 'CREME-BRULE',
  'basque cheesecake': 'BASQUE-CHEESECAKE',
  'basque': 'BASQUE',
  'lava cake': 'LAVA-CAKE',
  'chocolate lava cake': 'CHOCOLATE-LAVA-CAKE',
  'home made apple crumble': 'APPLE-CRUMBLE',
  'apple crumble cake': 'APPLE-CRUMBLE',
  'homemade apple crumble cake': 'APPLE-CRUMBLE',
  'wiener schnitzel kids': 'WIENER-SCHNITZEL-KIDS',
  'wien schnitzel kids': 'WIENER-SCHNITZEL-KIDS',
  'wien schnitzel': 'WIENER-SCHNITZEL',
  'caesar salad': 'CAESAR-SALAD',
  'goat cheese salad': 'GOAT-CHEESE-SALAD',
  'goat cheese burger': 'GOAT-CHEESE-BURGER',
  'blue cheese burger': 'BLUE-CHEESE-BURGER',
  'goat cheese': 'GOAT-CHEESE',
  'blue cheese': 'BLUE-CHEESE',
  'forest mushroom': 'FOREST-MUSHROOM',
  'avocado salad': 'AVOCADO-SALAD',
  'shrimp avocado salad': 'SHRIMP-AVOCADO-SALAD',
  'crispy buffalo chicken': 'CRISPY-BUFFALO-CHICKEN',
  'buffalo chicken': 'BUFFALO-CHICKEN',
  'buffalo chicken wings': 'BUFFALO-CHICKEN-WINGS',
  'buffalo wings': 'BUFFALO-CHICKEN-WINGS',
  'chicken nuggets': 'CHICKEN-NUGGETS',
  'nuggets pf': 'CHICKEN-NUGGETS',
  'shrimp popcorn': 'SHRIMP-POPCORN',
  'popcorn': 'POPCORN',
  'shrimps': 'SHRIMP',
  'onion rings': 'ONION-RINGS',
  'fried camemebert pf': 'FRIED-CAMEMBERT',
  'camembert': 'CAMEMBERT',
  'camemebert': 'CAMEMBERT',
  'black pearl': 'BLACK-PEARL',
  'pearl': 'BLACK-PEARL',
  'tropical bowl pf': 'TROPICAL-BOWL',
  'mix berries bowl': 'MIX-BERRIES-BOWL',
  'banana peanut': 'BANANA-PEANUT-BUTTER',
  'omelette': 'OMELETTE',
  'le garage omelette': 'LE-GARAGE-OMELETTE',
  'hash brown': 'HASH-BROWNS',
  'hash browns': 'HASH-BROWNS',
  'green oil pf': 'GREEN-OIL',
  'red oil': 'RED-OIL',
  'red oil pf': 'RED-OIL',
  'shrimp burger': 'SHRIMP-BURGER',
  'halloumi burger': 'HALLOUMI-BURGER',
  'avocado burger': 'AVOCADO-BURGER',
  'the big one': 'BIG-ONE',
  'special truffle': 'SPECIAL-TRUFFLE',
  'special truffle one': 'SPECIAL-TRUFFLE',
  'the special truffle one': 'SPECIAL-TRUFFLE',
  'the special one': 'SPECIAL-ONE',
  'le garage dipper': 'LE-GARAGE-DIPPER',
  'fish burger recipe card': 'FISH-BURGER',
  'goat cheese burger recipe card': 'GOAT-CHEESE-BURGER',
  'forest mushroom burger recipe card': 'FOREST-MUSHROOM-BURGER',
  'recipe card': 'RECIPE-CARD',
  'wienner schnitzel': 'WIENER-SCHNITZEL',
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
