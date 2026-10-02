/* Logan'sCafe dashboard: charts.js
   Small SVG and HTML charts, no libraries. Every chart can also be read
   without hovering: as a table, as labels, or as plain text beside it. */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const svgNS = "http://www.w3.org/2000/svg";

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

/* ---------- One tooltip, shared by every chart ---------- */

const tooltip = document.createElement("div");
tooltip.className = "tooltip";
tooltip.setAttribute("aria-hidden", "true");
document.body.append(tooltip);

// rows: [{ value, label, key }]. key picks the colour of the short line beside the value.
function showTooltip(title, rows, x, y) {
  tooltip.replaceChildren();

  const heading = document.createElement("p");
  heading.className = "tooltip-title";
  heading.textContent = title;
  tooltip.append(heading);

  rows.forEach((row) => {
    const line = document.createElement("p");
    line.className = "tooltip-row";

    if (row.key) {
      const key = document.createElement("span");
      key.className = "tooltip-key";
      key.style.setProperty("--key", `var(--chart-${row.key})`);
      line.append(key);
    }

    const value = document.createElement("strong");
    value.textContent = row.value;
    line.append(value);

    if (row.label) {
      const label = document.createElement("span");
      label.textContent = row.label;
      line.append(label);
    }

    tooltip.append(line);
  });

  tooltip.classList.add("is-visible");

  // Sit above and to the right of the pointer, but stay on screen
  const gap = 14;
  const { width, height } = tooltip.getBoundingClientRect();
  let left = x + gap;
  let top = y - height - gap;
  if (left + width > window.innerWidth - 8) left = x - width - gap;
  if (top < 8) top = y + gap;
  tooltip.style.translate = `${Math.max(8, left)}px ${top}px`;
}

function hideTooltip() {
  tooltip.classList.remove("is-visible");
}

window.addEventListener("scroll", hideTooltip, { passive: true });

/* ---------- Columns (one or two series side by side) ----------
   options: {
     labels       full name of each column, for the tooltip and the table
     ticks        short x-axis label for each column ("" leaves a gap)
     labelHeading table heading for the labels column
     series       [{ name, key, values }], key picks the colour, null = no value yet
     format       value -> text, for the tooltip and table
     tickFormat   value -> text, for the y-axis
     details      index -> extra tooltip rows
     labelMax     write the biggest value of the last series above its column
     description  what the chart shows, for screen readers
     animate      grow the columns in the first time they're drawn
   } */

function columnChart(container, options) {
  if (!container.querySelector(".chart-plot")) {
    container.innerHTML = '<div class="chart-plot"></div><div class="chart-table table-wrap" hidden></div>';
  }

  container.chartOptions = options;
  container.chartAnimate = Boolean(options.animate) && !reduceMotion;
  fillChartTable(container.querySelector(".chart-table"), options);
  drawColumns(container);

  // Redraw at the new width when the layout changes (or when a hidden view appears)
  if (!container.chartObserver) {
    container.chartObserver = new ResizeObserver(() => {
      const width = container.querySelector(".chart-plot").clientWidth;
      if (width && width !== container.chartWidth) drawColumns(container);
    });
    container.chartObserver.observe(container);
  }
}

// Round gridlines (0, 500, 1,000...), at most five of them above zero
function niceScale(max) {
  const value = Math.max(max, 1);
  const power = 10 ** Math.floor(Math.log10(value / 5));
  const step = [1, 2, 2.5, 5, 10, 20].map((n) => n * power).find((n) => Math.ceil(value / n) <= 5);
  return { step, top: Math.ceil(value / step) * step };
}

// A column with a 4px rounded top and a square foot on the baseline
function columnPath(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height);
  return `M${x},${y + height}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + width - r}A${r},${r} 0 0 1 ${x + width},${y + r}V${y + height}Z`;
}

