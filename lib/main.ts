import { CalendarScope } from '@romcal/constants/calendar-scope';
import { LiturgicalSeasons } from '@romcal/constants/seasons';
import { GeneralRoman } from '@romcal/general-calendar/proper-of-saints';
import { PROPER_OF_TIME_NAME, ProperOfTime } from '@romcal/general-calendar/proper-of-time';
import { Calendar } from '@romcal/models/calendar';
import { RomcalConfig } from '@romcal/models/config';
import LiturgicalDay from '@romcal/models/liturgical-day';
import { LiturgicalDayConfig } from '@romcal/models/liturgical-day-config';
import { LiturgicalCalendar } from '@romcal/types/calendar';
import { BaseCalendarDef, LiturgicalDayDefinitions } from '@romcal/types/calendar-def';
import { BaseRomcalConfig, RomcalConfigInput } from '@romcal/types/config';
import { Key, RomcalCalendarMetadata } from '@romcal/types/liturgical-day';
import { Dates } from '@romcal/utils/dates';
import dayjs from 'dayjs';

export default class Romcal {
  readonly #config: RomcalConfig;
  readonly #calendarsDef: InstanceType<BaseCalendarDef>[];
  #computedCalendars: Record<number, LiturgicalCalendar> = {};
  #dates: Record<number, Dates> = {};

  /**
   * Utility helpers to compute the date(s) of specific liturgical days or seasons.
   */
  constructor(config?: RomcalConfigInput) {
    this.#config = new RomcalConfig(config);
    this.#calendarsDef = [new GeneralRoman(this.#config)];

    if (this.#config.particularCalendar) {
      this.#calendarsDef.push(new this.#config.particularCalendar(this.#config));
    }

    this.#calendarsDef.map((cal) => cal.updateConfig(config));
  }

  /**
   * Get the complete configuration, used to create and generate a calendar.
   */
  public get config(): BaseRomcalConfig {
    return this.#config.toObject();
  }

  /**
   * Dates library
   * @param year
   */
  dates(year?: number): Dates {
    const ldConfig = new LiturgicalDayConfig(this.#config, year);
    if (this.#dates[ldConfig.year]) return this.#dates[ldConfig.year];
    return (this.#dates[ldConfig.year] = ldConfig.dates);
  }

  /**
   * Get one LiturgicalDay by its key.
   * Return undefined if not found, or null if the LiturgicalDay do not occur in the provided year.
   * Note: this function compute only one LiturgicalDay without the liturgical whole year background,
   * so some metadata may be missing, and the precedence rules between different LiturgicalDay
   * objects are ignored.
   * @param key
   * @param year
   */
  getOneLiturgicalDay(key: Key, year?: number): Promise<LiturgicalDay | null | undefined> {
    const ldConfig = new LiturgicalDayConfig(this.#config, year);

    return new Promise((resolve, reject) => {
      try {
        this.getAllDefinitions().then(() => {
          // Return undefined if not found
          if (!Object.prototype.hasOwnProperty.call(this.#config.liturgicalDayDef, key)) {
            return resolve(undefined);
          }

          const def = this.#config.liturgicalDayDef[key];

          // Compute the date of the LiturgicalDayDef
          const date = ldConfig.buildDate(def);
          if (!date || (dayjs.isDayjs(date) && !date.isValid())) return resolve(null);

          // Try to compute the calendar metadata with the data we have (without the whole year background)
          const startOfSeasonsDic = ldConfig.dates.startOfSeasons();
          const endOfSeasonsDic = ldConfig.dates.endOfSeasons();
          const startOfSeason = def.seasons.length ? startOfSeasonsDic[def.seasons[0]] : '';
          const endOfSeason = def.seasons.length ? endOfSeasonsDic[def.seasons[0]] : '';
          const calendar: RomcalCalendarMetadata = {
            dayOfWeek: def.calendarDef.dayOfWeek ?? NaN,
            dayOfSeason:
              def.calendarDef.dayOfSeason ??
              (startOfSeason ? date.diff(startOfSeason) + 1 : NaN) ??
              NaN,
            weekOfSeason: def.calendarDef.weekOfSeason ?? NaN,
            nthDayOfWeekInMonth: Math.ceil(date.date() / 7),
            startOfSeason: startOfSeason ? startOfSeason.toISOString().substr(0, 10) : '',
            endOfSeason: endOfSeason ? endOfSeason.toISOString().substr(0, 10) : '',
            startOfLiturgicalYear: startOfSeasonsDic[LiturgicalSeasons.ADVENT]
              .toISOString()
              .substr(0, 10),
            endOfLiturgicalYear: endOfSeasonsDic[LiturgicalSeasons.ORDINARY_TIME]
              .toISOString()
              .substr(0, 10),
          };

          // Return the LiturgicalDay object
          resolve(new LiturgicalDay(def, null, date.toISOString(), calendar, ldConfig, null));
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Generate a liturgical calendar, within a Liturgical or Gregorian scope.
   */
  generateCalendar(year?: number): Promise<LiturgicalCalendar> {
    const ldConfig = new LiturgicalDayConfig(this.#config, year);

    // Wrap the calendar computing process in a Promise.
    // Even if this method is called with async/await, this makes this method running in a microtask queue:
    // it does not run on the main thread, meaning other things can occur (click events, rendering, etc.).
    return new Promise((resolve, reject) => {
      // Return cached data, if the calendar has been already computed
      if (this.#computedCalendars[ldConfig.year]) {
        return resolve(this.#computedCalendars[ldConfig.year]);
      }

      try {
        this.getAllDefinitions().then(() => {
          this.#computedCalendars[ldConfig.year] = new Calendar(
            this.#config,
            ldConfig,
          ).generateCalendar();
          resolve(this.#computedCalendars[ldConfig.year]);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Get all possible liturgical days from the Proper of the Time of the General
   * Roman Calendar, outside the context of a specific year.
   */
  getProperOfTimeDefinitions(): Promise<LiturgicalDayDefinitions> {
    return new Promise((resolve, reject) => {
      try {
        new ProperOfTime(this.#config).buildAllDefinitions();
        resolve(
          Object.values(this.#config.liturgicalDayDef)
            .filter((def) => def.fromCalendar === PROPER_OF_TIME_NAME)
            .reduce((obj: LiturgicalDayDefinitions, def) => {
              obj[def.key] = def;
              return obj;
            }, {}),
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Get all possible liturgical days from the currently selected calendar,
   * (including all possible inherited calendars until the General Roman Calendar,
   * and the Proper of the Time), outside the context of a specific year.
   */
  getAllDefinitions(): Promise<LiturgicalDayDefinitions> {
    return new Promise((resolve, reject) => {
      try {
        new ProperOfTime(this.#config).buildAllDefinitions();
        this.#calendarsDef.forEach((cal) => cal.buildAllDefinitions());
        resolve(this.#config.liturgicalDayDef);
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * @deprecated
   * @param config
   */
  // static async calendarFor(config?: RomcalConfigInput | number): Promise<LiturgicalDay[]> {
  //   if (typeof config === 'number') {
  //     config = { year: config };
  //   }
  //
  //   const calendar = new Romcal(config);
  //   const data = await calendar.generate();
  //
  //   return Object.values(data).flat();
  // }
}

export { Romcal, CalendarScope, LiturgicalCalendar, BaseRomcalConfig };