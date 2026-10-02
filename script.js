/* Logan'sCafe dashboard: script.js
   Plain JavaScript, no libraries. Builds each view from the demo data in
   data.js, keeps the live parts moving (the clock and the order queue) and
   remembers Logan's changes in this browser. */

/* ---------- Small helpers ---------- */

const $ = (selector, root = document) => root.querySelector(selector);

function setText(selector, text) {
  const element = $(selector);
  if (element) element.textContent = text;
}

const escapeHTML = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]
  );

/* ---------- Formatting ---------- */

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const money = (value) =>
  "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wholeMoney = (value) => "$" + Math.round(value).toLocaleString("en-US");
const count = (value) => Math.round(value).toLocaleString("en-US");
const amount = (value) => value.toLocaleString("en-US", { maximumFractionDigits: 1 });
const plural = (n, word, many = `${word}s`) => `${count(n)} ${n === 1 ? word : many}`;

function hourLabel(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

// 8 -> "8–9am", 11 -> "11am–12pm"
function hourRange(hour) {
  const [from, to] = [hourLabel(hour), hourLabel(hour + 1)];
  return from.slice(-2) === to.slice(-2) ? `${from.slice(0, -2)}–${to}` : `${from}–${to}`;
}

// Minutes after midnight -> "8:05am"
function timeLabel(minutes) {
  const mins = String(Math.floor(minutes % 60)).padStart(2, "0");
  return hourLabel(Math.floor(minutes / 60)).replace(/(am|pm)$/, `:${mins}$1`);
}

// 6.5 -> "6:30am", 14 -> "2pm"
const shiftTime = (hours) => (hours % 1 ? timeLabel(hours * 60) : hourLabel(hours));
const shiftLabel = ([start, end]) => `${shiftTime(start)} – ${shiftTime(end)}`;

const longDate = (date) => `${weekdays[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
const shortDate = (date) => `${date.getDate()} ${months[date.getMonth()].slice(0, 3)}`;
const dayAndDate = (date) => `${weekdays[date.getDay()].slice(0, 3)} ${date.getDate()}`;
const minutesNow = (date = new Date()) => date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;

function daysAgoText(days) {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

// ["Mondays", "Wednesdays", "Fridays"] -> "Mondays, Wednesdays and Fridays"
function listText(words) {
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : words[0];
}

function stars(rating) {
  return `<span class="stars" role="img" aria-label="${rating} out of 5 stars"><span>${"★".repeat(rating)}</span>${"★".repeat(5 - rating)}</span>`;
}

const legendHTML = (entries) =>
  entries
    .map(
      ([name, key]) =>
        `<span class="legend-item"><span class="legend-swatch" style="--key: var(--chart-${key})"></span>${escapeHTML(name)}</span>`
    )
    .join("");

/* ---------- Logan's changes, kept in this browser ---------- */

const storageKey = "logans-cafe-dashboard";
const saved = { menu: {}, special: defaultSpecial, orders: {}, ordered: {}, replies: {} };

try {
  Object.assign(saved, JSON.parse(localStorage.getItem(storageKey)) || {});
} catch {
  // A private window or blocked storage: start fresh, everything still works
}

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(saved));
  } catch {
    // The change still applies until the page is closed
  }
}

// Order updates and stock orders only matter on the day they were made
const todayKey = dateKey(new Date());
for (const id of Object.keys(saved.orders)) if (!id.startsWith(todayKey)) delete saved.orders[id];
for (const [id, day] of Object.entries(saved.ordered)) if (day !== todayKey) delete saved.ordered[id];
if (!menuById[saved.special]) saved.special = defaultSpecial;

/* ---------- The menu, with Logan's edits ---------- */

function menuItem(id) {
  const item = menuById[id];
  const edits = saved.menu[id] || {};
  return { ...item, price: edits.price ?? item.price, available: edits.available ?? true };
}

function setMenuEdit(id, changes) {
  const edit = { ...saved.menu[id], ...changes };
  for (const key of Object.keys(edit)) if (edit[key] === undefined) delete edit[key];
  if (Object.keys(edit).length) saved.menu[id] = edit;
  else delete saved.menu[id];
  save();
}

function itemsText(items) {
  return items.map((line) => menuById[line.id].name + (line.qty > 1 ? ` ×${line.qty}` : "")).join(", ");
}

/* ---------- Which day the dashboard is showing ----------
   Before opening it shows yesterday in full. After that it shows today, up to now. */

function businessDay(now = new Date()) {
  const minutes = minutesNow(now);
  const [opens, closes] = openingHours[now.getDay()];

  if (minutes < opens * 60) {
    return { date: addDays(now, -1), cutoff: 24 * 60, minutes: 24 * 60, phase: "before", opens, closes };
  }
  const phase = minutes < closes * 60 ? "open" : "closed";
  return { date: startOfDay(now), cutoff: minutes, minutes, phase, opens, closes };
}

function ordersSoFar() {
  const day = businessDay();
  return { day, orders: getDay(day.date).orders.filter((order) => order.time <= day.cutoff) };
}

/* ---------- Order status ----------
   Orders move along on their own as the minutes pass (new, making, ready,
   collected), and Logan can push one along sooner with its button. */

const statuses = ["new", "making", "ready", "collected"];
const statusNames = { new: "New", making: "Making", ready: "Ready", collected: "Collected" };
const nextStep = { new: "Start", making: "Ready", ready: "Collected" };

function orderStatus(order, minutes) {
  const age = minutes - order.time;
  let step = age < 2 ? 0 : age < 6 ? 1 : age < 9 ? 2 : 3;
  if (saved.orders[order.id] != null) step = Math.max(step, saved.orders[order.id]);
  return statuses[step];
}

function ordersInProgress() {
  const { day, orders } = ordersSoFar();
  return orders.filter((order) => orderStatus(order, day.minutes) !== "collected");
}

function advanceOrder(id) {
  const day = businessDay();
  const order = getDay(day.date).orders.find((o) => o.id === id);
  if (!order) return;

  const list = document.activeElement?.closest("[data-queue], [data-orders-rows]");
  saved.orders[id] = Math.min(3, statuses.indexOf(orderStatus(order, day.minutes)) + 1);
  save();
  refreshLive();

  // Keep keyboard focus in the same place
  const same = $(`[data-view]:not([hidden]) [data-advance="${id}"]`);
  const next = list && $("[data-advance]", list);
  (same || next)?.focus();
}

/* ---------- Stock ---------- */

const allStock = stockGroups.flatMap((group) => group.items);
const stockLabels = { ok: "Plenty", low: "Running low", critical: "Order today", ordered: "Ordered" };

const statusIcons = {
  ok: '<path d="M3.5 8.5l3 3 6-7" />',
  low: '<path d="M8 2.5l6 11H2z" /><path d="M8 7v2.8M8 11.6v.1" />',
  critical: '<circle cx="8" cy="8" r="6" /><path d="M8 5v3.6M8 10.9v.1" />',
  ordered: '<path d="M2 5.2l6-3 6 3v5.6l-6 3-6-3z" /><path d="M2 5.2l6 3 6-3M8 8.2v5.6" />',
};

const statusIcon = (level) => `<svg viewBox="0 0 16 16" aria-hidden="true">${statusIcons[level]}</svg>`;

function stockState(item) {
  const daysLeft = item.level / item.perDay;
  if (saved.ordered[item.id]) return { daysLeft, level: "ordered" };
  return { daysLeft, level: daysLeft < 2 ? "critical" : daysLeft < 4 ? "low" : "ok" };
}

function toOrder() {
  return allStock
    .filter((item) => ["critical", "low"].includes(stockState(item).level))
    .sort((a, b) => a.level / a.perDay - b.level / b.perDay);
}

function nextDelivery(supplierId) {
  const today = new Date();
  for (let i = 1; i <= 7; i++) {
    const date = addDays(today, i);
    if (suppliers[supplierId].days.includes(date.getDay())) return date;
  }
}

const daysLeftText = (daysLeft) => `about ${plural(Math.max(1, Math.round(daysLeft)), "day")} left`;

/* ---------- Reviews ---------- */

const replyFor = (review) => (review.id in saved.replies ? saved.replies[review.id] : review.reply);
const needsReply = () => reviews.filter((review) => !replyFor(review));

/* ---------- Toast (a short note after each change) ---------- */

const toast = $("[data-toast]");
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

/* ---------- Sidebar: mobile menu and the sliding marker ---------- */

const sidebar = $(".sidebar");
const menuToggle = $(".menu-toggle");
const sidebarPanel = $("#sidebar-panel");
const navMarker = $(".nav-marker");

function setMenu(open) {
  menuToggle.setAttribute("aria-expanded", String(open));
  sidebar.classList.toggle("menu-is-open", open);
  document.body.classList.toggle("menu-open", open);
}

menuToggle.addEventListener("click", () => {
  setMenu(menuToggle.getAttribute("aria-expanded") !== "true");
});

sidebarPanel.addEventListener("click", (event) => {
  if (event.target.closest("a")) setMenu(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && sidebar.classList.contains("menu-is-open")) {
    setMenu(false);
    menuToggle.focus();
  }
});

window.matchMedia("(min-width: 1000px)").addEventListener("change", (event) => {
  if (event.matches) setMenu(false);
  moveNavMarker();
});

// The soft highlight glides to whichever page is open
function moveNavMarker() {
  const active = $('.side-nav a[aria-current="page"]');
  if (!active) return;
  navMarker.style.translate = `0 ${active.offsetTop}px`;
  navMarker.style.height = `${active.offsetHeight}px`;
}

window.addEventListener("resize", moveNavMarker);
document.fonts?.ready.then(moveNavMarker);

/* ---------- Top bar: date, time and whether the café is open ---------- */

function openStatus(now = new Date()) {
  const day = now.getDay();
  const time = now.getHours() + now.getMinutes() / 60;
  const [opens, closes] = openingHours[day];

  if (time >= opens && time < closes) {
    return { open: true, text: `Open now · until ${hourLabel(closes)}` };
  }
  if (time < opens) {
    return { open: false, text: `Closed now · opens at ${hourLabel(opens)}` };
  }
  const tomorrow = openingHours[(day + 1) % 7];
  return { open: false, text: `Closed now · opens tomorrow at ${hourLabel(tomorrow[0])}` };
}

function updateTopbar() {
  const now = new Date();
  setText("[data-date]", longDate(now));
  setText("[data-clock]", timeLabel(minutesNow(now)));

  const status = openStatus(now);
  const element = $("[data-open-status]");
  element.textContent = status.text;
  element.classList.toggle("is-open", status.open);
  element.classList.toggle("is-closed", !status.open);
}

function updateSpecial() {
  const item = menuItem(saved.special);
  setText("[data-special-name]", item.name);
  setText("[data-special-price]", money(item.price));
  $("[data-special-photo]").src = categories.find((category) => category.id === item.category).photo;
}

// The little numbers beside Orders, Stock and Reviews
function updateCounts() {
  const counts = {
    orders: [ordersInProgress().length, "in progress"],
    stock: [toOrder().length, "to order"],
    reviews: [needsReply().length, "waiting for a reply"],
  };

  for (const [name, [n, words]] of Object.entries(counts)) {
    const element = $(`[data-count="${name}"]`);
    element.hidden = n === 0;
    element.innerHTML = `${n}<span class="visually-hidden"> ${words}</span>`;
  }
}

/* ---------- Stat tiles ---------- */

// compare: { now, before, against } adds "↑ 8% on last Friday"
function statTile(label, value, compare, note) {
  let line = "";

  if (note) {
    line = `<p class="stat-note">${escapeHTML(note)}</p>`;
  } else if (compare && compare.before > 0) {
    const change = (compare.now - compare.before) / compare.before;
    const percent = Math.round(Math.abs(change) * 100);
    const up = change > 0;
    line =
      percent === 0
        ? `<p class="stat-delta">Level with ${compare.against}</p>`
        : `<p class="stat-delta ${up ? "is-up" : "is-down"}"><span aria-hidden="true">${up ? "↑" : "↓"}</span><span class="visually-hidden">${up ? "Up" : "Down"}</span> ${percent}% on ${compare.against}</p>`;
  }

  return `<div class="card stat"><p class="stat-label">${label}</p><p class="stat-value">${value}</p>${line}</div>`;
}

/* ---------- Today ---------- */

let hourlyKey = "";
let queueStarted = false;

function renderToday() {
  const now = new Date();
  const day = businessDay(now);
  const data = getDay(day.date);
  const orders = data.orders.filter((order) => order.time <= day.cutoff);
  const pastDate = addDays(day.date, -7);
  const pastName = weekdays[pastDate.getDay()];
  const against = day.phase === "before" ? `the ${pastName} before` : `last ${pastName}`;
  const sum = summarize(orders);
  const past = summarize(getDay(pastDate).orders.filter((order) => order.time <= day.cutoff));

  // Greeting
  const hour = now.getHours();
  const greeting = hour < 5 ? "Hello" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  setText("[data-greeting]", `${greeting}, Logan`);
  setText(
    "[data-today-intro]",
    {
      open: `Here's how ${weekdays[now.getDay()]} is going so far, next to ${against} at the same time.`,
      closed: `We closed at ${hourLabel(day.closes)}. Here's how today went, next to ${against}.`,
      before: `We open at ${hourLabel(day.opens)}. Here's how yesterday went, next to ${against}.`,
    }[day.phase]
  );

  // Headline numbers
  const average = sum.orders ? sum.sales / sum.orders : 0;
  const pastAverage = past.orders ? past.sales / past.orders : 0;
  const busiest = Object.entries(sum.hours).sort((a, b) => b[1].orders - a[1].orders)[0];
  const salesLabel = { open: "Sales so far", closed: "Sales today", before: "Sales yesterday" }[day.phase];

  $("[data-today-kpis]").innerHTML = [
    statTile(salesLabel, wholeMoney(sum.sales), { now: sum.sales, before: past.sales, against }),
    statTile("Orders", count(sum.orders), { now: sum.orders, before: past.orders, against }),
    statTile("Average order", sum.orders ? money(average) : "–", { now: average, before: pastAverage, against }),
    busiest
      ? statTile(
          "Busiest hour",
          hourRange(+busiest[0]),
          null,
          `${plural(busiest[1].orders, "order")}, ${wholeMoney(busiest[1].sales)}`
        )
      : statTile("Busiest hour", "–", null, "No orders yet"),
  ].join("");

  // Sales by hour: only redrawn when a new order has come in
  const thisName = day.phase === "before" ? "Yesterday" : "Today";
  const againstName = against[0].toUpperCase() + against.slice(1);
  setText(
    "[data-hourly-sub]",
    day.phase === "open" ? `Today so far, next to the whole of ${against}` : `${thisName}, next to ${against}`
  );

  const chartKey = `${data.key}:${orders.length}`;
  if (chartKey !== hourlyKey) {
    const hours = [];
    for (let h = data.opens; h < data.closes; h++) hours.push(h);
    const currentHour = day.phase === "open" ? Math.floor(day.minutes / 60) : 24;
    const pastFull = getSummary(pastDate);

    columnChart($("#hourly-chart"), {
      labels: hours.map(hourRange),
      ticks: hours.map(hourLabel),
      labelHeading: "Hour",
      series: [
        { name: againstName, key: "past", values: hours.map((h) => pastFull.hours[h]?.sales ?? 0) },
        {
          name: thisName,
          key: "coffee",
          values: hours.map((h) => (h <= currentHour ? (sum.hours[h]?.sales ?? 0) : null)),
        },
      ],
      format: money,
      tickFormat: wholeMoney,
      height: 280,
      description: `Sales in each hour ${thisName.toLowerCase()}, next to ${against}.`,
      animate: !hourlyKey,
    });
    $("[data-hourly-legend]").innerHTML = legendHTML([[thisName, "coffee"], [againstName, "past"]]);
    hourlyKey = chartKey;
  }

  renderQueue(day, orders);

  // Selling well
  const top = Object.entries(sum.items)
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, 5);
  setText("[data-top-sub]", `${thisName}, by number sold`);
  if (top.length) {
    barList(
      $("[data-top-items]"),
      top.map(([id, item]) => ({ id, label: menuById[id].name, value: item.qty })),
      (value) => `${count(value)} sold`
    );
  } else {
    $("[data-top-items]").innerHTML = '<li class="empty">Nothing sold yet.</li>';
  }

  // On shift today (always today's rota, even before opening)
  const dayIndex = (now.getDay() + 6) % 7; // Monday first
  const minutes = minutesNow(now);
  const onToday = team
    .filter((person) => person.shifts[dayIndex])
    .sort((a, b) => a.shifts[dayIndex][0] - b.shifts[dayIndex][0]);
  let working = 0;

  $("[data-shifts]").innerHTML = onToday
    .map((person) => {
      const [start, end] = person.shifts[dayIndex];
      let state = `Starts at ${shiftTime(start)}`;
      let className = "";
      if (minutes >= end * 60) {
        state = "Finished";
        className = "is-done";
      } else if (minutes >= start * 60) {
        state = "Working now";
        className = "is-on";
        working++;
      }
      return `<li class="${className}">
        <div><p class="list-title">${person.name}</p><p class="list-sub">${person.role}</p></div>
        <div class="list-side"><p>${shiftLabel(person.shifts[dayIndex])}</p><p class="shift-state">${state}</p></div>
      </li>`;
    })
    .join("");
  setText(
    "[data-shift-sub]",
    working ? `${plural(working, "person", "people")} working now` : `${plural(onToday.length, "person", "people")} on the rota`
  );

  // Running low
  const low = toOrder();
  setText("[data-low-sub]", low.length ? `${plural(low.length, "thing")} to order` : "Nothing to order");
  $("[data-low-stock]").innerHTML = low.length
    ? low
        .map((item) => {
          const state = stockState(item);
          return `<li>
            <div><p class="list-title">${item.name}</p><p class="list-sub">${daysLeftText(state.daysLeft)}</p></div>
            <p class="status-label status-${state.level}">${statusIcon(state.level)}${stockLabels[state.level]}</p>
          </li>`;
        })
        .join("")
    : '<li class="empty">Everything will last at least four more days.</li>';

  // The newest review, shown like a quote on the café's website
  const latest = reviews[0];
  $("[data-latest-review]").innerHTML = `
    <p class="card-kicker">Latest review</p>
    <blockquote><p>“${escapeHTML(latest.text)}”</p></blockquote>
    <figcaption>
      ${stars(latest.rating)}
      <span>${latest.name}, on ${latest.source}, ${daysAgoText(latest.daysAgo)}</span>
      <a class="text-btn" href="#reviews">${replyFor(latest) ? "See your reply" : "Reply"}</a>
    </figcaption>`;
}