function drawColumns(container) {
  const options = container.chartOptions;
  const plot = container.querySelector(".chart-plot");
  const width = plot.clientWidth;
  if (!width) return; // hidden for now; the resize observer draws it once it shows
  container.chartWidth = width;

  const { labels, ticks, series, format, tickFormat = format, labelMax } = options;
  const height = options.height || 250;
  const margin = { top: 24, right: 4, bottom: 32, left: 52 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const count = labels.length;
  const slot = plotWidth / count;

  const allValues = series.flatMap((s) => s.values).filter((value) => value != null);
  const { step, top } = niceScale(Math.max(...allValues, 0) * (labelMax ? 1.1 : 1));
  const y = (value) => margin.top + plotHeight - (value / top) * plotHeight;

  const svg = svgElement("svg", {
    class: "chart-svg",
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    tabindex: "0",
    role: "img",
    "aria-label": `${options.description} Use the left and right arrow keys to read each column, or show it as a table.`,
  });

  // Gridlines and y-axis labels
  for (let value = 0; value <= top + step / 1000; value += step) {
    const lineY = Math.round(y(value)) + 0.5;
    svg.append(
      svgElement("line", {
        x1: margin.left,
        x2: width - margin.right,
        y1: lineY,
        y2: lineY,
        class: value === 0 ? "chart-baseline" : "chart-grid",
      })
    );
    const label = svgElement("text", { x: margin.left - 10, y: lineY + 4, class: "chart-tick", "text-anchor": "end" });
    label.textContent = tickFormat(value);
    svg.append(label);
  }

  // A soft band behind the column you're looking at
  const wash = svgElement("rect", { class: "chart-wash", y: margin.top - 8, width: slot, height: plotHeight + 8, rx: 6 });
  svg.append(wash);

  // The columns
  const gap = 2;
  const barWidth = Math.max(2, Math.min(24, (slot * 0.72 - gap * (series.length - 1)) / series.length));
  const groupWidth = barWidth * series.length + gap * (series.length - 1);
  const barX = (seriesIndex, index) =>
    margin.left + slot * index + (slot - groupWidth) / 2 + seriesIndex * (barWidth + gap);

  series.forEach((s, seriesIndex) => {
    s.values.forEach((value, index) => {
      if (value == null || value <= 0) return;
      const barTop = y(value);
      const bar = svgElement("path", {
        d: columnPath(barX(seriesIndex, index), barTop, barWidth, y(0) - barTop, 4),
        class: "chart-bar",
      });
      bar.style.fill = `var(--chart-${s.key})`;
      if (container.chartAnimate) {
        bar.classList.add("is-growing");
        bar.style.animationDelay = `${index * Math.min(22, 500 / count)}ms`; // the whole wave takes half a second at most
      }
      svg.append(bar);
    });
  });

  // x-axis labels, thinned out so they never touch
  const tickIndexes = ticks.map((tick, index) => (tick ? index : -1)).filter((index) => index >= 0);
  const stride = tickIndexes.length > 1 ? tickIndexes[1] - tickIndexes[0] : 1;
  const skip = Math.max(1, Math.ceil(42 / (slot * stride)));
  tickIndexes.forEach((index, n) => {
    if ((tickIndexes.length - 1 - n) % skip !== 0) return; // always keep the newest label
    const text = svgElement("text", {
      x: margin.left + slot * (index + 0.5),
      y: height - 10,
      class: "chart-tick",
      "text-anchor": "middle",
    });
    text.textContent = ticks[index];
    svg.append(text);
  });

  // Label the biggest column, so the scale reads at a glance
  if (labelMax) {
    const last = series.length - 1;
    const values = series[last].values;
    let maxIndex = -1;
    values.forEach((value, index) => {
      if (value != null && (maxIndex < 0 || value > values[maxIndex])) maxIndex = index;
    });
    if (maxIndex >= 0) {
      const label = svgElement("text", {
        x: barX(last, maxIndex) + barWidth / 2,
        y: y(values[maxIndex]) - 8,
        class: "chart-value",
        "text-anchor": "middle",
      });
      label.textContent = format(values[maxIndex]);
      svg.append(label);
    }
  }

  // Hover and keyboard: one tooltip lists every series at that column
  function show(index, x, pointerY) {
    wash.setAttribute("x", margin.left + slot * index);
    wash.classList.add("is-visible");
    const rows = [...series].reverse().map((s) => ({
      key: s.key,
      value: s.values[index] == null ? "Not yet" : format(s.values[index]),
      label: s.name,
    }));
    showTooltip(labels[index], rows.concat(options.details ? options.details(index) : []), x, pointerY);
  }

  function clear() {
    wash.classList.remove("is-visible");
    hideTooltip();
  }

  for (let index = 0; index < count; index++) {
    const hit = svgElement("rect", {
      x: margin.left + slot * index,
      y: 0,
      width: slot,
      height,
      class: "chart-hit",
    });
    hit.addEventListener("pointermove", (event) => show(index, event.clientX, event.clientY));
    svg.append(hit);
  }
  svg.addEventListener("pointerleave", clear);

  let focusIndex = null;

  function showAt(index) {
    const box = svg.getBoundingClientRect();
    const tallest = Math.max(0, ...series.map((s) => s.values[index] ?? 0));
    show(index, box.left + margin.left + slot * (index + 0.5), box.top + y(tallest));
  }

  svg.addEventListener("focus", () => {
    if (!svg.matches(":focus-visible")) return;
    if (focusIndex == null) {
      const last = series[series.length - 1].values;
      focusIndex = Math.max(0, last.findLastIndex((value) => value != null));
    }
    showAt(focusIndex);
  });
  svg.addEventListener("blur", clear);
  svg.addEventListener("keydown", (event) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1 };
    if (event.key in moves) focusIndex = Math.min(count - 1, Math.max(0, (focusIndex ?? 0) + moves[event.key]));
    else if (event.key === "Home") focusIndex = 0;
    else if (event.key === "End") focusIndex = count - 1;
    else return;
    event.preventDefault();
    showAt(focusIndex);
  });

  plot.replaceChildren(svg);
  container.chartAnimate = false; // only grow the first time
}

