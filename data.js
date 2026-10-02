/* Logan'sCafe dashboard: data.js
   Everything here is made-up demo data. Orders come from a seeded random
   number generator, so each day always gets the same orders: reload the page
   and the numbers stay put, and today's figures grow as the clock moves. */

/* ---------- Dates ---------- */

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// "2026-10-02"
function dateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/* ---------- Opening hours (the same as the café's website) ---------- */

// Opening and closing hours (24h clock) for each day, Sunday first
const openingHours = [
  [9, 19], // Sunday
  [7, 21], // Monday
  [7, 21],
  [7, 21],
  [7, 21],
  [7, 21], // Friday
  [8, 21], // Saturday
];

/* ---------- The menu (the same as the café's website) ---------- */

const categories = [
  { id: "coffee", name: "Coffee", photo: "assets/menu-coffee.webp" },
  { id: "cold", name: "Cold drinks", photo: "assets/menu-cold.webp" },
  { id: "pastries", name: "Pastries", photo: "assets/menu-pastries.webp" },
];

// popularity: how often it gets picked compared with the rest
const defaultMenu = [
  { id: "espresso", category: "coffee", name: "Espresso", price: 3.5, popularity: 7, desc: "Rich and bold, from freshly ground single-origin beans." },
  { id: "americano", category: "coffee", name: "Americano", price: 3.75, popularity: 9, desc: "A double shot, lengthened with hot water." },
  { id: "flat-white", category: "coffee", name: "Flat White", price: 4, popularity: 14, desc: "Velvety microfoam over a double shot." },
  { id: "cappuccino", category: "coffee", name: "Cappuccino", price: 4.5, popularity: 12, desc: "Silky froth and a dusting of cocoa." },
  { id: "cold-brew", category: "cold", name: "Cold Brew", price: 5, popularity: 5, desc: "Steeped for 12 hours, served over ice." },
  { id: "iced-latte", category: "cold", name: "Iced Latte", price: 4.75, popularity: 7, desc: "Espresso and cold milk, poured over ice." },
  { id: "iced-matcha", category: "cold", name: "Iced Matcha Latte", price: 5.5, popularity: 4, desc: "Ceremonial-grade matcha with oat milk." },
  { id: "vanilla-cloud", category: "cold", name: "Vanilla Cloud Latte", price: 5.5, popularity: 8, desc: "Vanilla, espresso and cold foam." },
  { id: "croissant", category: "pastries", name: "Butter Croissant", price: 3, popularity: 12, desc: "Flaky and golden, baked every morning." },
  { id: "pain-au-chocolat", category: "pastries", name: "Pain au Chocolat", price: 3.5, popularity: 8, desc: "Two bars of dark chocolate in buttery layers." },
  { id: "cinnamon-roll", category: "pastries", name: "Cinnamon Roll", price: 3.75, popularity: 7, desc: "Soft and gooey, with cream cheese frosting." },
  { id: "almond-tart", category: "pastries", name: "Almond Tart", price: 4.25, popularity: 4, desc: "Crisp pastry, frangipane and toasted almonds." },
];

const defaultSpecial = "vanilla-cloud";

const menuById = Object.fromEntries(defaultMenu.map((item) => [item.id, item]));
const drinks = defaultMenu.filter((item) => item.category !== "pastries");
const pastries = defaultMenu.filter((item) => item.category === "pastries");

/* ---------- Orders ---------- */

// Roughly how many orders come in during each hour (24h clock)
const ordersPerHour = {
  weekday: { 7: 18, 8: 30, 9: 24, 10: 15, 11: 13, 12: 19, 13: 17, 14: 11, 15: 14, 16: 13, 17: 9, 18: 7, 19: 6, 20: 4 },
  saturday: { 8: 14, 9: 24, 10: 30, 11: 28, 12: 25, 13: 22, 14: 18, 15: 17, 16: 14, 17: 10, 18: 8, 19: 7, 20: 5 },
  sunday: { 9: 16, 10: 26, 11: 28, 12: 24, 13: 20, 14: 17, 15: 15, 16: 12, 17: 8, 18: 6 },
};