function renderQueue(day, orders) {
  const list = $("[data-queue]");
  const active = orders.filter((order) => orderStatus(order, day.minutes) !== "collected");
  const seen = new Set([...list.children].map((li) => li.dataset.id));
  const focusedId = document.activeElement?.dataset?.advance;

  list.innerHTML = active
    .map((order) => {
      const status = orderStatus(order, day.minutes);
      const waited = Math.floor(day.minutes - order.time);
      const arriving = queueStarted && !seen.has(order.id) ? " is-arriving" : "";
      return `<li class="queue-item status-${status}${arriving}" data-id="${order.id}">
        <div class="queue-main">
          <p class="queue-title"><strong>#${order.number}</strong> for ${escapeHTML(order.name)}<span> · ${order.stay ? "Eat in" : "Takeaway"}</span></p>
          <p class="queue-items">${escapeHTML(itemsText(order.items))}</p>
        </div>
        <div class="queue-side">
          <p class="queue-status"><span class="status-word">${statusNames[status]}</span> · ${waited >= 1 ? `${waited} min` : "just now"}</p>
          <button class="btn-small" type="button" data-advance="${order.id}">${nextStep[status]}<span class="visually-hidden">, order ${order.number}</span></button>
        </div>
      </li>`;
    })
    .join("");
  queueStarted = true;

  if (focusedId) $(`[data-advance="${focusedId}"]`, list)?.focus();

  const longest = active.length ? Math.floor(day.minutes - active[0].time) : 0;
  setText(
    "[data-queue-sub]",
    active.length
      ? `${plural(active.length, "order")} in progress${longest >= 1 ? `, longest wait ${longest} min` : ""}`
      : "Nothing waiting"
  );

  const empty = $("[data-queue-empty]");
  empty.hidden = active.length > 0;
  empty.textContent = {
    open: "All caught up. New orders show up here as they come in.",
    closed: "Closed for the night, and every order's been collected.",
    before: `We open at ${hourLabel(day.opens)}. New orders show up here as they come in.`,
  }[day.phase];
}

