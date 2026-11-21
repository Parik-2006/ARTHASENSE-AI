/** ArthaGuide content: short, plain-English answers to the same four questions. */
export interface GuideEntry {
  title: string;
  what: string;
  why: string;
  read: string;
  avoid: string;
}

export type GuideKey =
  | "index" | "baseYear" | "mom" | "yoy" | "official" | "range" | "movingAverage"
  | "heatmap" | "seasonal" | "sectors" | "source" | "missing" | "compare" | "indicators" | "trend"; // prettier-ignore

export const GUIDE: Record<GuideKey, GuideEntry> = {
  index: {
    title: "Index value",
    what: "A price or output level compared with a base period, which is set to 100.",
    why: "It shows whether things are higher or lower than in the base period.",
    read: "104.1 with base 2024 means 4.1% above the 2024 level.",
    avoid: "It is a level, not a rate. Levels of different indicators are not comparable.",
  },
  baseYear: {
    title: "Base year",
    what: "The period an index is measured against (set to 100).",
    why: "Each series only makes sense inside its own base year.",
    read: "Check the base year before comparing two numbers.",
    avoid: "Never join series with different base years into one line.",
  },
  mom: {
    title: "Month-over-month change",
    what: "How much the index moved since the previous month, in percent.",
    why: "Shows short-term momentum.",
    read: "Positive bars mean the index rose; negative bars mean it fell.",
    avoid: "It is calculated by ArthaSense, not an official rate, and monthly swings are noisy.",
  },
  yoy: {
    title: "Year-over-year change",
    what: "Change against the same month a year earlier, in percent.",
    why: "It removes most seasonal effects, so it is the usual way to quote inflation or growth.",
    read: "A value of 4% means the index is 4% above its level a year ago.",
    avoid: "It needs 12 months of history. A calculated value is not the official published rate.",
  },
  official: {
    title: "Official published rate",
    what: "The year-on-year figure that the statistics office itself reports.",
    why: "It is the authoritative number.",
    read: "If a month is missing, the source did not provide it.",
    avoid: "We never fill gaps with our own estimate under this label.",
  },
  range: {
    title: "Date range",
    what: "How much history to show. Presets end at the latest stored month of that series.",
    why: "Short ranges show recent moves; long ranges show the trend.",
    read: "Use Custom to pick exact months.",
    avoid: "A range longer than the stored history just shows what exists.",
  },
  movingAverage: {
    title: "3-month moving average",
    what: "The average of this month and the two before it.",
    why: "It smooths noise so the trend is easier to see.",
    read: "Compare the smooth line with the raw points.",
    avoid: "It is calculated, lags the data, and is blank wherever a month is missing.",
  },
  heatmap: {
    title: "Monthly heatmap",
    what: "A grid of years by month; colour shows the chosen metric.",
    why: "It spots strong, weak and seasonal months at a glance.",
    read: "Stronger colour means a larger absolute value. Hover or focus a cell for the exact number.",
    avoid: "Colours are only comparable within one metric. Grey cells are missing months.",
  },
  seasonal: {
    title: "Year-on-year overlay",
    what: "One line per year across January to December.",
    why: "It reveals repeating seasonal shapes.",
    read: "Lines that rise and fall together in the same months show seasonality.",
    avoid: "IIP is not seasonally adjusted, so some swings are seasonal, not real change.",
  },
  sectors: {
    title: "Sector comparison",
    what: "Official growth of Mining, Manufacturing, Electricity and Water for the same month.",
    why: "It shows which parts of industry drive the headline.",
    read: "Compare the bars for one reporting month.",
    avoid: "Sector index levels are not additive or comparable; compare growth rates.",
  },
  source: {
    title: "Source details",
    what: "Who published the data, how we got it, and when.",
    why: "Every figure should be traceable.",
    read: "Open View source for the series identifier and formula.",
    avoid: "Retrieval time is when we downloaded the data, not when it was published.",
  },
  missing: {
    title: "Missing data",
    what: "A month with no stored value or no published rate.",
    why: "Honest gaps are better than invented numbers.",
    read: "Gaps appear as breaks in a line or as a dash.",
    avoid: "A dash means not available, not zero.",
  },
  compare: {
    title: "Comparing indicators",
    what: "CPI, WPI and IIP shown on comparable percentage scales, one chart each.",
    why: "Percent changes can sit side by side; index levels cannot.",
    read: "Look at the direction and timing of the changes.",
    avoid: "They measure different things, and moving together does not prove one causes the other.",
  },
  indicators: {
    title: "Economic indicators",
    what: "CPI tracks consumer prices, WPI tracks wholesale prices of goods, IIP tracks industrial output.",
    why: "Together they describe prices and production in the economy.",
    read: "Open each page for its history, source and downloadable data.",
    avoid: "They are different measures with different base years.",
  },
  trend: {
    title: "Historical trend",
    what: "The chosen statistic for each stored month.",
    why: "It shows direction and turning points over time.",
    read: "Hover or use the arrow keys to read a month.",
    avoid: "The vertical axis does not start at zero, so small moves look larger.",
  },
};
