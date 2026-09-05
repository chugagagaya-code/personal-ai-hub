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

  const slashMonth = query.match(/(20\d{2})\s*[./-]\s*(1[0-2]|0?[1-9])(?:\s*(?:月|月份))?/);
  if (slashMonth) {
    const year = Number(slashMonth[1]);
    const month = Number(slashMonth[2]);
    return buildMonthRange(year, month);
  }

  const yearOnly = query.match(/(20\d{2})\s*年(?!\s*(?:1[0-2]|0?[1-9])\s*月)/);
  if (yearOnly) {
    const year = Number(yearOnly[1]);
    return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1), label: `${year}年` };
  }

  const relative = query.match(/(?:过去|最近|近)\s*(一年|1\s*年|半年|六个月|6\s*个?月|三个月|3\s*个?月)/);
  if (relative) {
    const months = /一年|1\s*年/.test(relative[1]) ? 12 : /半年|六个月|6/.test(relative[1]) ? 6 : 3;
    const end = new Date();
    end.setDate(end.getDate() + 1);
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setMonth(start.getMonth() - months);
    return { start, end, label: `最近${months === 12 ? "一年" : `${months}个月`}` };
  }

  return undefined;
}

function buildMonthRange(year: number, month: number): DateRangeQuery {
  const start = new Date(year, month - 1, 1, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0);
  return {
    start,
    end,
    label: `${year}年${month}月`,
  };
}