/* ---------- Orders ---------- */

let ordersFilter = "all";
let ordersQuery = "";
let ordersLimit = 40;

function renderOrders() {
  const { day, orders } = ordersSoFar();
  const sum = summarize(orders);
  const isYesterday = day.phase === "before";

  setText(
    "[data-orders-intro]",
    isYesterday
      ? `Nothing yet today, as we open at ${hourLabel(day.opens)}. These are yesterday's orders.`
      : "Everything that's come through the till today, newest first."
  );
  setText("[data-orders-heading]", isYesterday ? "Yesterday's orders" : "Today's orders");

  const stayed = orders.filter((order) => order.stay).length;
  setText(
    "[data-orders-summary]",
    orders.length
      ? `${plural(orders.length, "order")}, ${wholeMoney(sum.sales)} in sales. ${Math.round((stayed / orders.length) * 100)}% stayed to eat in.`
      : "No orders yet."
  );

  const query = ordersQuery.trim().toLowerCase().replace(/^#/, "");
  const rows = orders
    .slice()
    .reverse()
    .map((order) => ({ order, status: orderStatus(order, day.minutes) }))
    .filter(({ status }) => ordersFilter === "all" || (ordersFilter === "waiting") === (status !== "collected"))
    .filter(
      ({ order }) =>
        !query ||
        String(order.number) === query ||
        order.name.toLowerCase().includes(query) ||
        itemsText(order.items).toLowerCase().includes(query)
    );

  $("[data-orders-rows]").innerHTML = rows
    .slice(0, ordersLimit)
    .map(
      ({ order, status }) => `<tr class="status-${status}">
        <td class="nowrap">${timeLabel(order.time)}</td>
        <td class="nowrap"><strong>#${order.number}</strong> ${escapeHTML(order.name)}</td>
        <td>${escapeHTML(itemsText(order.items))}</td>
        <td>${order.stay ? "Eat in" : "Takeaway"}</td>
        <td>${order.payment}</td>
        <td class="num">${money(order.total)}</td>
        <td class="status-cell"><span class="status-word">${statusNames[status]}</span>${
          status === "collected"
            ? ""
            : `<button class="btn-small" type="button" data-advance="${order.id}">${nextStep[status]}<span class="visually-hidden">, order ${order.number}</span></button>`
        }</td>
      </tr>`
    )
    .join("");

  $("[data-orders-empty]").hidden = rows.length > 0;
  $("[data-orders-more]").hidden = rows.length <= ordersLimit;
}

document.querySelectorAll("[data-orders-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    ordersFilter = button.dataset.ordersFilter;
    ordersLimit = 40;
    document
      .querySelectorAll("[data-orders-filter]")
      .forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
    renderOrders();
  });
});

