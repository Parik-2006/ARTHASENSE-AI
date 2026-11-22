/** ArthaGuide content and tour state. Pure, so it can be tested and reused by other pages. */

export interface HelpEntry {
  title: string;
  what: string;
  why: string;
  how: string;
  mistake: string;
}

export const HELP: Record<string, HelpEntry> = {
  cpi: {
    title: "Consumer Price Index (CPI)",
    what: "CPI tracks changes in the prices households pay for a fixed basket of goods and services.",
    why: "It is the main way to follow consumer inflation.",
    how: "Compare the index with an earlier month. A rising index means the basket costs more.",
    mistake: "A CPI index of 104.10 is not 4.10% inflation. Inflation is the percentage change from a year earlier.",
  },
  wpi: {
    title: "Wholesale Price Index (WPI)",
    what: "WPI tracks prices of goods traded in bulk, before they reach shoppers. It covers goods, not services.",
    why: "Wholesale prices can signal cost pressure for businesses.",
    how: "Watch whether the index is rising or falling over several months.",
    mistake: "WPI is not the price you pay in a shop, so it is not a substitute for CPI.",
  },
  iip: {
    title: "Index of Industrial Production (IIP)",
    what: "IIP measures the volume of output from mining, manufacturing and electricity.",
    why: "It shows whether factories and utilities are producing more or less.",
    how: "Prefer the official year-on-year growth, because month-to-month moves follow the seasons.",
    mistake: "An IIP of 124.30 is not 24.30% growth. It is a level relative to a base period set at 100.",
  },
  gdp: {
    title: "Gross Domestic Product (GDP)",
    what: "GDP is the total value of goods and services produced in the country. Here it is real GDP: measured at constant prices so inflation does not inflate it.",
    why: "It is the broadest measure of how fast the economy is growing.",
    how: "Read the year-on-year change: it compares a quarter with the same quarter a year earlier.",
    mistake: "GDP is published quarterly. There is no monthly GDP, so none is drawn or estimated.",
  },
  "gdp-quarterly": {
    title: "Why GDP is quarterly",
    what: "India's GDP is estimated for each fiscal quarter (Q1 is April to June), not each month.",
    why: "Mixing it with monthly series needs care.",
    how: "When GDP is selected, monthly indicators are shown as quarterly averages, and only where all three months are stored.",
    mistake: "Do not read a quarterly point as a monthly value, and do not compare raw index levels with GDP levels.",
  },
  "expand-graph": {
    title: "Opening a full chart",
    what: "Select a card to open its full historical chart below the cards. Select it again, or Close, to hide it.",
    why: "Each indicator has its own scale and base year, so each gets its own chart.",
    how: "Use 3M to All, or Custom months, to change the window. The browser Back button closes the chart.",
    mistake: "A range longer than the stored history is not widened or filled in. The note under the chart says how many months exist.",
  },
  "history-gaps": {
    title: "Why some history is missing",
    what: "Official series start when the publisher started them, and a new base year starts a separate series.",
    why: "Series on different base years cannot be joined into one line without a verified method.",
    how: "Use the series selector on a chart to see an earlier base year on its own.",
    mistake: "A missing month is not zero. It is shown as a gap.",
  },
  "index-value": {
    title: "Index value",
    what: "An index shows a level relative to a base period, which is set to 100.",
    why: "It lets us follow change over time without tracking individual prices.",
    how: "Compare two months of the same index. Do not compare levels of different indices.",
    mistake: "An index number is not a percentage rate.",
  },
  "base-year": {
    title: "Base year",
    what: "The period an index is measured against. Its value is set to 100 there.",
    why: "Index levels from different base years are not on the same scale.",
    how: "Read levels only within one base year. Charts here keep different bases apart.",
    mistake: "Joining two base years into one line can look like a jump that never happened.",
  },
  mom: {
    title: "Monthly change",
    what: "The percentage change of the index from the previous month, calculated by ArthaSense.",
    why: "It shows short-term movement.",
    how: "Positive means the index rose compared with last month. Bars below zero mean it fell.",
    mistake: "It is not an official rate, and for IIP it mostly reflects seasonal patterns.",
  },
  yoy: {
    title: "Annual change (year over year)",
    what: "The percentage change from the same month a year earlier.",
    why: "Comparing the same month removes most seasonal effects.",
    how: "Official figures are shown as published. Calculated ones are labelled as such.",
    mistake: "A positive annual rate means a higher level than last year, not necessarily a healthier economy.",
  },
  "trend-chart": {
    title: "Trend chart",
    what: "One point per month, joined by a line. Missing months leave a gap.",
    why: "It shows direction over time.",
    how: "Hover or use the arrow keys to read a month. The vertical axis may not start at zero.",
    mistake: "Do not compare the height of one indicator's line with another's. Each has its own scale.",
  },
  comparison: {
    title: "Comparing indicators",
    what: "Compares percentage changes, which are on a common footing, rather than raw index levels.",
    why: "CPI, WPI and IIP measure different things in different units.",
    how: "Look at direction and size of change over the same months.",
    mistake: "Similar movement does not mean one causes the other.",
  },
  heatmap: {
    title: "Monthly heatmap",
    what: "A grid of years and months. Colour and the printed number show the size and direction of change.",
    why: "It makes seasonal patterns and unusual months easy to spot.",
    how: "Blue-leaning cells are negative, warm cells are positive, and hatched cells are missing.",
    mistake: "A blank cell means no stored value, not zero.",
  },
  insight: {
    title: "Insight statements",
    what: "Short statements generated by fixed rules from stored numbers. No reasons are guessed.",
    why: "They turn tables into plain language.",
    how: "Use 'How was this calculated?' to see the formula and the supporting numbers.",
    mistake: "They describe what happened, not why it happened or what comes next.",
  },
  forecast: {
    title: "Model-generated forecast",
    what: "A stored estimate of future values produced by a statistical or machine-learning model.",
    why: "It gives a reference for what might happen if past patterns continue.",
    how: "Read the point estimate together with its uncertainty range, the origin and the model.",
    mistake: "A forecast is not an official statistic and not a promise.",
  },
  interval: {
    title: "Prediction interval",
    what: "A range expected to contain the true value a stated share of the time, such as 80% or 95%.",
    why: "It shows how uncertain the forecast is.",
    how: "A wider band means more uncertainty.",
    mistake: "The true value can still fall outside it.",
  },
  metrics: {
    title: "Evaluation metrics",
    what: "MAE is the average size of forecast mistakes in index points. Backtesting replays a model on earlier periods.",
    why: "It shows how a model behaved on data it had not seen.",
    how: "Lower MAE means smaller past errors, but only compare models tested on the same data and horizon.",
    mistake: "Good backtest results do not guarantee future accuracy.",
  },
  official: {
    title: "Official published rate",
    what: "The year-on-year figure that the statistics office itself reports.",
    why: "It is the authoritative number.",
    how: "If a month is missing, the source did not provide it.",
    mistake: "ArthaSense never fills gaps with its own estimate under this label.",
  },
  range: {
    title: "Date range",
    what: "How much history to show. Presets end at the latest stored month of each series.",
    why: "Short ranges show recent moves; long ranges show the trend.",
    how: "Use Custom to pick exact months.",
    mistake: "A range longer than the stored history just shows what exists; it does not add data.",
  },
  "moving-average": {
    title: "3-month moving average",
    what: "The average of this month and the two before it, calculated by ArthaSense.",
    why: "It smooths noise so the trend is easier to see.",
    how: "Compare the dashed smooth line with the raw values.",
    mistake: "It lags the data and is blank wherever any of the three months is missing.",
  },
  seasonal: {
    title: "Year-by-year overlay",
    what: "One line per year across January to December, for the same metric.",
    why: "It reveals repeating seasonal shapes.",
    how: "Lines that rise and fall together in the same months show seasonality.",
    mistake: "IIP is not seasonally adjusted, so some swings are seasonal rather than real changes in output.",
  },
  sectors: {
    title: "Sector comparison",
    what: "Official growth of Mining, Manufacturing, Electricity and Water for the same month.",
    why: "It shows which parts of industry drive the headline.",
    how: "Compare the bars for one reporting month.",
    mistake: "Sector index levels are not additive or comparable; compare growth rates.",
  },
  missing: {
    title: "Missing data",
    what: "A month with no stored value or no published rate.",
    why: "Honest gaps are better than invented numbers.",
    how: "Gaps appear as breaks in a line or as a dash.",
    mistake: "A dash means not available, not zero.",
  },
  indicators: {
    title: "Economic indicators",
    what: "CPI tracks consumer prices, WPI wholesale prices of goods, IIP industrial output.",
    why: "Together they describe prices and production in the economy.",
    how: "Open each page for its history, source and downloadable data.",
    mistake: "They are different measures with different base years.",
  },
  source: {
    title: "Source details",
    what: "Where a number comes from: publisher, dataset, retrieval time and method.",
    why: "You should be able to check every figure.",
    how: "Open 'Source details'. Anything the source does not provide is marked as such.",
    mistake: "The retrieval time is when ArthaSense fetched the data, not the official release date.",
  },
};

