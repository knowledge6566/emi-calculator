// Rupee Calc: calculations run in the browser. Supports any currency and region format.
(function () {
  "use strict";

  // ---------- Regions (number/date formatting) ----------
  // Each entry is a BCP 47 locale. Currency is chosen separately, so any currency
  // can use any region's number format (e.g. USD with Indian lakh grouping).
  const REGIONS = [
    ["en-IN", "India"], ["en-US", "United States"], ["en-GB", "United Kingdom"],
    ["en-CA", "Canada"], ["en-AU", "Australia"], ["en-NZ", "New Zealand"],
    ["en-SG", "Singapore"], ["en-ZA", "South Africa"], ["en-NG", "Nigeria"],
    ["en-KE", "Kenya"], ["en-AE", "United Arab Emirates"], ["en-PK", "Pakistan"],
    ["de-DE", "Germany"], ["fr-FR", "France"], ["es-ES", "Spain"], ["it-IT", "Italy"],
    ["nl-NL", "Netherlands"], ["pt-PT", "Portugal"], ["pl-PL", "Poland"],
    ["sv-SE", "Sweden"], ["ru-RU", "Russia"], ["tr-TR", "Turkey"],
    ["ar-SA", "Saudi Arabia"], ["ar-EG", "Egypt"], ["pt-BR", "Brazil"],
    ["es-MX", "Mexico"], ["es-AR", "Argentina"], ["ja-JP", "Japan"],
    ["zh-CN", "China"], ["ko-KR", "South Korea"], ["id-ID", "Indonesia"],
    ["ms-MY", "Malaysia"], ["th-TH", "Thailand"], ["vi-VN", "Vietnam"],
    ["fil-PH", "Philippines"], ["bn-BD", "Bangladesh"], ["ne-NP", "Nepal"],
  ];

  // ---------- Currencies ----------
  const PRIORITY = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "CAD", "AUD", "JPY", "CNY"];
  let CURRENCIES;
  try {
    CURRENCIES = Intl.supportedValuesOf("currency");
  } catch (e) {
    CURRENCIES = PRIORITY.slice();
  }
  const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });
  CURRENCIES = Array.from(new Set([...PRIORITY, ...CURRENCIES])).sort((a, b) => {
    const pa = PRIORITY.indexOf(a), pb = PRIORITY.indexOf(b);
    if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    return a.localeCompare(b);
  });

  // ---------- Settings (shared across pages) ----------
  const STORAGE_KEY = "rupeecalc.settings";
  const settings = { currency: "INR", locale: "en-IN" };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && CURRENCIES.includes(saved.currency) && REGIONS.some((r) => r[0] === saved.locale)) {
      Object.assign(settings, saved);
    }
  } catch (e) { /* storage blocked: use defaults */ }

  const listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  // ---------- Formatting ----------
  function money(value, decimals) {
    return new Intl.NumberFormat(settings.locale, {
      style: "currency", currency: settings.currency,
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    }).format(value);
  }
  function currencySymbol() {
    const parts = new Intl.NumberFormat(settings.locale, { style: "currency", currency: settings.currency })
      .formatToParts(0);
    const part = parts.find((p) => p.type === "currency");
    return part ? part.value : settings.currency;
  }
  function pct(n) { return `${Math.round(n * 10) / 10}%`; }
  const round2 = (n) => Math.round(n * 100) / 100;

  // ---------- Calculations ----------
  // EMI = P * r * (1 + r)^n / ((1 + r)^n - 1), r = annual / 12 / 100, n = months
  function calculateEmi(principal, annualRate, years) {
    const n = Math.round(years * 12);
    const r = annualRate / 12 / 100;
    let emi;
    if (r === 0) {
      emi = principal / n;
    } else {
      const f = Math.pow(1 + r, n);
      emi = (principal * r * f) / (f - 1);
    }
    const yearly = [];
    let balance = principal, totalInterest = 0, yPrin = 0, yInt = 0;
    for (let m = 1; m <= n; m++) {
      const interest = balance * r;
      let princPart = emi - interest;
      if (m === n) princPart = balance; // clear rounding drift on the last month
      balance = Math.max(0, balance - princPart);
      totalInterest += interest;
      yPrin += princPart;
      yInt += interest;
      if (m % 12 === 0 || m === n) {
        yearly.push({ year: Math.ceil(m / 12), principalPaid: round2(yPrin), interestPaid: round2(yInt), outstanding: round2(balance) });
        yPrin = 0; yInt = 0;
      }
    }
    return { emi: round2(emi), months: n, totalInterest: round2(totalInterest), totalPayment: round2(principal + totalInterest), yearly };
  }

  // SIP: contributions at the start of each month (annuity due)
  // FV = P * [((1 + i)^n - 1) / i] * (1 + i), i = annual / 12 / 100, n = months
  function calculateSip(monthly, annualRate, years) {
    const n = Math.round(years * 12);
    const i = annualRate / 12 / 100;
    const yearly = [];
    let value = 0, invested = 0;
    for (let m = 1; m <= n; m++) {
      value = (value + monthly) * (1 + i);
      invested += monthly;
      if (m % 12 === 0) {
        yearly.push({ year: m / 12, invested: round2(invested), value: round2(value), gains: round2(value - invested) });
      }
    }
    return { months: n, invested: round2(invested), maturityValue: round2(value), gains: round2(value - invested), yearly };
  }

  function check(value, min, max, name) {
    if (!Number.isFinite(value)) return `${name} must be a number`;
    if (value < min || value > max) return `${name} must be between ${min} and ${max.toLocaleString("en-US")}`;
    return "";
  }

  // ---------- UI helpers ----------
  function link(rangeEl, numberEl, update) {
    rangeEl.addEventListener("input", () => { numberEl.value = rangeEl.value; update(); });
    numberEl.addEventListener("input", () => {
      if (numberEl.value !== "") {
        const v = Number(numberEl.value);
        // Keep the slider inside its range so it never shows a wrong position
        rangeEl.value = Math.min(Math.max(v, Number(rangeEl.min)), Number(rangeEl.max));
      }
      update();
    });
  }

  function fillTable(tbody, rows, cols) {
    tbody.innerHTML = "";
    const frag = document.createDocumentFragment();
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      cols.forEach((c) => { const td = document.createElement("td"); td.textContent = c(row); tr.appendChild(td); });
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  }

  // Fill the currency and region selects that appear on each calculator page
  function initSelectors() {
    const cur = document.getElementById("currency");
    const reg = document.getElementById("region");
    if (cur) {
      cur.innerHTML = "";
      CURRENCIES.forEach((code) => {
        const opt = document.createElement("option");
        opt.value = code;
        const name = currencyNames.of(code) || code;
        opt.textContent = `${code} - ${name}`;
        cur.appendChild(opt);
      });
      cur.value = settings.currency;
      cur.addEventListener("change", () => { settings.currency = cur.value; saveSettings(); notify(); });
    }
    if (reg) {
      reg.innerHTML = "";
      REGIONS.slice().sort((a, b) => a[1].localeCompare(b[1])).forEach(([code, name]) => {
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = `${name} (${code})`;
        reg.appendChild(opt);
      });
      reg.value = settings.locale;
      reg.addEventListener("change", () => { settings.locale = reg.value; saveSettings(); notify(); });
    }
  }

  function notify() {
    document.querySelectorAll("[data-currency-symbol]").forEach((el) => { el.textContent = currencySymbol(); });
    listeners.forEach((fn) => fn());
  }

  // ---------- EMI page ----------
  function initEmi() {
    const $ = (id) => document.getElementById(id);
    const amount = $("emi-amount"), amountR = $("emi-amount-range");
    const rate = $("emi-rate"), rateR = $("emi-rate-range");
    const years = $("emi-years"), yearsR = $("emi-years-range");
    const errorEl = $("emi-error");

    function update() {
      const p = Number(amount.value), r = Number(rate.value), y = Number(years.value);
      const err = check(p, 1, 1e12, "Loan amount") || check(r, 0.01, 50, "Interest rate") || check(y, 1, 30, "Loan tenure");
      errorEl.textContent = err;
      if (err) return;

      const d = calculateEmi(p, r, y);
      $("emi-result").textContent = money(d.emi, 2);
      $("emi-principal").textContent = money(p, 0);
      $("emi-interest").textContent = money(d.totalInterest, 0);
      $("emi-total").textContent = money(d.totalPayment, 0);

      const interestShare = (d.totalInterest / d.totalPayment) * 100;
      $("emi-donut").style.setProperty("--p", `${(100 - interestShare).toFixed(2)}%`);
      $("emi-legend-p").textContent = `Principal ${pct(100 - interestShare)}`;
      $("emi-legend-i").textContent = `Interest ${pct(interestShare)}`;
      $("emi-summary").textContent = `Monthly EMI of ${money(d.emi, 2)} for ${d.months} months at ${r}% p.a.`;

      fillTable($("emi-table-body"), d.yearly, [
        (x) => `Year ${x.year}`,
        (x) => money(x.principalPaid, 0),
        (x) => money(x.interestPaid, 0),
        (x) => money(x.outstanding, 0),
      ]);
    }

    link(amountR, amount, update); link(rateR, rate, update); link(yearsR, years, update);
    $("emi-form").addEventListener("submit", (e) => { e.preventDefault(); update(); });
    onChange(update);
    initSelectors();
    notify();
  }

  // ---------- SIP page ----------
  function initSip() {
    const $ = (id) => document.getElementById(id);
    const monthly = $("sip-monthly"), monthlyR = $("sip-monthly-range");
    const rate = $("sip-rate"), rateR = $("sip-rate-range");
    const years = $("sip-years"), yearsR = $("sip-years-range");
    const errorEl = $("sip-error");

    function update() {
      const m = Number(monthly.value), r = Number(rate.value), y = Number(years.value);
      const err = check(m, 1, 1e9, "Monthly investment") || check(r, 0.01, 50, "Expected return") || check(y, 1, 40, "Investment period");
      errorEl.textContent = err;
      if (err) return;

      const d = calculateSip(m, r, y);
      $("sip-value").textContent = money(d.maturityValue, 0);
      $("sip-invested").textContent = money(d.invested, 0);
      $("sip-gains").textContent = money(d.gains, 0);

      const gainShare = d.maturityValue > 0 ? (d.gains / d.maturityValue) * 100 : 0;
      $("sip-donut").style.setProperty("--p", `${(100 - gainShare).toFixed(2)}%`);
      $("sip-legend-i").textContent = `Invested ${pct(100 - gainShare)}`;
      $("sip-legend-g").textContent = `Gains ${pct(gainShare)}`;
      $("sip-summary").textContent = `Investing ${money(m, 0)} every month for ${y} years at ${r}% expected return.`;

      fillTable($("sip-table-body"), d.yearly, [
        (x) => `Year ${x.year}`,
        (x) => money(x.invested, 0),
        (x) => money(x.gains, 0),
        (x) => money(x.value, 0),
      ]);
    }

    link(monthlyR, monthly, update); link(rateR, rate, update); link(yearsR, years, update);
    $("sip-form").addEventListener("submit", (e) => { e.preventDefault(); update(); });
    onChange(update);
    initSelectors();
    notify();
  }

  const page = document.body.dataset.calc;
  if (page === "emi") initEmi();
  if (page === "sip") initSip();
})();