$("[data-orders-search]").addEventListener("input", (event) => {
  ordersQuery = event.target.value;
  ordersLimit = 40;
  renderOrders();
});

$("[data-orders-more]").addEventListener("click", () => {
  ordersLimit += 40;
  renderOrders();
});

/* ---------- Sales ---------- */

let salesRange = 30;
let salesKey = "";

function renderSales() {
  const end = addDays(new Date(), -1); // yesterday, the last full day
  const key = `${dateKey(end)}:${salesRange}`;
  if (key === salesKey) return; // nothing has changed since last time
  salesKey = key;

  const dates = Array.from({ length: salesRange }, (_, i) => addDays(end, i - salesRange + 1));
  const days = dates.map(getSummary);
  const before = dates.map((date) => getSummary(addDays(date, -salesRange)));
  const total = (list, field) => list.reduce((sum, day) => sum + day[field], 0);

  const sales = total(days, "sales");
  const orders = total(days, "orders");
  const pastSales = total(before, "sales");
  const pastOrders = total(before, "orders");
  const against = `the ${salesRange} days before`;
  const best = days.reduce((bestIndex, day, i) => (day.sales > days[bestIndex].sales ? i : bestIndex), 0);

  setText("[data-sales-dates]", `${longDate(dates[0])} to ${longDate(end)}`);
  $("[data-sales-kpis]").innerHTML = [
    statTile("Sales", wholeMoney(sales), { now: sales, before: pastSales, against }),
    statTile("Orders", count(orders), { now: orders, before: pastOrders, against }),
    statTile("Average order", money(sales / orders), { now: sales / orders, before: pastSales / pastOrders, against }),
    statTile("Best day", wholeMoney(days[best].sales), null, longDate(dates[best])),
  ].join("");

  // Sales each day, with labels a week (or two) apart
  const tickEvery = { 7: 1, 30: 7, 90: 14 }[salesRange];
  columnChart($("#daily-chart"), {
    labels: dates.map(longDate),
    ticks: dates.map((date, i) =>
      (dates.length - 1 - i) % tickEvery ? "" : salesRange === 7 ? dayAndDate(date) : shortDate(date)
    ),
    labelHeading: "Day",
    series: [{ name: "Sales", key: "coffee", values: days.map((day) => day.sales) }],
    format: wholeMoney,
    details: (i) => [{ value: plural(days[i].orders, "order") }],
    labelMax: true,
    description: `Sales on each of the last ${salesRange} days.`,
    animate: true,
  });

  // Where the money comes from
  const byCategory = { coffee: 0, cold: 0, pastries: 0 };
  days.forEach((day) => {
    for (const id in day.categories) byCategory[id] += day.categories[id];
  });
  stackedBar(
    $("[data-sales-split]"),
    categories.map((category) => ({ key: category.id, name: category.name, value: byCategory[category.id] })),
    wholeMoney
  );

  // How people order
  const habits = [
    ["Stayed to eat in", total(days, "stayed")],
    ["Paid by card", total(days, "card")],
    ["Had a pastry with it", total(days, "withPastry")],
  ];
  $("[data-sales-habits]").innerHTML = habits
    .map(
      ([label, n]) => `<li>
        <div class="ratio-head"><p>${label}</p><p><strong>${Math.round((n / orders) * 100)}%</strong></p></div>
        <div class="meter" aria-hidden="true"><span style="--fill: ${(n / orders).toFixed(3)}"></span></div>
        <p class="list-sub">${count(n)} of ${plural(orders, "order")}</p>
      </li>`
    )
    .join("");

  // Best sellers
  const items = {};
  days.forEach((day) => {
    for (const [id, item] of Object.entries(day.items)) {
      items[id] ??= { qty: 0, sales: 0 };
      items[id].qty += item.qty;
      items[id].sales += item.sales;
    }
  });
  $("[data-best-rows]").innerHTML = Object.entries(items)
    .sort((a, b) => b[1].sales - a[1].sales)
    .map(([id, item]) => {
      const { name, category } = menuById[id];
      return `<tr>
        <th scope="row"><span class="legend-swatch" style="--key: var(--chart-${category})"></span>${name}</th>
        <td class="num">${count(item.qty)}</td>
        <td class="num">${wholeMoney(item.sales)}</td>
      </tr>`;
    })
    .join("");

  // When it's busy: average orders for each weekday and hour
  const hours = [];
  for (let h = 7; h < 21; h++) hours.push(h);

  const rows = [1, 2, 3, 4, 5, 6, 0].map((weekday) => {
    const matching = days.filter((_, i) => dates[i].getDay() === weekday);
    const [opens, closes] = openingHours[weekday];
    return {
      label: weekdays[weekday].slice(0, 3),
      name: `${weekdays[weekday]}s`,
      values: hours.map((h) =>
        h < opens || h >= closes || !matching.length
          ? null
          : matching.reduce((sum, day) => sum + (day.hours[h]?.orders ?? 0), 0) / matching.length
      ),
    };
  });

  heatmap($("[data-heatmap]"), {
    rows,
    columns: hours.map((h) => ({ label: hourLabel(h), name: hourRange(h) })),
    caption: "Average orders in each hour, by day of the week",
    format: (value) => `${value < 10 ? amount(value) : count(value)} orders`,
  });
}