// ---------- tour ----------

export interface TourStep {
  target: string; // value of data-tour
  title: string;
  body: string;
}

export const OVERVIEW_TOUR: TourStep[] = [
  { target: "hero", title: "Welcome", body: "Three views of India's economy, all from official data with the source shown." },
  { target: "cards", title: "Four indicators", body: "CPI is consumer prices, WPI wholesale prices, IIP industrial output and GDP total production." },
  { target: "card-index", title: "Open a graph", body: "Select a card to open its full chart below. Select it again to close it. An index is a level against a base of 100, not a percentage." },
  { target: "range", title: "Time filters", body: "Pick 3M to All, or Custom months. Your choice stays in the page link, and the Back button works." },
  { target: "changes", title: "How things are changing", body: "Bars above zero are rises, below are falls. Official figures are labelled as such; calculated ones say so." },
  { target: "compare", title: "Comparing trends", body: "We compare percentage changes, never raw levels. GDP is quarterly, so selecting it switches the comparison to quarters." },
  { target: "cards", title: "Check the source", body: "Every card and chart has a source line and a Source details panel with links to the publisher." },
];

/** Indicators page tour. Targets are `data-tour` attributes on the Indicators hub. */
export const INDICATORS_TOUR: TourStep[] = [
  { target: "ind-intro", title: "What are economic indicators?", body: "Indicators are official statistics that track the economy over time. Here you can explore CPI, WPI and IIP." },
  { target: "ind-cards", title: "CPI, WPI and IIP", body: "CPI measures consumer prices, WPI wholesale prices of goods, and IIP industrial output. They are different measures with different base years." },
  { target: "ind-cards", title: "The latest-value cards", body: "Each card shows the newest stored index, its month and base year, the monthly change ArthaSense calculates, and the official annual rate when the source provides one." },
  { target: "ind-range", title: "Choosing a date range", body: "Pick 3M to 5Y or All. Ranges end at each series' latest stored month. Custom months and metrics are on each indicator page, and your choice is kept in the page link." },
  { target: "ind-trends", title: "Reading historical trends", body: "Hover or use the arrow keys on a chart to read each month. Breaks in a line are months with no stored data." },
  { target: "ind-compare", title: "Comparing indicators", body: "Percentage changes can sit side by side; index levels cannot. Similar movement does not show that one causes the other." },
  { target: "ind-coverage", title: "Checking coverage and sources", body: "This table shows what is stored. Every chart also has a source line and a 'Source details' panel with the series identifier and formula." },
  { target: "ind-explore", title: "Going deeper", body: "Open an indicator page for the metric selector, heatmap, moving average, sector explorer, searchable table and CSV download of the months you selected." },
];

export interface TourState {
  open: boolean;
  step: number;
}

export type TourAction = { type: "start" } | { type: "next" } | { type: "back" } | { type: "close" } | { type: "goto"; step: number };

export function tourReducer(state: TourState, action: TourAction, total: number): TourState {
  switch (action.type) {
    case "start":
      return { open: true, step: 0 };
    case "next":
      if (!state.open) return state;
      return state.step >= total - 1 ? { open: false, step: 0 } : { open: true, step: state.step + 1 };
    case "back":
      return state.open ? { open: true, step: Math.max(0, state.step - 1) } : state;
    case "goto":
      return { open: true, step: Math.min(Math.max(0, action.step), total - 1) };
    case "close":
      return { open: false, step: 0 };
  }
}