// Mondays are quiet, Fridays are busy. Sunday first.
const weekdayFactor = [1, 0.9, 0.95, 1, 1.02, 1.1, 1];

// The name the barista calls out when the order's ready
const customerNames = [
  "Alex", "Noor", "Leo", "Hana", "Omar", "Ruth", "Theo", "Iris", "Ben", "Zara",
  "Kai", "Lena", "Felix", "Amira", "Jude", "Nina", "Owen", "Sara", "Yusuf", "Elif",
  "Tom", "Ava", "Rami", "Clara", "Max", "Lila", "Dan", "Mei", "Hugo", "Ines",
  "Hannah", "Marcus", "Sofia", "Daniel", "Grace", "Tariq", "Rosa", "Finn", "Layla", "Joe",
];

// A small seeded random number generator (mulberry32)
function seededRandom(seed) {
  let state = seed >>> 0;
  return function () {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(list, random) {
  const total = list.reduce((sum, item) => sum + item.popularity, 0);
  let roll = random() * total;
  for (const item of list) {
    roll -= item.popularity;
    if (roll < 0) return item;
  }
  return list[list.length - 1];
}

const dayCache = new Map();

// Every order for one day. Times are minutes after midnight.
function getDay(date) {
  const key = dateKey(date);
  if (dayCache.has(key)) return dayCache.get(key);

  const random = seededRandom(Number(key.replaceAll("-", "")));
  const weekday = date.getDay();
  const [opens, closes] = openingHours[weekday];
  const profile =
    weekday === 0 ? ordersPerHour.sunday : weekday === 6 ? ordersPerHour.saturday : ordersPerHour.weekday;

  // Some days are just busier (rain, a market in the square), and the café
  // slowly gets busier as more people find it
  const growth = 1 + (date - new Date(2026, 0, 1)) / (1000 * 60 * 60 * 24 * 3650);
  const mood = weekdayFactor[weekday] * (0.88 + random() * 0.24) * growth;

  const times = [];
  for (const [hour, usual] of Object.entries(profile)) {
    const count = Math.round(usual * mood * (0.85 + random() * 0.3));
    for (let i = 0; i < count; i++) times.push(Number(hour) * 60 + random() * 60);
  }
  times.sort((a, b) => a - b);

  const orders = times.map((time, index) => {
    const lines = new Map();
    const add = (item) => lines.set(item.id, (lines.get(item.id) || 0) + 1);

    if (random() < 0.08) {
      add(pickWeighted(pastries, random)); // just a pastry
    } else {
      add(pickWeighted(drinks, random));
      if (random() < 0.2) add(pickWeighted(drinks, random));
      if (random() < 0.45) add(pickWeighted(pastries, random));
      if (random() < 0.08) add(pickWeighted(pastries, random));
    }

    const items = [...lines].map(([id, qty]) => ({ id, qty }));
    return {
      id: `${key}-${index + 1}`,
      number: index + 1,
      time,
      items,
      total: items.reduce((sum, line) => sum + menuById[line.id].price * line.qty, 0),
      name: customerNames[Math.floor(random() * customerNames.length)],
      stay: random() < 0.56,
      payment: random() < 0.86 ? "Card" : "Cash",
    };
  });

  const day = { key, date: startOfDay(date), opens, closes, orders };
  dayCache.set(key, day);
  return day;
}

// Totals for a list of orders: sales, items sold, categories and hours
function summarize(orders) {
  const summary = {
    sales: 0,
    orders: orders.length,
    items: {},
    categories: { coffee: 0, cold: 0, pastries: 0 },
    hours: {},
    stayed: 0,
    card: 0,
    withPastry: 0,
  };

  for (const order of orders) {
    summary.sales += order.total;
    if (order.stay) summary.stayed += 1;
    if (order.payment === "Card") summary.card += 1;
    if (order.items.some((line) => menuById[line.id].category === "pastries")) summary.withPastry += 1;

    const hour = Math.floor(order.time / 60);
    summary.hours[hour] ??= { sales: 0, orders: 0 };
    summary.hours[hour].sales += order.total;
    summary.hours[hour].orders += 1;

    for (const line of order.items) {
      const item = menuById[line.id];
      const lineTotal = item.price * line.qty;
      summary.items[line.id] ??= { qty: 0, sales: 0 };
      summary.items[line.id].qty += line.qty;
      summary.items[line.id].sales += lineTotal;
      summary.categories[item.category] += lineTotal;
    }
  }

  return summary;
}

const summaryCache = new Map();

// Totals for a whole day (used for past days, which don't change)
function getSummary(date) {
  const key = dateKey(date);
  if (!summaryCache.has(key)) summaryCache.set(key, summarize(getDay(date).orders));
  return summaryCache.get(key);
}

/* ---------- Stock ---------- */

// days: the weekdays each supplier delivers on, Sunday = 0
const suppliers = {
  beans: { name: "Origin Green Coffee", days: [2] },
  dairy: { name: "Hill Farm Dairy", days: [1, 3, 5] },
  plant: { name: "Greenway Wholesale", days: [2, 4] },
  bakery: { name: "Old Town Wholesale", days: [1, 4] },
  packaging: { name: "PackRight", days: [3] },
};

// level and full are in the item's unit; perDay is how much a normal day uses
const stockGroups = [
  {
    name: "Coffee beans",
    note: "Green beans, roasted here every Monday.",
    items: [
      { id: "beans-ethiopia", name: "Ethiopia, Yirgacheffe", supplier: "beans", unit: "kg", level: 9.5, full: 20, perDay: 1.1 },
      { id: "beans-colombia", name: "Colombia, Huila", supplier: "beans", unit: "kg", level: 2.6, full: 20, perDay: 1.3 },
      { id: "beans-guatemala", name: "Guatemala, Antigua", supplier: "beans", unit: "kg", level: 6.8, full: 20, perDay: 0.9 },
    ],
  },
  {
    name: "Milk",
    note: "Oat, almond and soy cost the customer nothing extra.",
    items: [
      { id: "milk-whole", name: "Whole milk", supplier: "dairy", unit: "litres", level: 61, full: 80, perDay: 14 },
      { id: "milk-oat", name: "Oat milk", supplier: "plant", unit: "cartons", level: 7, full: 36, perDay: 5 },
      { id: "milk-almond", name: "Almond milk", supplier: "plant", unit: "cartons", level: 9, full: 12, perDay: 1.2 },
      { id: "milk-soy", name: "Soy milk", supplier: "plant", unit: "cartons", level: 5, full: 12, perDay: 0.8 },
    ],
  },
  {
    name: "Baking",
    note: "Priya bakes from 5am, so pastries are out of the oven by opening.",
    items: [
      { id: "flour", name: "Bread flour", supplier: "bakery", unit: "kg", level: 22, full: 50, perDay: 3.5 },
      { id: "butter", name: "Butter", supplier: "dairy", unit: "kg", level: 9, full: 24, perDay: 2.6 },
      { id: "chocolate", name: "Dark chocolate batons", supplier: "bakery", unit: "batons", level: 340, full: 600, perDay: 30 },
      { id: "almonds", name: "Flaked almonds", supplier: "bakery", unit: "kg", level: 3.1, full: 5, perDay: 0.3 },
    ],
  },
  {
    name: "Cups and takeaway",
    note: "Everything here is compostable.",
    items: [
      { id: "cups-8", name: "8oz cups", supplier: "packaging", unit: "cups", level: 640, full: 1500, perDay: 70 },
      { id: "cups-12", name: "12oz cups", supplier: "packaging", unit: "cups", level: 180, full: 1500, perDay: 85 },
      { id: "lids", name: "Lids", supplier: "packaging", unit: "lids", level: 1240, full: 3000, perDay: 150 },
      { id: "bags", name: "Paper bags", supplier: "packaging", unit: "bags", level: 400, full: 1000, perDay: 45 },
    ],
  },
];

/* ---------- The team and this week's rota ---------- */

// One entry per day, Monday first: [start, end] in hours, or null for a day off
const team = [
  { name: "Logan", role: "Owner", shifts: [[6.5, 14.5], [6.5, 14.5], null, [6.5, 14.5], [6.5, 14.5], null, [8.5, 15]] },
  { name: "Priya", role: "Baker", shifts: [[5, 12], [5, 12], null, [5, 12], [5, 12], [5.5, 12], [6.5, 12]] },
  { name: "Maya", role: "Head barista", shifts: [[13, 21.5], [13, 21.5], [13, 21.5], [13, 21.5], null, null, [13, 19.5]] },
  { name: "Sam", role: "Barista", shifts: [[6.5, 14.5], null, [6.5, 14.5], [6.5, 14.5], [13, 21.5], [13, 21.5], null] },
  { name: "Elena", role: "Front of house", shifts: [[13, 21.5], [6.5, 14.5], [6.5, 14.5], null, [6.5, 14.5], [13, 21.5], null] },
  { name: "Jonah", role: "Barista", shifts: [null, [13, 21.5], [13, 21.5], [13, 21.5], [13, 21.5], [7.5, 15], null] },
  { name: "Ruby", role: "Weekend barista", shifts: [null, null, null, null, null, [7.5, 15], [8.5, 15]] },
];

/* ---------- Reviews ---------- */

// daysAgo is counted from today, so the list always looks recent
const reviewCounts = { 5: 181, 4: 23, 3: 6, 2: 3, 1: 1 };

const reviews = [
  {
    id: "hannah",
    name: "Hannah",
    daysAgo: 0,
    rating: 5,
    source: "Google",
    text: "Came in for a quick coffee and stayed two hours with my book. The cinnamon roll was still warm. Lovely, unhurried place.",
    reply: "",
  },
  {
    id: "marcus",
    name: "Marcus",
    daysAgo: 1,
    rating: 3,
    source: "Google",
    text: "Great coffee, but on Saturday morning there wasn't a free table and the queue went out the door. A few more seats would help.",
    reply: "",
  },
  {
    id: "alex",
    name: "Alex",
    daysAgo: 3,
    rating: 5,
    source: "Google",
    text: "Best espresso I've had outside of Italy, and nobody minds if you stay all afternoon.",
    reply: "Thank you, Alex! Your table by the window is always waiting.",
  },
  {
    id: "daniel",
    name: "Daniel",
    daysAgo: 4,
    rating: 2,
    source: "Google",
    text: "Waited nearly 15 minutes for a flat white at 8am on a weekday. It tasted great, but I missed my train.",
    reply: "",
  },
  {
    id: "sofia",
    name: "Sofia",
    daysAgo: 6,
    rating: 5,
    source: "Comment card",
    text: "Thank you for not charging extra for oat milk! Small thing, big difference.",
    reply: "It's how it should be. Thanks for noticing, Sofia.",
  },
  {
    id: "tom",
    name: "Tom",
    daysAgo: 8,
    rating: 4,
    source: "Google",
    text: "Lovely flat white and the almond tart is excellent. The wifi was slow when it got busy, though.",
    reply: "Thanks Tom, we've just upgraded it. Let us know if it's better!",
  },
  {
    id: "mei",
    name: "Mei",
    daysAgo: 11,
    rating: 5,
    source: "Google",
    text: "The staff remembered my order on my second visit. That's when I knew this would be my café.",
    reply: "That'll be Maya. See you soon, Mei!",
  },
  {
    id: "owen",
    name: "Owen",
    daysAgo: 13,
    rating: 5,
    source: "Comment card",
    text: "Best iced matcha latte in town. Please never take it off the menu.",
    reply: "Promise. It's staying.",
  },
];