document.querySelectorAll("[data-sales-range]").forEach((button) => {
  button.addEventListener("click", () => {
    salesRange = Number(button.dataset.salesRange);
    document
      .querySelectorAll("[data-sales-range]")
      .forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
    renderSales();
  });
});

/* ---------- Menu ---------- */

function renderMenu() {
  const { day, orders } = ordersSoFar();
  const sold = summarize(orders).items;
  const when = day.phase === "before" ? "yesterday" : "today";

  $("[data-menu]").innerHTML = categories
    .map(
      (category) => `<section class="card menu-card" aria-labelledby="menu-${category.id}">
        <img class="menu-photo" src="${category.photo}" alt="" width="700" height="400" />
        <div class="menu-card-body">
          <h2 id="menu-${category.id}">${category.name}</h2>
          <ul class="menu-items">
            ${defaultMenu
              .filter((item) => item.category === category.id)
              .map((base) => {
                const item = menuItem(base.id);
                const qty = sold[item.id]?.qty ?? 0;
                const classes = [item.id === saved.special && "is-special", !item.available && "is-sold-out"];
                return `<li class="menu-item ${classes.filter(Boolean).join(" ")}" data-item="${item.id}">
                  <div class="menu-item-text">
                    <p class="menu-item-name">${item.name}</p>
                    <p class="menu-item-desc"><strong class="special-note">Today's special. </strong>${item.desc}</p>
                    <p class="menu-item-sold">${qty ? `${count(qty)} sold ${when}` : `None sold ${when}`}</p>
                  </div>
                  <div class="menu-item-controls">
                    <label class="price-field">
                      <span aria-hidden="true">$</span>
                      <input class="field" type="number" inputmode="decimal" min="0.5" max="20" step="0.05"
                        value="${item.price.toFixed(2)}" data-price="${item.id}" aria-label="Price of ${item.name}, in dollars" />
                    </label>
                    <label class="switch">
                      <input type="checkbox" role="switch" data-available="${item.id}" ${item.available ? "checked" : ""}
                        aria-label="${item.name} on the menu" />
                      <span class="switch-track" aria-hidden="true"></span>
                      <span class="switch-on" aria-hidden="true">On the menu</span>
                      <span class="switch-off" aria-hidden="true">Sold out</span>
                    </label>
                    <label class="special-pick">
                      <input type="radio" name="special" value="${item.id}" ${item.id === saved.special ? "checked" : ""}
                        aria-label="Make ${item.name} today's special" />
                      <span aria-hidden="true">Special</span>
                    </label>
                  </div>
                </li>`;
              })
              .join("")}
          </ul>
        </div>
      </section>`
    )
    .join("");
}