// The same numbers as a table
function fillChartTable(holder, options) {
  const table = document.createElement("table");
  table.className = "data-table";
  const columns = [...options.series].reverse();

  const headRow = table.createTHead().insertRow();
  [options.labelHeading, ...columns.map((s) => s.name)].forEach((text, index) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = text;
    if (index) th.className = "num";
    headRow.append(th);
  });

  const body = table.createTBody();
  options.labels.forEach((label, index) => {
    const row = body.insertRow();
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = label;
    row.append(th);
    columns.forEach((s) => {
      const cell = row.insertCell();
      cell.className = "num";
      cell.textContent = s.values[index] == null ? "–" : options.format(s.values[index]);
    });
  });

  holder.replaceChildren(table);
}

/* ---------- Bar list (a ranked list with a thin bar under each name) ----------
   rows: [{ id, label, value }]. Existing rows slide to their new length. */

function barList(list, rows, format) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  const existing = new Map([...list.children].map((li) => [li.dataset.id, li]));

  const items = rows.map((row) => {
    let li = existing.get(row.id);
    if (!li) {
      li = document.createElement("li");
      li.dataset.id = row.id;
      li.innerHTML =
        '<span class="bar-name"></span><span class="bar-value"></span><span class="bar-fill" aria-hidden="true"></span>';
    }
    li.querySelector(".bar-name").textContent = row.label;
    li.querySelector(".bar-value").textContent = format(row.value);
    li.querySelector(".bar-fill").style.setProperty("--size", (row.value / max).toFixed(4));
    return li;
  });

  list.replaceChildren(...items);
}

/* ---------- Stacked bar (part of a whole) ----------
   parts: [{ key, name, value }] */

function stackedBar(container, parts, format) {
  const total = parts.reduce((sum, part) => sum + part.value, 0) || 1;
  const bar = document.createElement("div");
  bar.className = "stack";
  bar.setAttribute("aria-hidden", "true");

  const legend = document.createElement("ul");
  legend.className = "stack-legend";

  parts.forEach((part) => {
    const share = part.value / total;
    const percent = `${Math.round(share * 100)}%`;

    const segment = document.createElement("span");
    segment.className = `stack-part part-${part.key}`;
    segment.style.flexGrow = share.toFixed(4);
    segment.style.background = `var(--chart-${part.key})`;
    if (share >= 0.14) segment.textContent = percent; // only when it fits comfortably
    segment.addEventListener("pointermove", (event) =>
      showTooltip(part.name, [{ key: part.key, value: format(part.value), label: `${percent} of sales` }], event.clientX, event.clientY)
    );
    segment.addEventListener("pointerleave", hideTooltip);
    bar.append(segment);

    const item = document.createElement("li");
    item.innerHTML = '<span class="legend-swatch"></span><span class="stack-name"></span><strong></strong><span class="stack-share"></span>';
    item.querySelector(".legend-swatch").style.setProperty("--key", `var(--chart-${part.key})`);
    item.querySelector(".stack-name").textContent = part.name;
    item.querySelector("strong").textContent = format(part.value);
    item.querySelector(".stack-share").textContent = percent;
    legend.append(item);
  });

  container.replaceChildren(bar, legend);
}

/* ---------- Heatmap (a table, so every number is there for screen readers) ----------
   rows: [{ label, name, values }] (null = closed), columns: [{ label, name }] */

const heatSteps = 7;

function heatmap(container, { rows, columns, caption, format }) {
  const max = Math.max(1, ...rows.flatMap((row) => row.values).filter((value) => value != null));
  const table = document.createElement("table");
  table.className = "heatmap";

  const captionElement = table.createCaption();
  captionElement.className = "visually-hidden";
  captionElement.textContent = caption;

  const headRow = table.createTHead().insertRow();
  headRow.append(document.createElement("td"));
  columns.forEach((column, index) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = column.label;
    if (index % 2) th.className = "is-minor"; // every other hour hides on small screens
    headRow.append(th);
  });

  const body = table.createTBody();
  rows.forEach((row) => {
    const tr = body.insertRow();
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = row.label;
    tr.append(th);

    row.values.forEach((value, index) => {
      const cell = tr.insertCell();
      const hidden = document.createElement("span");
      hidden.className = "visually-hidden";

      if (value == null) {
        cell.className = "heat is-closed";
        hidden.textContent = "Closed";
      } else {
        const level = Math.min(heatSteps - 1, Math.floor((value / max) * heatSteps));
        cell.className = `heat heat-${level}`;
        hidden.textContent = format(value);
      }
      cell.append(hidden);

      cell.addEventListener("pointermove", (event) => {
        const title = `${row.name}, ${columns[index].name}`;
        const lines = value == null ? [{ value: "Closed" }] : [{ value: format(value), label: "on average" }];
        showTooltip(title, lines, event.clientX, event.clientY);
      });
      cell.addEventListener("pointerleave", hideTooltip);
    });
  });

  // Scale: quiet to busy
  const scale = document.createElement("div");
  scale.className = "heat-scale";
  scale.setAttribute("aria-hidden", "true");
  scale.innerHTML =
    "<span>Quiet</span>" +
    Array.from({ length: heatSteps }, (_, step) => `<i class="heat-${step}"></i>`).join("") +
    "<span>Busy</span>";

  const wrap = document.createElement("div");
  wrap.className = "heatmap-wrap";
  wrap.append(table);
  container.replaceChildren(wrap, scale);
}
