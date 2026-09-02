export interface DateRangeQuery {
  start: Date;
  end: Date;
  label: string;
}

export function parseDateRangeQuery(query: string): DateRangeQuery | undefined {
  const yearMonth = query.match(/(20\d{2})\s*年\s*(1[0-2]|0?[1-9])\s*月/);
  if (yearMonth) {
    const year = Number(yearMonth[1]);
    const month = Number(yearMonth[2]);
    return buildMonthRange(year, month);
  }

  const slashMonth = query.match(/(20\d{2})[/-](1[0-2]|0?[1-9])/);
  if (slashMonth) {
    const year = Number(slashMonth[1]);
    const month = Number(slashMonth[2]);
    return buildMonthRange(year, month);
  }

  return undefined;
}

function buildMonthRange(year: number, month: number): DateRangeQuery {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  return {
    start,
    end,
    label: `${year}年${month}月`,
  };
}