const menuRow = (id) => $(`[data-item="${id}"]`);

document.addEventListener("change", (event) => {
  const input = event.target;

  if (input.matches("[data-price]")) {
    const id = input.dataset.price;
    const price = Math.round(parseFloat(input.value) * 100) / 100;
    if (!(price >= 0.5 && price <= 20)) {
      input.value = menuItem(id).price.toFixed(2);
      showToast("Prices need to be between $0.50 and $20.");
      return;
    }
    input.value = price.toFixed(2);
    setMenuEdit(id, { price: price === menuById[id].price ? undefined : price });
    updateSpecial();
    showToast(`${menuById[id].name} is now ${money(price)}.`);
  }

  if (input.matches("[data-available]")) {
    const id = input.dataset.available;
    setMenuEdit(id, { available: input.checked ? undefined : false });
    menuRow(id).classList.toggle("is-sold-out", !input.checked);
    showToast(input.checked ? `${menuById[id].name} is back on the menu.` : `${menuById[id].name} is marked as sold out.`);
  }

  if (input.name === "special") {
    saved.special = input.value;
    save();
    document.querySelectorAll(".menu-item").forEach((row) => {
      row.classList.toggle("is-special", row.dataset.item === input.value);
    });
    updateSpecial();
    showToast(`Today's special is now the ${menuById[input.value].name}.`);
  }
});

$("[data-menu-reset]").addEventListener("click", () => {
  saved.menu = {};
  saved.special = defaultSpecial;
  save();
  renderMenu();
  updateSpecial();
  showToast("Back to the usual menu and prices.");
});

/* ---------- Stock ---------- */

function renderStock() {
  const low = toOrder();
  setText(
    "[data-stock-intro]",
    low.length
      ? `${plural(low.length, "thing")} to order. Everything else will last at least four more days.`
      : "Nothing to order right now. Everything will last at least four more days."
  );

  $("[data-stock]").innerHTML = stockGroups
    .map(
      (group, index) => `<section class="card" aria-labelledby="stock-group-${index}">
        <div class="card-head">
          <div>
            <h2 id="stock-group-${index}">${group.name}</h2>
            <p class="card-sub">${group.note}</p>
          </div>
        </div>
        <ul class="stock-list">${group.items.map(stockRow).join("")}</ul>
      </section>`
    )
    .join("");
}

function stockRow(item) {
  const state = stockState(item);
  const supplier = suppliers[item.supplier];
  const fill = Math.min(1, item.level / item.full);
  let action = "";

  if (state.level === "ordered") {
    action = `<p class="stock-ordered">Arrives ${weekdays[nextDelivery(item.supplier).getDay()]}
      <button class="text-btn" type="button" data-unorder="${item.id}">Undo<span class="visually-hidden">, ${item.name}</span></button></p>`;
  } else if (state.level !== "ok") {
    action = `<button class="btn-small" type="button" data-order-stock="${item.id}">Mark as ordered<span class="visually-hidden">, ${item.name}</span></button>`;
  }

  return `<li class="stock-item is-${state.level}">
    <div class="stock-top">
      <p class="list-title">${item.name}</p>
      <p class="status-label status-${state.level}">${statusIcon(state.level)}${stockLabels[state.level]}</p>
    </div>
    <p class="list-sub stock-supplier">${supplier.name}, delivers ${listText(supplier.days.map((d) => `${weekdays[d]}s`))}</p>
    <div class="meter" aria-hidden="true"><span style="--fill: ${fill.toFixed(3)}"></span></div>
    <div class="stock-bottom">
      <p class="list-sub">${amount(item.level)} of ${amount(item.full)} ${item.unit}, ${daysLeftText(state.daysLeft)}</p>
      ${action}
    </div>
  </li>`;
}

/* ---------- Rota ---------- */

function renderRota() {
  const today = startOfDay(new Date());
  const todayIndex = (today.getDay() + 6) % 7; // Monday first
  const monday = addDays(today, -todayIndex);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const shiftHours = (shift) => (shift ? shift[1] - shift[0] : 0);
  const personHours = (person) => person.shifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
  const totalHours = team.reduce((sum, person) => sum + personHours(person), 0);
  const todayClass = (i) => (i === todayIndex ? "is-today" : "");

  setText("[data-rota-week]", `Week of ${longDate(monday)}`);
  setText("[data-rota-sub]", `${amount(totalHours)} hours across ${team.length} people. Today is highlighted.`);

  const head = `<thead><tr>
    <th scope="col">Name</th>
    ${days.map((date, i) => `<th scope="col" class="${todayClass(i)}">${dayAndDate(date)}${i === todayIndex ? '<span class="visually-hidden">, today</span>' : ""}</th>`).join("")}
    <th scope="col" class="num">Hours</th>
  </tr></thead>`;

  const body = team
    .map(
      (person) => `<tr>
        <th scope="row"><span class="list-title">${person.name}</span><span class="list-sub">${person.role}</span></th>
        ${person.shifts
          .map((shift, i) =>
            shift
              ? `<td class="${todayClass(i)}"><span class="shift">${shiftTime(shift[0])} –<br />${shiftTime(shift[1])}</span></td>`
              : `<td class="is-off ${todayClass(i)}">Off</td>`
          )
          .join("")}
        <td class="num">${amount(personHours(person))}</td>
      </tr>`
    )
    .join("");

  const foot = `<tfoot><tr>
    <th scope="row">People in</th>
    ${days.map((_, i) => `<td class="${todayClass(i)}">${team.filter((person) => person.shifts[i]).length}</td>`).join("")}
    <td class="num">${amount(totalHours)}</td>
  </tr></tfoot>`;

  $("[data-rota]").innerHTML = head + `<tbody>${body}</tbody>` + foot;
}

/* ---------- Reviews ---------- */

let reviewsFilter = "all";
let editingReview = null;

function renderReviews() {
  const totalReviews = Object.values(reviewCounts).reduce((sum, n) => sum + n, 0);
  const average = Object.entries(reviewCounts).reduce((sum, [rating, n]) => sum + rating * n, 0) / totalReviews;

  setText("[data-rating-figure]", average.toFixed(1));
  setText("[data-rating-sub]", `out of 5, from ${count(totalReviews)} reviews`);
  barList(
    $("[data-rating-bars]"),
    [5, 4, 3, 2, 1].map((rating) => ({ id: String(rating), label: plural(rating, "star"), value: reviewCounts[rating] })),
    count
  );

  const waiting = needsReply().length;
  $('[data-reviews-filter="reply"]').textContent = waiting ? `Needs a reply (${waiting})` : "Needs a reply";

  const list = reviewsFilter === "reply" ? needsReply() : reviews;
  $("[data-reviews]").innerHTML = list.map(reviewHTML).join("");
  $("[data-reviews-empty]").hidden = list.length > 0;
}

function reviewHTML(review) {
  const reply = replyFor(review);
  let replyBlock;

  if (editingReview === review.id) {
    replyBlock = `<form class="reply-form" data-reply-form="${review.id}">
      <label class="visually-hidden" for="reply-${review.id}">Your reply to ${review.name}</label>
      <textarea class="field" id="reply-${review.id}" rows="3" maxlength="600" placeholder="Write back as Logan">${escapeHTML(reply)}</textarea>
      <div class="reply-actions">
        <button class="btn-small is-solid" type="submit">Post reply</button>
        <button class="text-btn" type="button" data-cancel-reply="${review.id}">Cancel</button>
      </div>
    </form>`;
  } else if (reply) {
    replyBlock = `<div class="reply">
      <p class="reply-label">Your reply</p>
      <p>${escapeHTML(reply)}</p>
      <button class="text-btn" type="button" data-edit-reply="${review.id}">Edit reply<span class="visually-hidden"> to ${review.name}</span></button>
    </div>`;
  } else {
    replyBlock = `<button class="btn-small" type="button" data-edit-reply="${review.id}">Reply to ${review.name}</button>`;
  }

  return `<li class="card review${reply ? "" : " needs-reply"}">
    <div class="review-head">
      ${stars(review.rating)}
      <p class="review-meta"><strong>${review.name}</strong> on ${review.source}, ${daysAgoText(review.daysAgo)}</p>
    </div>
    <p class="review-text">${escapeHTML(review.text)}</p>
    ${replyBlock}
  </li>`;
}

document.querySelectorAll("[data-reviews-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    reviewsFilter = button.dataset.reviewsFilter;
    document
      .querySelectorAll("[data-reviews-filter]")
      .forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
    renderReviews();
  });
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-reply-form]");
  if (!form) return;
  event.preventDefault();

  const id = form.dataset.replyForm;
  const text = $("textarea", form).value.trim();
  saved.replies[id] = text;
  save();
  editingReview = null;
  renderReviews();
  updateCounts();
  showToast(text ? "Reply posted. In the demo, it stays in this browser." : "Reply removed.");
  ($(`[data-edit-reply="${id}"]`) || $('[data-reviews-filter][aria-pressed="true"]'))?.focus();
});

/* ---------- Clicks shared by several views ---------- */

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;

  if (target.dataset.advance) advanceOrder(target.dataset.advance);

  // Swap a chart for a table of the same numbers, and back
  if (target.dataset.tableToggle) {
    const chart = document.getElementById(target.dataset.tableToggle);
    const showTable = $(".chart-table", chart).hidden;
    target.textContent = showTable ? "Show as chart" : "Show as table";
    $(".chart-plot", chart).hidden = showTable;
    $(".chart-table", chart).hidden = !showTable;
    hideTooltip();
  }

  if (target.dataset.orderStock) {
    const item = allStock.find((stockItem) => stockItem.id === target.dataset.orderStock);
    saved.ordered[item.id] = todayKey;
    save();
    renderStock();
    updateCounts();
    showToast(`${item.name} ordered from ${suppliers[item.supplier].name}.`);
    $(`[data-unorder="${item.id}"]`)?.focus();
  }

  if (target.dataset.unorder) {
    const id = target.dataset.unorder;
    delete saved.ordered[id];
    save();
    renderStock();
    updateCounts();
    $(`[data-order-stock="${id}"]`)?.focus();
  }

  if (target.dataset.editReply) {
    editingReview = target.dataset.editReply;
    renderReviews();
    const textarea = $(`#reply-${editingReview}`);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  if (target.dataset.cancelReply) {
    editingReview = null;
    renderReviews();
    $(`[data-edit-reply="${target.dataset.cancelReply}"]`)?.focus();
  }
});

/* ---------- Pages ---------- */

const views = {
  today: { title: "Today", render: renderToday },
  orders: { title: "Orders", render: renderOrders },
  sales: { title: "Sales", render: renderSales },
  menu: { title: "Menu", render: renderMenu },
  stock: { title: "Stock", render: renderStock },
  rota: { title: "Rota", render: renderRota },
  reviews: { title: "Reviews", render: renderReviews },
};

let currentView = null;

function showView(name) {
  const firstLoad = currentView === null;
  currentView = name;

  document.querySelectorAll("[data-view]").forEach((view) => {
    view.hidden = view.dataset.view !== name;
  });
  document.querySelectorAll("[data-view-link]").forEach((link) => {
    if (link.dataset.viewLink === name) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  document.title = `${views[name].title} | Logan'sCafe dashboard`;
  hideTooltip();
  views[name].render();
  moveNavMarker();

  if (!firstLoad) {
    window.scrollTo({ top: 0 });
    $(`[data-view="${name}"] h1`).focus({ preventScroll: true });
  }
}

window.addEventListener("hashchange", () => {
  const name = location.hash.slice(1);
  if (name in views) showView(name); // other links (like "Skip to content") are left alone
});

/* ---------- Keep the live parts moving ---------- */

function refreshLive() {
  updateTopbar();
  updateCounts();
  if (currentView === "today") renderToday();
  if (currentView === "orders") renderOrders();
}

updateTopbar();
updateSpecial();
updateCounts();
showView(location.hash.slice(1) in views ? location.hash.slice(1) : "today");
requestAnimationFrame(() => navMarker.classList.add("is-ready")); // glide from now on, don't slide in on load

setInterval(refreshLive, 20 * 1000);
